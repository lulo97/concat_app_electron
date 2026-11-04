const $ = window.jQuery;
const fs = require('fs').promises;
const path = require('path');
const { ipcRenderer } = require('electron');
const { readSearchSpec } = require('./matchers');
const { extractRelevant } = require('./extractor');
const { setProgress, updateConflictUI } = require('./ui');
const { LARGE_FILE_BYTES } = require('./constants');
const { splitCsv, toInt, tick } = require('./utils');

function readExtractOptions() {
  return {
    mode: $('#extractMode').val(),
    context: toInt($('#ctxLines').val(), 10),
    smallFile: toInt($('#smallFile').val(), 150),
    keepHead: toInt($('#keepHead').val(), 0),
    lineNumbers: $('#lineNumbers').prop('checked'),
  };
}

function addToManualExcludes(name) {
  const current = splitCsv($('#excludeInput').val());
  if (!current.some((value) => value.toLowerCase() === name.toLowerCase())) {
    current.push(name);
    $('#excludeInput').val(current.join(', '));
    updateConflictUI();
  }
}

/** Read, trim, and combine files. The returned counters describe source lines, not headers. */
async function buildOutput(files, signal) {
  const searchSpec = readSearchSpec();
  const extractOptions = readExtractOptions();
  const outputParts = [];
  const skippedNames = new Set();
  let newest = null;
  let stopped = false;
  let totalLines = 0;
  let shownLines = 0;

  for (let index = 0; index < files.length; index += 1) {
    if (signal?.aborted) return { aborted: true };
    const filePath = files[index];
    const fileName = path.basename(filePath);
    if (skippedNames.has(fileName.toLowerCase())) continue;

    try {
      const stat = await fs.stat(filePath);
      if (signal?.aborted) return { aborted: true };

      if (stat.size > LARGE_FILE_BYTES) {
        const choice = await ipcRenderer.invoke(
          'show-large-file-warning',
          fileName,
          stat.size / 1048576,
        );
        if (signal?.aborted) return { aborted: true };
        if (choice === 1) {
          addToManualExcludes(fileName);
          skippedNames.add(fileName.toLowerCase());
          continue;
        }
        if (choice === 2) {
          stopped = true;
          break;
        }
      }

      if (!newest || stat.mtimeMs > newest.mtimeMs) {
        newest = { path: filePath, mtimeMs: stat.mtimeMs };
      }
      setProgress(Math.round(((index + 1) / files.length) * 100), fileName);
      if (index % 4 === 0) await tick();
      if (signal?.aborted) return { aborted: true };

      const content = await fs.readFile(filePath, 'utf8');
      if (signal?.aborted) return { aborted: true };
      const extracted = extractRelevant(content, filePath, searchSpec.matchers, extractOptions);
      totalLines += extracted.total;
      shownLines += extracted.shown;
      const note = extracted.trimmed
        ? ` (showing ${extracted.shown.toLocaleString()} of ${extracted.total.toLocaleString()} lines)`
        : '';
      outputParts.push(`===== ${filePath} =====${note}\n\n${extracted.text}`);
    } catch (error) {
      outputParts.push(`===== ${filePath} =====\n\n[Error reading file: ${error.message}]`);
    }
  }

  return {
    aborted: Boolean(signal?.aborted),
    stopped,
    combined: outputParts.join('\n\n'),
    newest,
    linesTotal: totalLines,
    linesShown: shownLines,
  };
}

module.exports = { buildOutput, readExtractOptions };
