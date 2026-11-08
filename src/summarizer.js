const fs = require('fs').promises;
const path = require('path');
const { Parser, Language } = require('web-tree-sitter');
const { tick } = require('./utils');

const HEADER = 'G = Global variable, F = Function, C = Class, L = Line count, I = Import';

// Node has no sys.stdlib_module_names, so keep a list (Python 3.12).
const STDLIB = new Set(`__future__ abc argparse array ast asyncio atexit base64 bisect builtins bz2
calendar cmath collections colorsys concurrent configparser contextlib contextvars copy csv ctypes
dataclasses datetime decimal difflib dis email enum errno faulthandler fnmatch fractions ftplib
functools gc getopt getpass gettext glob gzip hashlib heapq hmac html http imaplib importlib inspect
io ipaddress itertools json keyword linecache locale logging lzma math mimetypes multiprocessing
numbers operator os pathlib pdb pickle pkgutil platform pprint profile pstats queue random re
reprlib runpy sched secrets select selectors shelve shlex shutil signal site smtplib socket
socketserver sqlite3 ssl stat statistics string struct subprocess sys sysconfig tarfile tempfile
textwrap threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc types
typing unicodedata unittest urllib uuid venv warnings weakref webbrowser xml xmlrpc zipfile zipimport
zlib zoneinfo`.split(/\s+/));

let parserPromise;
function getParser() {
  parserPromise ??= (async () => {
    const treeWasm = path.join(path.dirname(require.resolve('web-tree-sitter')), 'tree-sitter.wasm');
    await Parser.init({ locateFile: () => treeWasm });
    const pyWasm = path.join(path.dirname(require.resolve('tree-sitter-python/package.json')), 'tree-sitter-python.wasm');
    const language = await Language.load(new Uint8Array(await fs.readFile(pyWasm)));
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  })();
  return parserPromise;
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const compactDoc = (doc) => (doc ? ' ' + JSON.stringify(collapse(doc)) : '');
const lineCount = (node) => node.endPosition.row - node.startPosition.row + 1;

function stringValue(node) {
  return node.text
    .replace(/^[rRbBuUfF]*("""|'''|"|')/, '')
    .replace(/("""|'''|"|')$/, '');
}

/** Docstring of a function/class body, or of a following sibling statement. */
function docOf(statement) {
  if (statement?.type !== 'expression_statement') return null;
  const first = statement.namedChild(0);
  return first?.type === 'string' ? stringValue(first) : null;
}

const bodyDoc = (node) => docOf(node.childForFieldName('body')?.namedChild(0));

function signature(node) {
  const params = node.childForFieldName('parameters');
  let result = params ? collapse(params.text).replace(/\s*([,:=()*])\s*/g, '$1') : '()';
  const ret = node.childForFieldName('return_type');
  if (ret) result += '->' + collapse(ret.text);
  return result;
}

// ---------- F / C ----------
function collectDefinitions(node, scope, items) {
  for (const child of node.namedChildren) {
    if (child.type === 'function_definition' || child.type === 'class_definition') {
      const name = [...scope, child.childForFieldName('name').text].join('.');
      const doc = compactDoc(bodyDoc(child));
      const line = child.startPosition.row + 1;
      items.push(child.type === 'function_definition'
        ? [line, `F ${name}${signature(child)} (${lineCount(child)}L)${doc}`]
        : [line, `C ${name} (${lineCount(child)}L)${doc}`]);
      collectDefinitions(child, [...scope, child.childForFieldName('name').text], items);
    } else {
      collectDefinitions(child, scope, items);
    }
  }
}

// ---------- I ----------
function importName(node) {
  if (node.type === 'aliased_import') {
    return `${node.childForFieldName('name').text} as ${node.childForFieldName('alias').text}`;
  }
  return node.text;
}

function collectImports(root) {
  const found = new Set();
  for (const node of root.descendantsOfType(['import_statement', 'import_from_statement'])) {
    if (node.type === 'import_statement') {
      for (const n of node.namedChildren) {
        const base = n.type === 'aliased_import' ? n.childForFieldName('name') : n;
        if (!STDLIB.has(base.text.split('.')[0])) found.add(importName(n));
      }
    } else {
      const moduleNode = node.childForFieldName('module_name');
      const moduleText = moduleNode ? moduleNode.text : '';
      const isRelative = moduleNode?.type === 'relative_import';
      if (!isRelative && STDLIB.has(moduleText.split('.')[0])) continue;
      const names = [];
      for (const n of node.namedChildren) {
        if (n.id === moduleNode?.id) continue;
        names.push(n.type === 'wildcard_import' ? '*' : importName(n));
      }
      found.add(`${moduleText}:{${names.join(',')}}`);
    }
  }
  return [...found].sort();
}

// ---------- G ----------
function targetNames(node) {
  if (!node) return [];
  if (node.type === 'identifier') return [node.text];
  if (['pattern_list', 'tuple_pattern', 'list_pattern', 'expression_list'].includes(node.type)) {
    return node.namedChildren.flatMap(targetNames);
  }
  return [];
}

/** Module-level statements, descending into if/for/try/with but not into def/class. */
function collectGlobals(node, variables) {
  const children = node.namedChildren;
  children.forEach((child, i) => {
    if (['function_definition', 'class_definition', 'decorated_definition'].includes(child.type)) return;

    let targets = [];
    let inner = child;
    if (child.type === 'expression_statement') inner = child.namedChild(0) ?? child;
    if (inner.type === 'assignment' || inner.type === 'augmented_assignment') {
      targets = targetNames(inner.childForFieldName('left'));
    } else if (child.type === 'for_statement') {
      targets = targetNames(child.childForFieldName('left'));
    }

    if (targets.length) {
      const doc = docOf(children[i + 1]);
      const type = inner.type === 'assignment' ? inner.childForFieldName('type')?.text : null;
      for (const name of targets) {
        const entry = variables.get(name) ?? { line: child.startPosition.row + 1, type: null, doc: null };
        if (type && !entry.type) entry.type = collapse(type);
        if (doc) entry.doc = doc;
        variables.set(name, entry);
      }
    }
    collectGlobals(child, variables);
  });
}

function summarizeSource(parser, source, label) {
  const tree = parser.parse(source);
  try {
    const lines = source.split(/\r\n|\r|\n/);
    if (lines[lines.length - 1] === '') lines.pop();

    const items = [];
    collectDefinitions(tree.rootNode, [], items);
    for (const imp of collectImports(tree.rootNode)) items.push([0, `I ${imp}`]);

    const variables = new Map();
    collectGlobals(tree.rootNode, variables);
    for (const [name, v] of variables) {
      items.push([v.line, `G ${name}${v.type ? ':' + v.type : ''}${compactDoc(v.doc)}`]);
    }

    items.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    const hasErrors = tree.rootNode.hasError ? ' [syntax errors]' : '';
    return [`\n@${label} (${lines.length}L)${hasErrors}`, ...items.map(([, text]) => text)].join('\n');
  } finally {
    tree.delete(); // free WASM memory
  }
}

async function summarizeFiles(files, signal) {
  const parser = await getParser();
  const out = [HEADER];
  for (let i = 0; i < files.length; i += 1) {
    if (signal?.aborted) return '';
    if (i % 10 === 0) await tick();
    try {
      const source = await fs.readFile(files[i], 'utf8');
      out.push(summarizeSource(parser, source, files[i]));
    } catch (error) {
      out.push(`@${files[i]} ERROR ${error.message}`);
    }
  }
  return out.join('\n');
}

module.exports = { summarizeFiles };