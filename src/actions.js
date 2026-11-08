const $ = window.jQuery;
const path = require('path');
const { clipboard } = require('electron');
const state = require('./state');
const { getFiles } = require('./scanner');
const { buildOutput } = require('./builder');
const { saveConfig } = require('./config');
const { setLoading, setOutput, showToast, blockOnConflict } = require('./ui');
const { formatTimestamp } = require('./utils');
const { summarizeFiles } = require('./summarizer');

const hasEnabledFolders = () => state.folders.some((folder) => folder.enabled);

function flash($button, label, className = 'is-success', duration = 2000) {
  if ($button.data('original-label') === undefined) {
    $button.data('original-label', $button.text());
  }
  clearTimeout($button.data('flash-timer'));
  $button.text(label).removeClass('is-success is-error').addClass(className);
  $button.data('flash-timer', setTimeout(() => {
    $button
      .text($button.data('original-label'))
      .removeClass('is-success is-error');
  }, duration));
}

async function runTask(initialStatus, task) {
  if (state.abort) return;
  const controller = new AbortController();
  state.abort = controller;
  setLoading(true, initialStatus);
  try {
    await task(controller.signal);
  } catch (error) {
    console.error(error);
    if (!controller.signal.aborted) alert(`Error: ${error.message}`);
  } finally {
    setLoading(false);
    if (state.abort === controller) state.abort = null;
  }
}

function cancelTask() {
  if (!state.abort) return;
  state.abort.abort();
  setLoading(false);
  showToast('Process cancelled.');
}

const updateStatus = (message) => $('#loadingText').text(message);

function listFiles() {
  if (!hasEnabledFolders()) return alert('Please add or enable at least one folder first.');
  if (blockOnConflict()) return;

  return runTask('Scanning folders...', async (signal) => {
    const files = await getFiles(signal, updateStatus);
    if (signal.aborted) return;
    setOutput(`Total Files: ${files.length}\n\n${files.join('\n')}`);
  });
}

function concatFiles() {
  if (!hasEnabledFolders()) return alert('Please add or enable at least one folder first.');
  if (blockOnConflict()) return;

  return runTask('Scanning folders...', async (signal) => {
    const files = await getFiles(signal, updateStatus);
    if (signal.aborted) return;
    if (!files.length) {
      alert('No files matched the current filters.');
      return;
    }

    const result = await buildOutput(files, signal);
    if (result.aborted || signal.aborted) return;
    setOutput(result.combined || 'No readable content found.');
    if (result.stopped) {
      showToast('Stopped early — showing partial output.');
    } else if (result.linesTotal > result.linesShown) {
      showToast(`Trimmed ${result.linesTotal.toLocaleString()} → ${result.linesShown.toLocaleString()} source lines`);
    }
  });
}

function copyContent() {
  if (!hasEnabledFolders()) return alert('Please add or enable at least one folder first.');
  if (blockOnConflict()) return;

  const $button = $('#copyBtn');
  return runTask('Refreshing and copying...', async (signal) => {
    try {
      const files = await getFiles(signal, updateStatus);
      if (signal.aborted) return;
      if (!files.length) {
        alert('No files matched the current filters.');
        return;
      }

      const result = await buildOutput(files, signal);
      if (result.aborted || signal.aborted) return;
      const content = result.combined || 'No readable content found.';
      clipboard.writeText(content);
      const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
      if (normalizeNewlines(clipboard.readText()) !== normalizeNewlines(content)) {
        throw new Error('Clipboard verification failed (content mismatch or access denied).');
      }

      setOutput(content);
      flash($button, 'Copied! ✓');
      const newestText = result.newest
        ? `Newest file: ${path.basename(result.newest.path)} (${formatTimestamp(new Date(result.newest.mtimeMs))})`
        : 'No file timestamp available.';
      showToast(result.stopped ? `Copied partial output. ${newestText}` : `Copied. ${newestText}`, 4500);
    } catch (error) {
      flash($button, 'Copy Error!', 'is-error', 3000);
      throw error;
    }
  });
}

async function saveConfigAction() {
  if (await saveConfig()) flash($('#saveConfigBtn'), 'Config Saved ✓');
}

function summarizeProject() {
  if (!hasEnabledFolders()) return alert('Please add or enable at least one folder first.');
  if (blockOnConflict()) return;

  return runTask('Scanning folders...', async (signal) => {
    const files = await getFiles(signal, updateStatus);
    if (signal.aborted) return;

    const pyFiles = files.filter((file) => /\.pyw?$/i.test(file));
    if (!pyFiles.length) {
      alert('No Python files matched the current filters.');
      return;
    }

    updateStatus(`Summarising ${pyFiles.length} Python files...`);
    const text = await summarizeFiles(pyFiles, signal);
    if (signal.aborted) return;
    setOutput(text);
  });
}

module.exports = { listFiles, concatFiles, copyContent, cancelTask, saveConfigAction, summarizeProject };