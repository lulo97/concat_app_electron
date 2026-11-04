// Extracts only the regions relevant to Content Search while preserving source line locations.
const path = require('path');
const { PY_EXTS, BRACE_EXTS } = require('./constants');

const MAX_BLOCK_LINES = 300;
const PY_DEF = /^\s*(?:async\s+def|def|class)\s+[A-Za-z_]\w*/;
const PY_DECORATOR_OR_COMMENT = /^\s*(?:@|#)/;
const BRACE_DECORATOR_OR_COMMENT = /^\s*(?:@|\/\/|\/\*|\*|#\[)/;
const CONTROL_HEADER = /^\s*(?:\}\s*)?(?:if|else|for|while|switch|case|catch|try|do|with|synchronized|finally|return)\b/;
const BRACE_HEADER = /\b(?:function|class|interface|struct|enum|impl|trait|fn|func|namespace)\b|\)\s*(?:(?:->|:)\s*[\w<>\[\],.|?&\s]+)?\{|=>\s*\{/;

const isBlank = (line) => line.trim() === '';
const indentOf = (line) => line.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;

function extendUp(lines, start, pattern) {
  let index = start;
  while (index > 0 && pattern.test(lines[index - 1])) index -= 1;
  return index;
}

// Python block detection uses indentation and returns the nearest enclosing def/class.
function findPythonBlock(lines, hitLine) {
  let declaration = -1;
  if (PY_DEF.test(lines[hitLine])) {
    declaration = hitLine;
  } else if (!isBlank(lines[hitLine])) {
    let currentIndent = indentOf(lines[hitLine]);
    for (let index = hitLine - 1; index >= 0 && currentIndent > 0; index -= 1) {
      if (isBlank(lines[index])) continue;
      const candidateIndent = indentOf(lines[index]);
      if (candidateIndent < currentIndent) {
        currentIndent = candidateIndent;
        if (PY_DEF.test(lines[index])) {
          declaration = index;
          break;
        }
      }
    }
  }
  if (declaration < 0) return null;

  const baseIndent = indentOf(lines[declaration]);
  let end = declaration;
  for (let index = declaration + 1; index < lines.length; index += 1) {
    if (isBlank(lines[index])) continue;
    // A continued signature can contain a closing delimiter at the declaration indent.
    if (indentOf(lines[index]) <= baseIndent && !/^\s*[)\]}]/.test(lines[index])) break;
    end = index;
  }

  return {
    start: extendUp(lines, declaration, PY_DECORATOR_OR_COMMENT),
    end,
  };
}

function findQuotedStringEnd(line, start) {
  for (let index = start + 1; index < line.length; index += 1) {
    if (line[index] === '\\') {
      index += 1;
    } else if (line[index] === line[start]) {
      return index;
    }
  }
  return -1;
}

// Lightweight lexer: ignores braces inside comments and ordinary quoted strings.
function findBracePairs(lines) {
  const pairs = [];
  const stack = [];
  let inBlockComment = false;
  let inTemplate = false;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (inBlockComment) {
        if (char === '*' && next === '/') {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }
      if (inTemplate) {
        if (char === '\\') index += 1;
        else if (char === '`') inTemplate = false;
        continue;
      }
      if (char === '/' && next === '/') break;
      if (char === '/' && next === '*') {
        inBlockComment = true;
        index += 1;
        continue;
      }
      if (char === '`') {
        inTemplate = true;
        continue;
      }
      if (char === '"' || char === "'") {
        const quoteEnd = findQuotedStringEnd(line, index);
        if (quoteEnd >= 0) index = quoteEnd;
        continue;
      }
      if (char === '{') {
        stack.push(lineNumber);
      } else if (char === '}') {
        const start = stack.pop();
        if (start !== undefined) pairs.push({ start, end: lineNumber });
      }
    }
  }
  return pairs;
}

// Return the line containing the opening parenthesis for a multi-line signature.
function findSignatureStart(lines, fromLine) {
  let balance = 0;
  const minLine = Math.max(0, fromLine - 50);
  for (let lineNumber = fromLine; lineNumber >= minLine; lineNumber -= 1) {
    const line = lines[lineNumber];
    for (let index = line.length - 1; index >= 0; index -= 1) {
      if (line[index] === ')') balance += 1;
      else if (line[index] === '(') {
        balance -= 1;
        if (balance <= 0) return lineNumber;
      }
    }
  }
  return fromLine;
}

function getBraceHeader(lines, braceLine) {
  let end = braceLine;
  let start = braceLine;
  const openingBraceIndex = lines[braceLine].indexOf('{');
  const currentPrefix = openingBraceIndex >= 0
    ? lines[braceLine].slice(0, openingBraceIndex)
    : lines[braceLine];

  // Allman style puts the opening brace on a line by itself.
  if (currentPrefix.trim() === '') {
    end = braceLine - 1;
    while (end >= 0 && isBlank(lines[end])) end -= 1;
    if (end < 0) return null;
    start = end;
  }

  // Include preceding lines when the signature's closing parenthesis is on its own line.
  if (lines[end].includes(')')) start = Math.min(start, findSignatureStart(lines, end));
  const text = lines.slice(start, braceLine + 1).join(' ');
  return { start, text };
}

function findBraceBlock(lines, pairs, hitLine) {
  let best = null;
  for (const pair of pairs) {
    if (pair.end < hitLine || pair.start > hitLine) continue;
    const header = getBraceHeader(lines, pair.start);
    if (!header || CONTROL_HEADER.test(header.text) || !BRACE_HEADER.test(header.text)) continue;
    if (!best || header.start > best.start || (header.start === best.start && pair.end < best.end)) {
      best = { start: header.start, end: pair.end };
    }
  }
  if (!best) return null;
  best.start = extendUp(lines, best.start, BRACE_DECORATOR_OR_COMMENT);
  return best;
}

/**
 * opts: { mode: 'full'|'context'|'block', context, smallFile, keepHead, lineNumbers }
 * Returns { text, total, shown, trimmed }.
 */
function extractRelevant(content, filePath, matchers, opts) {
  const lines = content.split(/\r\n|\r|\n/);
  const total = lines.length;
  const wholeFile = { text: content, total, shown: total, trimmed: false };
  if (opts.mode === 'full' || !matchers.length || total <= opts.smallFile) return wholeFile;

  const hits = [];
  for (let lineNumber = 0; lineNumber < total; lineNumber += 1) {
    if (matchers.some((matcher) => matcher.test(lines[lineNumber]))) hits.push(lineNumber);
  }
  if (!hits.length) return wholeFile;

  const extension = path.extname(filePath).toLowerCase();
  const isPython = PY_EXTS.has(extension);
  const isBraceLanguage = BRACE_EXTS.has(extension);
  const bracePairs = opts.mode === 'block' && isBraceLanguage ? findBracePairs(lines) : null;
  const ranges = [];
  const contextRange = (lineNumber) => [
    Math.max(0, lineNumber - opts.context),
    Math.min(total - 1, lineNumber + opts.context),
  ];

  for (const hitLine of hits) {
    let range = null;
    if (opts.mode === 'block') {
      const block = isPython
        ? findPythonBlock(lines, hitLine)
        : isBraceLanguage
          ? findBraceBlock(lines, bracePairs, hitLine)
          : null;

      if (block) {
        if (block.end - block.start + 1 <= MAX_BLOCK_LINES) {
          range = [block.start, block.end];
        } else {
          // Extremely large blocks: keep the declaration and local match context.
          ranges.push([block.start, block.start]);
        }
      }
    }
    ranges.push(range || contextRange(hitLine));
  }

  if (opts.keepHead > 0) ranges.push([0, Math.min(total - 1, opts.keepHead - 1)]);
  ranges.sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range[0] <= previous[1] + 1) {
      previous[1] = Math.max(previous[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }

  const lineWidth = String(total).length;
  const output = [];
  let previousEnd = -1;
  let shown = 0;
  const addOmission = (start, end) => {
    if (end >= start) output.push(`... [lines ${start + 1}-${end + 1} omitted] ...`);
  };

  for (const [start, end] of merged) {
    addOmission(previousEnd + 1, start - 1);
    for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
      const line = lines[lineNumber];
      output.push(opts.lineNumbers ? `${String(lineNumber + 1).padStart(lineWidth)}: ${line}` : line);
    }
    shown += end - start + 1;
    previousEnd = end;
  }
  addOmission(previousEnd + 1, total - 1);

  return {
    text: output.join('\n'),
    total,
    shown,
    trimmed: shown < total,
  };
}

module.exports = { extractRelevant, findPythonBlock, findBracePairs, findBraceBlock };
