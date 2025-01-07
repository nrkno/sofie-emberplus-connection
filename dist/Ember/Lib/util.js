"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEmptyNode = exports.normalizeError = exports.updateProps = exports.insertCommand = exports.toQualifiedEmberNode = exports.getPath = exports.assertQualifiedEmberNode = void 0;
const EmberElement_1 = require("../../model/EmberElement");
const Tree_1 = require("../../model/Tree");
function assertQualifiedEmberNode(node) {
    if ('path' in node) {
        return node;
    }
    else {
        return toQualifiedEmberNode(node);
    }
}
exports.assertQualifiedEmberNode = assertQualifiedEmberNode;
function getPath(node) {
    function isQualified(node) {
        return 'path' in node;
    }
    function isNumbered(node) {
        return 'number' in node;
    }
    if (isQualified(node)) {
        return node.path;
    }
    else if (isNumbered(node)) {
        if (node.parent) {
            return getPath(node.parent) + '.' + node.number;
        }
        else {
            return node.number + '';
        }
    }
    return '';
}
exports.getPath = getPath;
function toQualifiedEmberNode(EmberNode) {
    const path = getPath(EmberNode);
    if (EmberNode.contents.type === EmberElement_1.ElementType.Command) {
        throw new Error('Cannot convert a command to a qualified node');
    }
    return new Tree_1.QualifiedElementImpl(path, EmberNode.contents, EmberNode.children // TODO - do we want the children?
    );
}
exports.toQualifiedEmberNode = toQualifiedEmberNode;
function insertCommand(node, command) {
    return new Tree_1.QualifiedElementImpl(node.path, node.contents, [
        new Tree_1.NumberedTreeNodeImpl(0, command),
    ]);
}
exports.insertCommand = insertCommand;
function updateProps(oldProps, newProps, props) {
    if (!props)
        props = Object.keys(newProps);
    for (const key of props) {
        if (newProps[key] !== undefined && newProps[key] !== oldProps[key]) {
            oldProps[key] = newProps[key];
        }
    }
}
exports.updateProps = updateProps;
/**
 * Check if a value is an error, or wrap it in one
 */
function normalizeError(e) {
    if (e instanceof Error) {
        return e;
    }
    return new Error(typeof e === 'string' ? e : e?.toString());
}
exports.normalizeError = normalizeError;
function isEmptyNode(node) {
    const isNode = (node) => {
        return node.contents.type === EmberElement_1.ElementType.Node;
    };
    if (!isNode(node)) {
        return false;
    }
    if (node.children) {
        return false;
    }
    // Check if any of these properties have a value, including empty strings as a node with an empty description is not empty)
    const notEmpty = [
        node.contents.description,
        node.contents.identifier,
        node.contents.isOnline,
        node.contents.isRoot,
        node.contents.schemaIdentifiers,
        node.contents.templateReference,
    ].some((value) => value !== undefined && value !== null);
    return !notEmpty;
}
exports.isEmptyNode = isEmptyNode;
//# sourceMappingURL=util.js.map