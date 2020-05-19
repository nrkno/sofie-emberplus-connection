import * as Ber from '../../../Ber'
import { EmberElement, ElementType } from '../../../model/EmberElement'
import {
	NumberedTreeNode,
	TreeElement,
	QualifiedElementImpl,
	NumberedTreeNodeImpl
} from '../../../model/Tree'
import { decodeFunctionContent } from './EmberFunction'
import { decodeNode } from './EmberNode'
import { decodeParameter } from './Parameter'
import { decodeTemplate } from './Template'
import {
	QualifiedTemplateBERID,
	QualifiedParameterBERID,
	QualifiedNodeBERID,
	QualifiedMatrixBERID,
	QualifiedFunctionBERID,
	CommandBERID,
	FunctionBERID,
	NodeBERID,
	MatrixBERID,
	ParameterBERID,
	TemplateBERID,
	RootElementsBERID,
	ElementCollectionBERID
} from '../constants'
import { decodeMatrix } from './Matrix'
import { decodeCommand } from './Command'
import { RootElement } from '../../../types/types'
import {
	DecodeResult,
	DecodeOptions,
	defaultDecode,
	makeResult,
	unknownContext,
	safeSet,
	appendErrors,
	unknownApplication,
	check,
	unexpected,
	skipNext
} from './DecodeResult'
import { Command } from '../../../model/Command'
import { EmberNodeImpl } from '../../../model/EmberNode'

export function decodeChildren(
	reader: Ber.Reader,
	options: DecodeOptions = defaultDecode
): DecodeResult<Array<NumberedTreeNode<EmberElement>>> {
	reader.readSequence(ElementCollectionBERID)
	const kids = makeResult<Array<NumberedTreeNode<EmberElement>>>(
		[] as Array<NumberedTreeNode<EmberElement>>
	)

	const endOffset = reader.offset + reader.length
	while (reader.offset < endOffset) {
		reader.readSequence()
		const kidEl = decodeGenericElement(reader, options) as DecodeResult<
			NumberedTreeNode<EmberElement>
		>
		safeSet(kidEl, kids, (x, y) => {
			y.push(x)
			return y
		})
	}

	return kids
}

export function decodeGenericElement(
	reader: Ber.Reader,
	options: DecodeOptions = defaultDecode
): DecodeResult<TreeElement<EmberElement>> {
	const tag = reader.peek()
	const errors = new Array<Error>()

	if (tag === null) {
		unknownApplication(errors, 'decode generic element', tag, options)
		skipNext(reader)
		return makeResult(new NumberedTreeNodeImpl(-1, new EmberNodeImpl()), errors)
	}
	const isQualified = isTagQualified(tag)
	const type = appendErrors(tagToElType(tag, options), errors)

	if (tag === MatrixBERID || tag === QualifiedMatrixBERID) {
		return decodeMatrix(reader, isQualified)
	}
	if (tag === TemplateBERID || tag === QualifiedTemplateBERID) {
		return decodeTemplate(reader, isQualified)
	} else if (tag === CommandBERID) {
		const commandResult: DecodeResult<Command> = decodeCommand(reader, options)
		return makeResult(
			new NumberedTreeNodeImpl(commandResult.value.number, commandResult.value),
			commandResult.errors
		)
	}

	reader.readSequence(tag)
	let path: string | null = null
	let number: number | null = null
	let contents: EmberElement | null = null
	let children: Array<NumberedTreeNode<EmberElement>> | undefined

	const endOffset = reader.offset + reader.length
	while (reader.offset < endOffset) {
		const tag = reader.readSequence()
		switch (tag) {
			case Ber.CONTEXT(0):
				if (isQualified) {
					path = reader.readRelativeOID()
				} else {
					number = reader.readInt()
				}
				break
			case Ber.CONTEXT(1):
				// parse contents
				switch (type) {
					case ElementType.Command:
						unknownApplication(
							errors,
							'decode generic element: command is not generic',
							tag,
							options
						)
						contents = new EmberNodeImpl()
						skipNext(reader)
						break
					case ElementType.Function:
						contents = appendErrors(decodeFunctionContent(reader, options), errors)
						break
					case ElementType.Matrix:
						unknownApplication(
							errors,
							'decode generic element: matrix is not generic',
							tag,
							options
						)
						contents = new EmberNodeImpl()
						skipNext(reader)
						break
					case ElementType.Node:
						contents = appendErrors(decodeNode(reader, options), errors)
						break
					case ElementType.Parameter:
						contents = appendErrors(decodeParameter(reader, options), errors)
						break
					case ElementType.Template:
						unknownApplication(
							errors,
							'decode generic element: template is not generic',
							tag,
							options
						)
						contents = new EmberNodeImpl()
						skipNext(reader)
						break
					default:
						unknownApplication(errors, 'decode generic element', tag, options)
						contents = new EmberNodeImpl()
						skipNext(reader)
						break
				}
				break
			case Ber.CONTEXT(2):
				children = appendErrors(decodeChildren(reader, options), errors)
				break
			default:
				unknownContext(errors, 'decode generic element', tag, options)
				skipNext(reader)
				break
		}
	}

	let el: TreeElement<EmberElement>
	contents = check(
		contents,
		'decode generic element',
		'contents',
		new EmberNodeImpl(),
		errors,
		options
	)
	if (isQualified) {
		path = check(path, 'decode generic element', 'path', '', errors, options)
		el = new QualifiedElementImpl(path, contents, children)
	} else {
		number = check(number, 'decode generic element', 'number', -1, errors, options)
		el = new NumberedTreeNodeImpl(number, contents, children)
	}

	if (children) {
		for (const kid of children) {
			kid.parent = el
		}
	}

	return makeResult<TreeElement<EmberElement>>(el, errors)
}

export function decodeRootElements(
	reader: Ber.Reader,
	options: DecodeOptions = defaultDecode
): DecodeResult<Array<RootElement>> {
	reader.readSequence(RootElementsBERID)
	const rootEls = makeResult<Array<RootElement>>([])
	const endOffset = reader.offset + reader.length
	while (reader.offset < endOffset) {
		const tag = reader.readSequence()
		if (tag !== Ber.CONTEXT(0)) {
			unknownContext(rootEls, 'decode root elements', tag, options)
			skipNext(reader)
		}
		const rootEl = decodeGenericElement(reader, options) as DecodeResult<
			NumberedTreeNode<EmberElement>
		>
		safeSet(rootEl, rootEls, (x, y) => {
			y.push(x)
			return y
		})
	}
	return rootEls
}

function isTagQualified(tag: number): boolean {
	const qualifiedTags = new Set([
		QualifiedTemplateBERID,
		QualifiedParameterBERID,
		QualifiedNodeBERID,
		QualifiedMatrixBERID,
		QualifiedFunctionBERID
	])

	return qualifiedTags.has(tag)
}

function tagToElType(
	tag: number,
	options: DecodeOptions = defaultDecode
): DecodeResult<ElementType> {
	const tags = {
		[CommandBERID]: ElementType.Command,
		[FunctionBERID]: ElementType.Function,
		[NodeBERID]: ElementType.Node,
		[MatrixBERID]: ElementType.Matrix,
		[ParameterBERID]: ElementType.Parameter,
		[TemplateBERID]: ElementType.Template,
		[QualifiedTemplateBERID]: ElementType.Template,
		[QualifiedParameterBERID]: ElementType.Parameter,
		[QualifiedNodeBERID]: ElementType.Node,
		[QualifiedMatrixBERID]: ElementType.Matrix,
		[QualifiedFunctionBERID]: ElementType.Function
	}

	if (!tags[tag]) {
		return unexpected(
			[],
			'tag to element type',
			`Unexpected element type tag '${tag}'`,
			ElementType.Node,
			options
		)
	}

	return makeResult(tags[tag])
}
