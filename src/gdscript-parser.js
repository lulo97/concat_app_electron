// src/gdscript-parser.js
// Line-based GDScript (Godot 4) parser — no native modules, no WASM.
// Extracts: classes, functions, static funcs, signals, consts, vars, exported vars, enums.

const FUNC_RE       = /^(\s*)(?:static\s+)?func\s+([A-Za-z_]\w*)\s*(\([^)]*\))?\s*(?:->\s*([^:\n]+?))?\s*:/;
const CLASS_RE      = /^(\s*)class\s+([A-Za-z_]\w*)(?:\s+extends\s+([\w.]+))?\s*:/;
const CLASS_NAME_RE = /^(\s*)class_name\s+([A-Za-z_]\w*)/;
const EXTENDS_RE    = /^(\s*)extends\s+(.+?)\s*$/;
const SIGNAL_RE     = /^(\s*)signal\s+([A-Za-z_]\w*)\s*(\([^)]*\))?/;
const CONST_RE      = /^(\s*)const\s+([A-Za-z_]\w*)\s*(?::\s*([^=\n]+?))?\s*(?:=|$)/;
const VAR_RE        = /^(\s*)((?:@\w+(?:\([^)]*\))?\s+)*)var\s+([A-Za-z_]\w*)\s*(?::\s*([^=\n]+?))?\s*(?:=|$)/;
const ENUM_RE       = /^(\s*)enum\s+([A-Za-z_]\w*)/;

const isBlank  = (line) => line.trim() === '';
const indentOf = (line) => line.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;

function findBlockEnd(lines, declLine, baseIndent) {
  let end = declLine;
  for (let i = declLine + 1; i < lines.length; i += 1) {
    if (isBlank(lines[i])) continue;
    if (indentOf(lines[i]) <= baseIndent) break;
    end = i;
  }
  return end;
}

// GDScript documentation comments: `## ...` immediately above the declaration.
function extractDocBefore(lines, declLine) {
  const docs = [];
  for (let i = declLine - 1; i >= 0; i -= 1) {
    if (/^\s*##/.test(lines[i])) docs.unshift(lines[i].replace(/^\s*##\s?/, '').trim());
    else break;
  }
  return docs.length ? docs.join(' ').trim() : null;
}

function parseGDScript(source) {
  const lines = source.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();

  const items = [];
  const stack = []; // { name, indent, kind: 'class' | 'func' }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isBlank(line)) continue;
    const indent = indentOf(line);

    // Drop scopes whose body has ended.
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();

    const inFunc    = stack.some((s) => s.kind === 'func');
    const classPath = stack.filter((s) => s.kind === 'class').map((s) => s.name).join('.');
    const prefix    = classPath ? `${classPath}.` : '';

    // ---- Module header ----
    const cnm = CLASS_NAME_RE.exec(line);
    if (cnm && indent === 0) {
      items.push([i + 1, `C ${cnm[2]} (global)`]);
      continue;
    }
    const ext = EXTENDS_RE.exec(line);
    if (ext && indent === 0) {
      const target = ext[2].replace(/^["']|["']$/g, '').trim();
      items.push([i + 1, `I extends ${target}`]);
      continue;
    }

    // ---- Inner class ----
    const cm = CLASS_RE.exec(line);
    if (cm) {
      const blockEnd = findBlockEnd(lines, i, indent);
      items.push([i + 1, `C ${prefix}${cm[2]} (${blockEnd - i + 1}L)`]);
      stack.push({ name: cm[2], indent, kind: 'class' });
      continue;
    }

    // ---- Function ----
    const fm = FUNC_RE.exec(line);
    if (fm) {
      const blockEnd = findBlockEnd(lines, i, indent);
      const isStatic = /\bstatic\s+func\b/.test(line);
      const params   = (fm[3] || '()').replace(/\s+/g, ' ').trim();
      const ret      = fm[4] ? `->${fm[4].trim()}` : '';
      const doc      = extractDocBefore(lines, i);
      const docStr   = doc ? ` ${JSON.stringify(doc)}` : '';
      items.push([i + 1, `${isStatic ? 'F*' : 'F'} ${prefix}${fm[2]}${params}${ret} (${blockEnd - i + 1}L)${docStr}`]);
      stack.push({ name: fm[2], indent, kind: 'func' });
      continue;
    }

    // Locals inside functions are not useful for the summary.
    if (inFunc) continue;

    // ---- Signal ----
    const sm = SIGNAL_RE.exec(line);
    if (sm) {
      items.push([i + 1, `S ${prefix}${sm[2]}${(sm[3] || '').replace(/\s+/g, ' ')}`]);
      continue;
    }

    // ---- Const ----
    const constm = CONST_RE.exec(line);
    if (constm) {
      const type = constm[3] ? `:${constm[3].trim()}` : '';
      items.push([i + 1, `K ${prefix}${constm[2]}${type}`]);
      continue;
    }

    // ---- Variable (optionally with @export / @onready / @export_range(...)) ----
    const vm = VAR_RE.exec(line);
    if (vm) {
      const ann  = vm[2] || '';
      const type = vm[4] ? `:${vm[4].trim()}` : '';
      const tag  = /@export/.test(ann) ? 'E' : 'G';
      items.push([i + 1, `${tag} ${prefix}${vm[3]}${type}`]);
      continue;
    }

    // ---- Enum ----
    const em = ENUM_RE.exec(line);
    if (em) {
      items.push([i + 1, `T ${prefix}${em[2]}`]);
      continue;
    }
  }

  items.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
  return { lines: lines.length, items };
}

module.exports = { parseGDScript };