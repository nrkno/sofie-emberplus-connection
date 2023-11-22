# Sofie Ember+ Connection

This is the _Ember+ Connection_ library of the [**Sofie** TV Automation System](https://github.com/nrkno/Sofie-TV-automation/), a TypeScript implementation of [Lawo's Ember+](https://github.com/Lawo/ember-plus) control protocol for _Node.js_. It has been tested with _Lawo Ruby_, _Lawo R3lay_, and _Lawo MxGUI_.

The current version is very losely based on the original library and Mr. Gilles Dufour's rewrites. It is however rewritten almost completely from scratch and bears little to no resemblance to earlier libraries.


### Repository-specific Info for Developers
* [Developer Info](DEVELOPER.md)
* [Contribution Guidelines](CONTRIBUTING.md)

### General Sofie System Info
* [Documentation](https://nrkno.github.io/sofie-core/)
* [Releases](https://nrkno.github.io/sofie-core/releases)

---

## Example Usage

### Client

Get Full tree:

```javascript
const { EmberClient } = require('emberplus-connection');
const client = new EmberClient("10.9.8.7", 9000);
client.on("error", e => {
   console.log(e);
});
await client.connect()
// Get Root info
const req = await client.getDirectory(client.tree)
await req.response
// Get a Specific Node
const node = await client.getElementByPath("0.0.2")
console.log(node);
// Get a node by its path identifiers
const node2 = await client.getElementByPath("path.to.node"))
console.log(node2);
// Get a node by its path descriptions
const node3 = await client.getElementByPath("descr1.descr2.descr3"))
console.log(node3);
// Expand entire tree under node 0
await client.expand(client.tree)
console.log(client.tree)
```

Subsribe to changes

```javascript
const { EmberClient, EmberLib } = require('emberplus-connection')

const client = new EmberClient(HOST, PORT)
client
	.connect()
	.then(async () => (await client.getDirectory(client.tree)).response)
	.then(() => {
		console.log(client.tree, null, 4)
	})
	.then(() => client.getElementByPath('scoreMaster/router/labels/group 1'))
	.then((node) => {
		// For streams, use subscribe
		return client.subscribe(node, (update) => {
			console.log(udpate)
		})
	})
	.then(() => client.getElementByPath('0.2'))
	.then(async (node) => {
		// For non-streams a getDirectory will automatically subscribe for update
		return (
			await client.getDirectory(node, (update) => {
				console.log(udpate)
			})
		).response
	})
	// You can also provide a callback to the getElementByPath
	// Be carefull that subscription will be done for all elements in the path
	.then(() =>
		client.getElementByPath('0.3', (update) => {
			console.log(update)
		})
	)
```

### Setting New Value

```javascript
client = new EmberClient(LOCALHOST, PORT)
await client.connect()
await (await client.getDirectory()).response
const req = await client.setValue(await client.getElementByPath('0.0.1'), 'gdnet')
await req.response
console.log('result', req.response)
return client.disconnect().then(() => {
	console.log('disconnected')
})
```

### Invoking Function

```javascript
const { EmberClient, EmberLib } = require('node-emberplus')

const client = new EmberClient(HOST, PORT)
await client.connect()
await (await client.getDirectory()).response
const fn = await client.getElementByPath('path.to.function')
const req = await client.invoke(fn, 1, 2, 3)
console.log('result', await req.response)
```

### Basic Server

```javascript
const {
	EmberServer,
	NumberedTreeNodeImpl,
	EmberNodeImpl,
	ParameterImpl,
	ParameterType,
	EmberFunctionImpl,
	ParameterAccess,
	MatrixImpl,
	MatrixType,
	MatrixAddressingMode
} = require('emberplus-connection')

const s = new EmberServer(9000) // start server on port 9000

s.onInvocation = (emberFunction, invocation) => {
	// handle function invocations
	return { id: invocation.contents.invocation.id, success: true }
}
s.onSetValue = async (node, value) => {
	// handle setting values
	s.update(node, { value })

	return true
}
s.onMatrixOperation = (matrix, connections) => {
	// handle matrix operations
	for (const connection of Object.values(connections)) {
		s.updateMatrixConnection(matrix, connection)
	}
}

const tree = {
	// create a tree for the provider
	1: new NumberedTreeNodeImpl(1, new EmberNodeImpl('Root', undefined, undefined, true), {
		1: new NumberedTreeNodeImpl(1, new EmberNodeImpl('Node', undefined, undefined, true), {
			1: new NumberedTreeNodeImpl(
				1,
				new ParameterImpl(
					ParameterType.Integer,
					'Value1',
					undefined,
					2,
					undefined,
					undefined,
					ParameterAccess.ReadWrite
				)
			),
			2: new NumberedTreeNodeImpl(
				2,
				new ParameterImpl(
					ParameterType.Integer,
					'Value2',
					undefined,
					2,
					undefined,
					undefined,
					ParameterAccess.ReadWrite
				)
			),
			3: new NumberedTreeNodeImpl(
				3,
				new ParameterImpl(
					ParameterType.Integer,
					'Value3',
					undefined,
					2,
					undefined,
					undefined,
					ParameterAccess.ReadWrite
				)
			)
		}),

		2: new NumberedTreeNodeImpl(2, new EmberNodeImpl('Functions', undefined, undefined, true), {
			1: new NumberedTreeNodeImpl(
				1,
				new EmberFunctionImpl(undefined, undefined) //, [{ type: ParameterType.Boolean, name: 'Test' }])
			)
		}),

		3: new NumberedTreeNodeImpl(3, new EmberNodeImpl('Matrices', undefined, undefined, true), {
			1: new NumberedTreeNodeImpl(
				1,
				new MatrixImpl(
					'Test Matrix',
					[1, 2, 3, 4, 5],
					[1, 2, 3, 4, 5],
					{},
					undefined,
					MatrixType.NToN,
					MatrixAddressingMode.NonLinear,
					5,
					5
				)
			)
		})
	})
}

s.init(tree) // initiate the provider with the tree
```
---

_The NRK logo is a registered trademark of Norsk rikskringkasting AS. The license does not grant any right to use, in any way, any trademarks, service marks or logos of Norsk rikskringkasting AS._
