import {
	EmberValue,
	RootElement,
	QualifiedElement,
	TreeElement,
	NumberedTreeNode,
	EmberTypedValue,
	RootType,
	Collection,
	Root,
} from '../../types/types'
import { InvocationResult } from '../../model/InvocationResult'
import { Matrix } from '../../model/Matrix'
import { EmberElement, ElementType } from '../../model/EmberElement'
import {
	Command,
	GetDirectoryImpl,
	SubscribeImpl,
	UnsubscribeImpl,
	Unsubscribe,
	GetDirectory,
	CommandType,
	FieldFlags,
	Subscribe,
	Invoke,
} from '../../model/Command'
import { Parameter } from '../../model/Parameter'
import { Connection, ConnectionDisposition, ConnectionOperation } from '../../model/Connection'
import { EmberNode } from '../../model/EmberNode'
import { EventEmitter } from 'eventemitter3'
import { S101Client } from '../Socket'
import { getPath, assertQualifiedEmberNode, insertCommand, updateProps, isEmptyNode } from '../Lib/util'
import { berEncode } from '../..'
import { NumberedTreeNodeImpl } from '../../model/Tree'
import { EmberFunction } from '../../model/EmberFunction'
import { DecodeResult } from '../../encodings/ber/decoder/DecodeResult'

export type RequestPromise<T> = Promise<RequestPromiseArguments<T>>
export interface RequestPromiseArguments<T> {
	sentOk: boolean
	reqId?: string
	cancel?: () => void
	response?: Promise<T>
}

export enum ExpectResponse {
	None = 'none',
	Any = 'any',
	HasChildren = 'has-children',
}

export interface Request {
	reqId: string
	node: RootElement
	// Basic validation of the response change
	nodeResponse: ExpectResponse
	resolve: (res: any) => void
	reject: (err: Error) => void
	cb?: (EmberNode: TreeElement<EmberElement>) => void
	message: Buffer
	firstSent: number
	lastSent: number
}

export interface Subscription {
	path: string | undefined // undefined implies root level
	cb: (EmberNode: TreeElement<EmberElement>) => void
}

export interface Change {
	path: string | undefined
	node: RootElement
	emptyNode?: boolean
}

export enum ConnectionStatus {
	Error,
	Disconnected,
	Connecting,
	Connected,
}

export type EmberClientEvents = {
	error: [Error]
	warn: [Error]

	connected: []
	disconnected: []
}

export class EmberClient extends EventEmitter<EmberClientEvents> {
	host: string
	port: number
	tree: Collection<NumberedTreeNode<EmberElement>> = []

	private _requests = new Map<string, Request>()
	private _lastInvocation = 0
	private _client: S101Client
	private _subscriptions: Array<Subscription> = []

	private _timeout = 3000
	private _resendTimeout = 1000
	private _resends = false
	private _timer: NodeJS.Timeout

	constructor(host: string, port = 9000, timeout = 3000, enableResends = false, resendTimeout = 1000) {
		super()

		this.host = host
		this.port = port
		this._timeout = timeout
		this._resendTimeout = resendTimeout
		this._resends = enableResends

		// resend timer runs at greatest common divisor of timeouts and resends
		const findGcd = (a: number, b: number) => {
			// assuming a and b are greater than 0
			while (b) {
				const t = b
				b = a % b
				a = t
			}
			return a
		}
		this._timer = setInterval(() => this._resendTimer(), findGcd(this._timeout, this._resendTimeout))

		this._client = new S101Client(this.host, this.port)
		this._client.on('emberTree', (tree: DecodeResult<Root>) => this._handleIncoming(tree))

		this._client.on('error', (e) => this.emit('error', e))
		this._client.on('connected', () => this.emit('connected'))
		this._client.on('disconnected', () => {
			// Clanup and Emit disconnected event, and let the client handle that the connection is lost
			this._requests.clear() // Just clean up the requests
			this.emit('disconnected') // Notify listeners about the disconnection
		})
	}

	/**
	 * Opens an s101 socket to the provider.
	 * @param host The host of the emberplus provider
	 * @param port Port of the provider
	 */
	async connect(host?: string, port?: number): Promise<void | Error> {
		if (host) this.host = host
		if (port) this.port = port

		if (!this.host) return Promise.reject('No host specified')

		this._client.address = this.host
		this._client.port = this.port

		return this._client.connect()
	}

	/**
	 * Closes the s101 socket to the provider
	 */
	async disconnect(): Promise<void> {
		return this._client.disconnect()
	}

	/**
	 * Discards any outgoing connections, removes all requests and clears any timing loops
	 *
	 * This is destructive, using this class after discarding will cause errors.
	 */
	discard(): void {
		this.disconnect().catch(() => null) // we're not worried about errors after this
		this._client.removeAllListeners()
		// @ts-expect-error: after using this method, properties are no longer expected to always exist
		delete this._client
		this._requests.clear() // Just clean up the requests
		this.emit('disconnected') // Notify listeners about the disconnection

		clearInterval(this._timer)
	}

	get connected(): boolean {
		return this._client.status === ConnectionStatus.Connected
	}

	/** Ember+ commands: */
	async getDirectory(
		node: RootElement | Collection<RootElement>,
		dirFieldMask?: FieldFlags,
		cb?: (EmberNode: TreeElement<EmberElement>) => void
	): RequestPromise<Root | RootElement> {
		if (!node) {
			throw new Error('No node specified')
		}
		const command: GetDirectory = new GetDirectoryImpl(dirFieldMask)

		if (!('number' in node || 'path' in node)) {
			if (cb)
				this._subscriptions.push({
					path: undefined,
					cb,
				})

			return this._sendRequest<Root>(new NumberedTreeNodeImpl(0, command), ExpectResponse.Any)
		}

		if (cb)
			this._subscriptions.push({
				path: getPath(node),
				cb,
			})

		return this._sendCommand<RootElement>(node, command, ExpectResponse.HasChildren)
	}
	async subscribe(
		node: RootElement | Array<RootElement>,
		cb?: (EmberNode: TreeElement<EmberElement>) => void
	): RequestPromise<Root | void> {
		if (!node) {
			throw new Error('No node specified')
		}

		const command: Subscribe = new SubscribeImpl()

		if (Array.isArray(node)) {
			if (cb)
				this._subscriptions.push({
					path: undefined,
					cb,
				})

			return this._sendRequest<Root>(new NumberedTreeNodeImpl(0, command), ExpectResponse.Any)
		}

		if (cb)
			this._subscriptions.push({
				path: getPath(node),
				cb,
			})

		return this._sendCommand<void>(node, command, ExpectResponse.None)
	}
	async unsubscribe(node: NumberedTreeNode<EmberElement> | Array<RootElement>): RequestPromise<Root | void> {
		if (!node) {
			throw new Error('No node specified')
		}

		const command: Unsubscribe = new UnsubscribeImpl()

		const path = Array.isArray(node) ? '' : getPath(node)
		for (const i in this._subscriptions) {
			if (this._subscriptions[i].path === path) {
				this._subscriptions.splice(Number(i), 1)
			}
		}

		if (Array.isArray(node)) {
			return this._sendRequest<Root>(new NumberedTreeNodeImpl(0, command), ExpectResponse.Any)
		}

		return this._sendCommand<void>(node, command, ExpectResponse.None)
	}
	async invoke(
		node: NumberedTreeNode<EmberFunction> | QualifiedElement<EmberFunction>,
		...args: Array<EmberTypedValue>
	): RequestPromise<InvocationResult> {
		if (!node) {
			throw new Error('No node specified')
		}

		// TODO - validate arguments
		const command: Invoke = {
			type: ElementType.Command,
			number: CommandType.Invoke,
			invocation: {
				id: ++this._lastInvocation,
				args,
			},
		}
		return this._sendCommand<InvocationResult>(node, command, ExpectResponse.Any)
	}

	/** Sending ember+ values */
	async setValue(
		node: QualifiedElement<Parameter> | NumberedTreeNode<Parameter>,
		value: EmberValue,
		awaitResponse = true
	): RequestPromise<TreeElement<Parameter>> {
		if (!node) {
			throw new Error('No node specified')
		}

		const qualifiedParam = assertQualifiedEmberNode(node) as QualifiedElement<Parameter>

		// TODO - validate value
		// TODO - should other properties be scrapped?
		qualifiedParam.contents.value = value

		return this._sendRequest<TreeElement<Parameter>>(
			qualifiedParam,
			awaitResponse ? ExpectResponse.Any : ExpectResponse.None
		)
	}
	async matrixConnect(
		matrix: QualifiedElement<Matrix> | NumberedTreeNode<Matrix>,
		target: number,
		sources: Array<number>
	): RequestPromise<TreeElement<Matrix>> {
		return this._matrixMutation(matrix, target, sources, ConnectionOperation.Connect)
	}
	async matrixDisconnect(
		matrix: QualifiedElement<Matrix> | NumberedTreeNode<Matrix>,
		target: number,
		sources: Array<number>
	): RequestPromise<TreeElement<Matrix>> {
		return this._matrixMutation(matrix, target, sources, ConnectionOperation.Disconnect)
	}
	async matrixSetConnection(
		matrix: QualifiedElement<Matrix> | NumberedTreeNode<Matrix>,
		target: number,
		sources: Array<number>
	): RequestPromise<TreeElement<Matrix>> {
		return this._matrixMutation(matrix, target, sources, ConnectionOperation.Absolute)
	}

	/** Getting the tree: */
	async expand(node: NumberedTreeNode<EmberElement> | Collection<RootElement>): Promise<void> {
		if (!node) {
			throw new Error('No node specified')
		}

		if (!('number' in node)) {
			await (
				await this.getDirectory(node)
			).response
			for (const root of Object.values<NumberedTreeNode<EmberElement>>(this.tree)) await this.expand(root)
			return
		}

		const emberNodes = [node]
		const canBeExpanded = (node: NumberedTreeNode<EmberElement>) => {
			if (node.contents.type === ElementType.Node) {
				return (node as NumberedTreeNode<EmberNode>).contents.isOnline !== false
			} else {
				return node.contents.type !== ElementType.Parameter && node.contents.type !== ElementType.Function
			}
		}

		let curEmberNode
		while ((curEmberNode = emberNodes.shift())) {
			if (curEmberNode.children) {
				emberNodes.push(...Object.values<NumberedTreeNode<EmberElement>>(curEmberNode.children).filter(canBeExpanded))
			} else {
				const req = await this.getDirectory(curEmberNode)
				if (!req.response) continue
				const res = (await req.response) as RootElement
				if (res.children) {
					Object.values<NumberedTreeNode<EmberElement>>(res.children).forEach(
						(c) => canBeExpanded(c) && emberNodes.push(c)
					)
				}
			}
		}
	}
	async getElementByPath(
		path: string,
		cb?: (EmberNode: TreeElement<EmberElement>) => void,
		delimiter = '.'
	): Promise<TreeElement<EmberElement> | undefined> {
		const getNodeInCollection = (elements: Collection<NumberedTreeNode<EmberElement>>, identifier: string) =>
			Object.values<NumberedTreeNode<EmberElement>>(elements || {}).find(
				(r) =>
					r.number === Number(identifier) ||
					(r.contents as EmberNode).identifier === identifier ||
					(r.contents as EmberNode).description === identifier
			)
		const getNextChild = (node: TreeElement<EmberElement>, identifier: string) =>
			node.children && getNodeInCollection(node.children, identifier)

		const numberedPath: Array<number> = []
		const pathArr = path.split(delimiter)
		const firstIdentifier = pathArr.shift()
		if (!firstIdentifier) throw new Error('Expected at least one segment in the path')

		let tree: NumberedTreeNode<EmberElement> | undefined = getNodeInCollection(this.tree, firstIdentifier)
		if (tree?.number !== undefined) numberedPath.push(tree.number)

		while (pathArr.length) {
			const i = pathArr.shift()
			if (i === undefined) break // TODO - this will break the loop if the path was `1..0`
			if (!tree) break

			let next = getNextChild(tree, i)
			if (!next) {
				const req = await this.getDirectory(tree)
				tree = (await req.response) as NumberedTreeNode<EmberElement>
				next = getNextChild(tree, i)
			}
			tree = next

			if (!tree) throw new Error(`Could not find node ${i} on given path ${numberedPath.join()}`)
			if (tree?.number !== undefined) numberedPath.push(tree.number)
		}

		if (tree?.contents.type === ElementType.Parameter) {
			// do an additional getDirectory because Providers do not _have_ to send updates without that (should vs shall)
			const req = await this.getDirectory(tree)
			await req.response
		}

		if (cb && numberedPath) {
			this._subscriptions.push({
				path: numberedPath.join('.'),
				cb,
			})
		}

		return tree
	}

	private async _matrixMutation(
		matrix: QualifiedElement<Matrix> | NumberedTreeNode<Matrix>,
		target: number,
		sources: Array<number>,
		operation: ConnectionOperation
	) {
		if (!matrix) {
			throw new Error('No matrix specified')
		}

		const qualifiedMatrix = assertQualifiedEmberNode(matrix) as QualifiedElement<Matrix>

		const connection: Connection = {
			operation,
			target,
			sources,
		}

		qualifiedMatrix.contents.connections = [connection]

		return this._sendRequest<TreeElement<Matrix>>(qualifiedMatrix, ExpectResponse.Any)
	}

	private async _sendCommand<T>(node: RootElement, command: Command, expectResponse: ExpectResponse) {
		// assert a qualified EmberNode
		const qualifiedEmberNode = assertQualifiedEmberNode(node)
		// insert command
		const commandEmberNode = insertCommand(qualifiedEmberNode, command)
		// send request
		return this._sendRequest<T>(commandEmberNode, expectResponse)
	}

	private async _sendRequest<T>(node: RootElement, expectResponse: ExpectResponse): RequestPromise<T> {
		const reqId = Math.random().toString(24).substr(-4)
		const requestPromise: RequestPromiseArguments<T> = {
			reqId,
			sentOk: false,
		}

		const message = berEncode([node], RootType.Elements)

		if (expectResponse !== ExpectResponse.None) {
			const p = new Promise<T>((resolve, reject) => {
				const request: Request = {
					reqId,
					node,
					nodeResponse: expectResponse,
					resolve,
					reject,
					message,
					firstSent: Date.now(),
					lastSent: Date.now(),
				}
				this._requests.set(reqId, request)

				requestPromise.cancel = () => {
					reject(new Error('Request cancelled'))
					this._requests.delete(reqId)
				}
			})
			requestPromise.response = p
		}

		const sentOk = this._client.sendBER(message) // TODO - if sending multiple values to same path, should we do synchronous requests?

		if (!sentOk && requestPromise.cancel) {
			this._requests.get(reqId)?.reject(new Error('Request was not sent correctly'))
			this._requests.delete(reqId)
		}

		return {
			...requestPromise,
			sentOk,
		}
	}

	private _handleIncoming(incoming: DecodeResult<Root>) {
		const node = incoming.value
		// update tree:
		const changes = this._applyRootToTree(node)

		// check for subscriptiions:
		for (const change of changes) {
			const subscription = this._subscriptions.find((s) => s.path === change.path)
			if (subscription && change.node) subscription.cb(change.node)
		}

		// check for any outstanding requests and resolve them
		// iterate over requests, check path, if Invocation check id
		// resolve requests
		for (const change of changes) {
			const reqs = Array.from(this._requests.values()).filter(
				(s) => (!('path' in s.node) && !change.path) || ('path' in s.node && s.node.path === change.path)
			)
			for (const req of reqs) {
				// Don't complete the response, if the call was expecting the children to be loaded
				if (req.nodeResponse === ExpectResponse.HasChildren && !change.node.children) {
					if (change.node.contents.type === ElementType.Parameter) {
						// can't have children, therefore don't continue
					} else if (change.emptyNode) {
						// update comes from an empty node, so we can't continue anyway
					} else {
						continue
					}
				}

				if (req.cb) req.cb(change.node)
				if (req.resolve) {
					req.resolve(change.node)
					this._requests.delete(req.reqId)
				}
			}
		}

		// at last, emit the errors for logging purposes
		incoming.errors?.forEach((e) => this.emit('warn', e))
	}

	private _applyRootToTree(node: Root): Array<Change> {
		const changes: Array<Change> = []

		if ('id' in node) {
			// node is an InvocationResult
			this._requests.forEach((req) => {
				if (req.node.contents.type === ElementType.Function) {
					if (req.node.children && req.node.children[0]) {
						if ('invocation' in (req.node.children[0].contents as Invoke)) {
							if (
								(req.node.children[0].contents as Invoke).invocation?.id &&
								(req.node.children[0].contents as Invoke).invocation?.id === node.id
							) {
								req.resolve(node)
								this._requests.delete(req.reqId)
							}
						}
					}
				}
			})
		} else {
			// EmberNode is not an InvocationResult

			// walk tree
			for (const rootElement of Object.values<RootElement>(node as Collection<RootElement>)) {
				if ('identifier' in rootElement) {
					// rootElement is a StreamEntry
					continue
				} else if ('path' in rootElement) {
					// element is qualified
					const path: Array<string> = rootElement.path.split('.')
					let tree = this.tree[Number(path.shift())]
					let inserted = false

					if (!tree) {
						if (path.length) {
							// Assuming this means that no get directory was done on the root of the tree.
							changes.push({ path: rootElement.path, node: rootElement })
							continue
						} else {
							const number = Number(rootElement.path)
							// Insert node into root
							this.tree[number] = new NumberedTreeNodeImpl(number, rootElement.contents, rootElement.children)
							changes.push({ path: undefined, node: this.tree[number] })
							continue
						}
					}

					for (const number of path) {
						if (!tree.children) tree.children = {}
						if (!tree.children[Number(number)]) {
							tree.children[Number(number)] = {
								...rootElement,
								number: Number(number),
								parent: tree,
							}
							changes.push({
								path: rootElement.path.split('.').slice(0, -1).join('.'),
								node: tree,
							})
							inserted = true
							break
						}
						tree = tree.children[Number(number)]
					}

					if (inserted) continue
					changes.push(...this._updateTree(rootElement, tree))
				} else {
					if (rootElement.children) {
						if (this.tree[rootElement.number]) {
							changes.push(...this._updateTree(rootElement, this.tree[rootElement.number]))
						} else {
							this.tree[rootElement.number] = rootElement
							changes.push({ path: undefined, node: rootElement })
						}
					} else if (isEmptyNode(rootElement)) {
						// empty node on the root of the tree must mean we have done a getDir on that specific node
						changes.push({ path: rootElement.number + '', node: rootElement, emptyNode: true })
					} else {
						// this must have been something on the root of the tree (like GetDirectory)
						this.tree[rootElement.number] = rootElement
						changes.push({ path: undefined, node: rootElement })
					}
				}
			}
		}

		return changes
	}

	private _updateTree(update: TreeElement<EmberElement>, tree: NumberedTreeNode<EmberElement>): Array<Change> {
		const changes: Array<Change> = []

		if (update.contents.type === tree.contents.type) {
			changes.push({ path: getPath(tree), node: tree, emptyNode: isEmptyNode(update) })
			// changes.push({ path: getPath(tree), node: tree })
			switch (tree.contents.type) {
				case ElementType.Node:
					this._updateEmberNode(update.contents as EmberNode, tree.contents)
					break
				case ElementType.Parameter:
					this._updateParameter(update.contents as Parameter, tree.contents)
					break
				case ElementType.Matrix:
					this._updateMatrix(update.contents as Matrix, tree.contents)
					break
			}
		}
		if (update.children && tree.children) {
			// Update children
			for (const child of Object.values<NumberedTreeNode<EmberElement>>(update.children)) {
				const i = child.number
				const oldChild = tree.children[i] // as NumberedTreeNode<EmberElement> | undefined // TODO
				changes.push(...this._updateTree(child, oldChild))
			}
		} else if (update.children) {
			changes.push({ path: getPath(tree), node: tree })
			tree.children = update.children
			for (const c of Object.values<NumberedTreeNode<EmberElement>>(update.children)) {
				c.parent = tree
			}
		}

		return changes
	}

	private _updateEmberNode(update: EmberNode, EmberNode: EmberNode) {
		updateProps<EmberNode>(EmberNode, update, ['isOnline'])
	}

	private _updateParameter(update: Parameter, parameter: Parameter) {
		updateProps<Parameter>(parameter, update, ['value', 'isOnline', 'access'])
	}

	private _updateMatrix(update: Matrix, matrix: Matrix) {
		updateProps<Matrix>(matrix, update, ['targets', 'targetCount', 'sources', 'sourceCount', 'connections'])

		// update connections
		if (update.connections) {
			if (matrix.connections) {
				// matrix already has connections
				for (const connection of Object.values<Connection>(update.connections as { [target: number]: Connection })) {
					if (
						!connection.disposition ||
						!(
							connection.disposition === ConnectionDisposition.Locked ||
							connection.disposition === ConnectionDisposition.Pending
						)
					) {
						// update is either generic, tally or modification
						let exists = false
						for (const i in matrix.connections) {
							if (matrix.connections[i].target === connection.target) {
								// found connection to update
								exists = true
								matrix.connections[i].sources = connection.sources
							}
						}

						if (!exists) {
							// connection to target does not exist yet
							matrix.connections[connection.target] = {
								target: connection.target,
								sources: connection.sources,
							}
						}
					}
				}
			} else {
				// connections have not been set yet
				matrix.connections = update.connections
			}
		}
	}

	private _resendTimer() {
		if (this.connected) {
			this._requests.forEach((req) => {
				const sinceSent = Date.now() - req.lastSent
				const sinceFirstSent = Date.now() - req.firstSent
				if (this._resends && sinceSent >= this._resendTimeout) {
					const sent = this._client.sendBER(req.message)
					if (sent) {
						req.lastSent = Date.now()
					} else {
						this.emit('error', new Error('Request was not sent correctly'))
					}
				}
				if (sinceFirstSent >= this._timeout) {
					// Emit error and remove request
					this.emit('error', new Error('Request timed out'))
					this._requests.delete(req.reqId)
				}
			})
		}
	}
}
