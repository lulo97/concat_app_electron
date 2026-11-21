// Summarises C / C++ sources (tree-sitter "cpp" grammar). Same output format as the Python summarizer.
const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const lineCount = (node) => node.endPosition.row - node.startPosition.row + 1;

const NAME_TYPES = new Set([
  'identifier', 'field_identifier', 'qualified_identifier', 'destructor_name',
  'operator_name', 'template_function', 'operator_cast', 'type_identifier',
]);

function cleanComment(text) {
  return text.split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\/\/[\/!]?|\/\*+!?|\*+\/?)\s?/, '').replace(/\*+\/\s*$/, '').trim())
    .filter(Boolean)
    .join(' ');
}

/** Comment block directly above a declaration (also looks above a wrapping `template<>`). */
function docOf(node) {
  const target = node.parent?.type === 'template_declaration' ? node.parent : node;
  const parts = [];
  let expectedRow = target.startPosition.row;
  let prev = target.previousSibling;
  while (prev && prev.type === 'comment' && prev.endPosition.row >= expectedRow - 1) {
    parts.unshift(cleanComment(prev.text));
    expectedRow = prev.startPosition.row;
    prev = prev.previousSibling;
  }
  const text = parts.join(' ').trim();
  return text ? ' ' + JSON.stringify(text.length > 160 ? text.slice(0, 157) + '...' : text) : '';
}

/** Unwrap pointer/reference/array/init declarators down to the function_declarator, if any. */
function findFunctionDeclarator(node) {
  let d = node?.childForFieldName('declarator');
  while (d && d.type !== 'function_declarator') d = d.childForFieldName('declarator');
  return d ?? null;
}

function declaratorName(d) {
  while (d && !NAME_TYPES.has(d.type)) d = d.childForFieldName('declarator');
  return d ? collapse(d.text) : null;
}

function describeFunction(node, scope, tag) {
  const fd = findFunctionDeclarator(node);
  const name = declaratorName(fd.childForFieldName('declarator'));
  if (!name) return null;
  const params = collapse(fd.childForFieldName('parameters')?.text ?? '()').replace(/\s*([,()])\s*/g, '$1');
  const isConst = fd.namedChildren.some((c) => c.type === 'type_qualifier') ? ' const' : '';
  const ret = node.childForFieldName('type');
  const retText = ret ? '->' + collapse(ret.text) : '';
  const prefix = scope.length ? scope.join('::') + '::' : '';
  return `${tag} ${prefix}${name}${params}${isConst}${retText}`;
}

function walk(node, scope, items, inClass) {
  for (const child of node.namedChildren) {
    const line = child.startPosition.row + 1;
    switch (child.type) {
      case 'namespace_definition': {
        const name = child.childForFieldName('name')?.text;
        const body = child.childForFieldName('body');
        if (name) items.push([line, `N ${[...scope, name].join('::')}`]);
        if (body) walk(body, name ? [...scope, name] : scope, items, false);
        break;
      }
      case 'class_specifier':
      case 'struct_specifier':
      case 'union_specifier': {
        const body = child.childForFieldName('body');
        const nameNode = child.childForFieldName('name');
        if (!body || !nameNode) break; // forward declaration or anonymous
        const name = collapse(nameNode.text);
        items.push([line, `C ${[...scope, name].join('::')} (${lineCount(child)}L)${docOf(child)}`]);
        walk(body, [...scope, name], items, true);
        break;
      }
      case 'enum_specifier': {
        const name = child.childForFieldName('name')?.text;
        if (name && child.childForFieldName('body')) items.push([line, `T ${[...scope, name].join('::')}`]);
        break;
      }
      case 'function_definition': {
        if (!findFunctionDeclarator(child)) break;
        const text = describeFunction(child, scope, 'F');
        if (text) items.push([line, `${text} (${lineCount(child)}L)${docOf(child)}`]);
        break; // never descend into bodies
      }
      case 'declaration':
      case 'field_declaration': {
        if (findFunctionDeclarator(child)) {
          const text = describeFunction(child, scope, 'P'); // prototype
          if (text) items.push([line, `${text}${docOf(child)}`]);
          break;
        }
        const type = child.childForFieldName('type');
        // `struct Foo { ... } foo;` -> also descend to pick up the type
        if (type && ['class_specifier', 'struct_specifier', 'enum_specifier', 'union_specifier'].includes(type.type)) {
          walk({ namedChildren: [type] }, scope, items, inClass);
        }
        const typeText = type ? ':' + collapse(type.text) : '';
        const prefix = scope.length ? scope.join('::') + '::' : '';
        for (const d of child.childrenForFieldName('declarator')) {
          const name = declaratorName(d);
          if (name) items.push([line, `G ${prefix}${name}${typeText}${docOf(child)}`]);
        }
        break;
      }
      case 'alias_declaration': {
        const name = child.childForFieldName('name')?.text;
        if (name) items.push([line, `T ${[...scope, name].join('::')}`]);
        break;
      }
      case 'type_definition': {
        const name = declaratorName(child.childForFieldName('declarator'));
        if (name) items.push([line, `T ${[...scope, name].join('::')}`]);
        break;
      }
      case 'template_declaration':
      case 'linkage_specification':
      case 'declaration_list':
      case 'preproc_if':
      case 'preproc_ifdef':
      case 'preproc_else':
      case 'preproc_elif':
        walk(child, scope, items, inClass);
        break;
      default:
        break;
    }
  }
}

function collectIncludes(root) {
  const found = new Set();
  for (const node of root.descendantsOfType('preproc_include')) {
    const p = node.childForFieldName('path');
    if (p?.type === 'string_literal') found.add(p.text.replace(/^"|"$/g, '')); // project headers only
  }
  return [...found].sort();
}

function summarizeCpp(parser, source, label) {
  const tree = parser.parse(source);
  try {
    const lines = source.split(/\r\n|\r|\n/);
    if (lines[lines.length - 1] === '') lines.pop();

    const items = [];
    walk(tree.rootNode, [], items, false);
    for (const inc of collectIncludes(tree.rootNode)) items.push([0, `I ${inc}`]);

    items.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    const hasErrors = tree.rootNode.hasError ? ' [syntax errors]' : '';
    return [`\n@${label} (${lines.length}L)${hasErrors}`, ...items.map(([, t]) => t)].join('\n');
  } finally {
    tree.delete();
  }
}

module.exports = { summarizeCpp };