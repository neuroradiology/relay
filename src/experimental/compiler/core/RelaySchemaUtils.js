/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule RelaySchemaUtils
 * @flow
 */

'use strict';

const GraphQL = require('graphql');

const invariant = require('invariant');
const nullthrows = require('nullthrows');

import type {
  ASTNode,
  FragmentDefinitionNode,
  GraphQLCompositeType,
  GraphQLDirective,
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLNamedType,
  GraphQLNullableType,
  GraphQLScalarType,
  GraphQLType,
  OperationDefinitionNode,
  TypeNode,
} from 'graphql';

const {
  assertAbstractType,
  assertType,
  getNamedType,
  getNullableType,
  isType,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLUnionType,
  buildASTSchema,
  parse,
  print,
  typeFromAST,
} = GraphQL;

const ID = 'id';
const ID_TYPE = 'ID';

type GraphQLSingularType =
  GraphQLScalarType |
  GraphQLObjectType |
  GraphQLInterfaceType |
  GraphQLUnionType |
  GraphQLEnumType |
  GraphQLInputObjectType |
  GraphQLNullableType<*>;

/**
 * Determine if the given type may implement the named type:
 * - it is the named type
 * - it implements the named interface
 * - it is an abstract type and *some* of its concrete types may
 *   implement the named type
 */
function mayImplement(schema: GraphQLSchema, type: GraphQLType, typeName: string): boolean {
  const unmodifiedType = getRawType(type);
  return (
    unmodifiedType.toString() === typeName ||
    implementsInterface(unmodifiedType, typeName) ||
    (isAbstractType(unmodifiedType) &&
      hasConcreteTypeThatImplements(schema, unmodifiedType, typeName))
  );
}

function canHaveSelections(type: GraphQLType): boolean {
  return (
    type instanceof GraphQLObjectType ||
    type instanceof GraphQLInterfaceType
  );
}

/**
 * Implements duck typing that checks whether a type has an id field of the ID
 * type. This is approximating what we can hopefully do with the __id proposal
 * a bit more cleanly.
 *
 * https://github.com/graphql/graphql-future/blob/master/01%20-%20__id.md
 */
function hasID(schema: GraphQLSchema, type: GraphQLCompositeType): boolean {
  const unmodifiedType = getRawType(type);
  invariant(
    unmodifiedType instanceof GraphQLObjectType ||
    unmodifiedType instanceof GraphQLInterfaceType,
    'RelaySchemaUtils.hasID(): Expected a concrete type or interface, ' +
    'got type `%s`.',
    type
  );
  const idType = schema.getType(ID_TYPE);
  const idField = unmodifiedType.getFields()[ID];
  return idField && getRawType(idField.type) === idType;
}

/**
 * Determine if a type is abstract (not concrete).
 *
 * Note: This is used in place of the `graphql` version of the function in order
 * to not break `instanceof` checks with Jest. This version also unwraps
 * non-null/list wrapper types.
 */
function isAbstractType(type: GraphQLType): boolean {
  const rawType = getRawType(type);
  return (
    rawType instanceof GraphQLInterfaceType ||
    rawType instanceof GraphQLUnionType
  );
}

/**
 * Get the unmodified type, with list/null wrappers removed.
 */
function getRawType(type: GraphQLType): GraphQLNamedType {
  return nullthrows(getNamedType(type));
}

/**
 * Determines if the given type is a named type.
 */
function assertNamedType(type: mixed): GraphQLNamedType {
  const namedType = getNamedType(assertType(type));
  invariant(
    namedType === type,
    'RelaySchemaUtils: Expected `%s` to be a named type.',
    type
  );
  return (type: any);
}

/**
 * Gets the non-list type, removing the list wrapper if present.
 */
function getSingularType(type: GraphQLType): GraphQLSingularType {
  let unmodifiedType = type;
  while (unmodifiedType instanceof GraphQLList) {
    unmodifiedType = unmodifiedType.ofType;
  }
  return (unmodifiedType: any);
}

/**
 * @public
 */
function implementsInterface(type: GraphQLType, interfaceName: string): boolean {
  return getInterfaces(type).some(interfaceType => interfaceType.toString() === interfaceName);
}

/**
 * @private
 */
function hasConcreteTypeThatImplements(
  schema: GraphQLSchema,
  type: GraphQLType,
  interfaceName: string
): boolean {
  return (
    isAbstractType(type) &&
    getConcreteTypes(schema, type).some(
      concreteType => implementsInterface(concreteType, interfaceName)
    )
  );
}

/**
 * @private
 */
function getConcreteTypes(schema: GraphQLSchema, type: GraphQLType): Array<GraphQLObjectType> {
  return schema.getPossibleTypes(assertAbstractType(type));
}

/**
 * @private
 */
function getInterfaces(type: GraphQLType): Array<GraphQLInterfaceType> {
  if (type instanceof GraphQLObjectType) {
    return type.getInterfaces();
  }
  return [];
}

/**
 * @public
 *
 * Creates a copy of the schema with the given directives added.
 */
function schemaWithDirectives(
  schema: GraphQLSchema,
  directives: Array<GraphQLDirective>
): GraphQLSchema {
  const combinedDirectives = [...schema.getDirectives(), ...directives];
  // Validate uniquely named directives.
  const directiveNames = new Set();
  combinedDirectives.forEach(directive => {
    invariant(
      !directiveNames.has(directive.name),
      'RelaySchemaUtils: Expected unique names for directives, found a ' +
      'duplicate directive `%s`.',
      directive.name
    );
    directiveNames.add(directive.name);
  });
  const types: Array<GraphQLNamedType> =
    Object.values(schema.getTypeMap()).map(assertNamedType);
  return new GraphQLSchema({
    query: schema.getQueryType(),
    mutation: schema.getMutationType(),
    subscription: schema.getSubscriptionType(),
    types,
    directives: combinedDirectives,
  });
}

/**
 * @public
 *
 * Create a schema from schema definition text.
 */
function parseSchema(text: string): GraphQLSchema {
  const ast = parse(text);
  return buildASTSchema(ast);
}

/**
 * @public
 *
 * Determine if an AST node contains a fragment/operation definition.
 */
function isOperationDefinitionAST(ast: ASTNode): boolean {
  return (
    ast.kind === 'FragmentDefinition' ||
    ast.kind === 'OperationDefinition'
  );
}

function getOperationDefinitionAST(
  ast: ASTNode,
): ?(FragmentDefinitionNode | OperationDefinitionNode) {
  if (isOperationDefinitionAST(ast)) {
    return (ast: any);
  }
  return null;
}

/**
 * @public
 *
 * Determine if an AST node contains a schema definition.
 */
function isSchemaDefinitionAST(ast: ASTNode): boolean {
  return (
    ast.kind === 'DirectiveDefinition' ||
    ast.kind === 'EnumTypeDefinition' ||
    ast.kind === 'InputObjectTypeDefinition' ||
    ast.kind === 'InterfaceTypeDefinition' ||
    ast.kind === 'ObjectTypeDefinition' ||
    ast.kind === 'ScalarTypeDefinition' ||
    ast.kind === 'TypeExtensionDefinition' ||
    ast.kind === 'UnionTypeDefinition'
  );
}

function assertTypeWithFields(type: GraphQLType): GraphQLObjectType | GraphQLInterfaceType {
  invariant(
    type instanceof GraphQLObjectType ||
    type instanceof GraphQLInterfaceType,
    'RelaySchemaUtils: Expected type `%s` to be an object or interface type.',
    type
  );
  return (type: any);
}

/**
 * Helper for calling `typeFromAST()` with a clear warning when the type does
 * not exist. This enables the pattern `assertXXXType(getTypeFromAST(...))`,
 * emitting distinct errors for unknown types vs types of the wrong category.
 */
function getTypeFromAST(schema: GraphQLSchema, ast: TypeNode): GraphQLType {
  const type = typeFromAST(schema, ast);
  invariant(
    isType(type),
    'RelaySchemaUtils: Unknown type `%s`.',
    print(ast),
  );
  return (type: any);
}

module.exports = {
  assertTypeWithFields,
  canHaveSelections,
  getNullableType,
  getOperationDefinitionAST,
  getRawType,
  getSingularType,
  getTypeFromAST,
  hasID,
  implementsInterface,
  isAbstractType,
  isOperationDefinitionAST,
  isSchemaDefinitionAST,
  mayImplement,
  parseSchema,
  schemaWithDirectives,
};
