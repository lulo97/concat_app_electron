const $ = window.jQuery;
const state = require('./state');
const { findConflicts } = require('./filters');
const { scanNoise, scanExtensions } = require('./scanner');
const { escapeHtml, formatBytes } = require('./utils');

// ---------- Loading / toast / meta ----------
function setLoading(show, html = 'Processing...') {
  $('#loadingOverlay').toggleClass('hidden', !show).toggleClass('flex', show);
  if (show) $('#loadingText').html(html);
}

function setProgress(percent, name) {
  $('#loadingText').html(
    `<div class="font-semibold text-primary">Processing ${percent}%</div>` +
    `<div class="mt-1 max-w-md truncate text-xs text-slate-500">Current: ${escapeHtml(name)}</div>`,
  );
}

let toastTimer;
function showToast(message, ms = 3000) {
  const $t = $('#toast').text(message).removeClass('opacity-0 translate-y-4');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $t.addClass('opacity-0 translate-y-4'), ms);
}

function updateMetadata(text) {
  const $m = $('#metaInfo');
  if (!text || !text.trim()) return $m.addClass('hidden').removeClass('flex');
  $('#metaLines').text(text.split(/\r\n|\r|\n/).length.toLocaleString());
  $('#metaWords').text(text.trim().split(/\s+/).filter(Boolean).length.toLocaleString());
  $('#metaSize').text(formatBytes(new Blob([text]).size));
  $m.removeClass('hidden').addClass('flex');
}

function setOutput(text) {
  $('#textContent').val(text);
  updateMetadata(text);
}

// ---------- Conflicts ----------
function updateConflictUI() {
  const conflicts = findConflicts();
  const $el = $('#conflictWarning');
  if (!conflicts.length) { $el.addClass('hidden').empty(); return conflicts; }
  $el.removeClass('hidden').html(
    `<strong class="block mb-1">⚠️ Conflict Detected</strong>` +
    `These names appear in BOTH Manual Includes and Manual Excludes:<br>` +
    conflicts.map((c) => `<code class="mr-1 inline-block rounded border border-red-300 bg-red-100 px-1.5 font-mono text-[11px]">${escapeHtml(c)}</code>`).join('') +
    `<div class="mt-1 text-[11px] text-red-700">Remove them from one list before running List / Concat / Copy.</div>`,
  );
  return conflicts;
}

function blockOnConflict() {
  const conflicts = updateConflictUI();
  if (!conflicts.length) return false;
  alert('Cannot proceed — these names appear in both Manual Includes and Manual Excludes:\n\n- ' +
    conflicts.join('\n- ') + '\n\nRemove them from one list and try again.');
  return true;
}

// ---------- Renderers ----------
function renderFolders() {
  const $list = $('#folderList').empty();
  if (!state.folders.length) {
    $list.append('<li class="px-3 py-3 text-xs text-slate-400">No folders added yet.</li>');
    return;
  }
  state.folders.forEach((f, i) => {
    const $li = $('<li class="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-[13px] last:border-b-0">');
    $('<input type="checkbox" class="shrink-0 cursor-pointer accent-primary">').attr('data-idx', i).prop('checked', f.enabled).appendTo($li);
    $('<span class="min-w-0 flex-1 break-all">').text(f.path).attr('title', f.path).appendTo($li);
    $('<button type="button" class="shrink-0 rounded px-2 py-1 text-xs text-slate-500 hover:bg-red-100 hover:text-red-500">Delete</button>')
      .attr('data-remove', i).appendTo($li);
    $list.append($li);
  });
}

function renderSmartExcludes(noise) {
  const $c = $('#smartExcludes').empty();
  if (!noise.size) return $c.append('<span class="text-xs text-slate-400">Nothing detected.</span>');
  [...noise].sort().forEach((name) => {
    $('<label class="chip">')
      .append($('<input type="checkbox">').attr('data-noise', name).prop('checked', state.smartExcludes.has(name)))
      .append(document.createTextNode(name))
      .appendTo($c);
  });
}

function renderFileTypes() {
  const $c = $('#fileTypeChips').empty();
  if (!state.folders.some((f) => f.enabled)) return $c.append('<span class="text-xs text-slate-400">No folders selected yet.</span>');
  if (!state.detectedExts.length) return $c.append('<span class="text-xs text-slate-400">No text file types found.</span>');
  state.detectedExts.forEach((ext) => {
    const off = state.excludedTypes.has(ext);
    $('<label class="chip">').toggleClass('chip-off', off).attr('title', `${ext} files are ${off ? 'excluded' : 'included'}`)
      .append($('<input type="checkbox">').attr('data-ext', ext).prop('checked', !off))
      .append(document.createTextNode(ext))
      .appendTo($c);
  });
}

// ---------- Detection (race-safe) ----------
let detectToken = 0;
let detectController = null;
async function refreshDetection(scanNoiseToo = true) {
  const token = ++detectToken;
  detectController?.abort();
  detectController = new AbortController();
  const signal = detectController.signal;
  const dirs = state.folders.filter((f) => f.enabled).map((f) => f.path);

  if (scanNoiseToo) {
    const noise = await scanNoise(dirs, signal);
    if (signal.aborted || token !== detectToken) return;
    noise.forEach((name) => {
      if (!state.seenNoise.has(name)) {
        state.seenNoise.add(name);
        state.smartExcludes.add(name);
      }
    });
    renderSmartExcludes(noise);
  }

  const extensions = await scanExtensions(dirs, signal);
  if (signal.aborted || token !== detectToken) return;
  state.detectedExts = [...extensions].sort();
  renderFileTypes();
}

// ---------- Small UI syncs ----------
function syncSearchModeLabel() {
  $('#searchModeLabel').text($('#searchModeToggle').prop('checked')
    ? 'AND mode (all keywords must match)' : 'OR mode (any keyword matches)');
}

function syncExtractUi() {
  const full = $('#extractMode').val() === 'full';
  $('#extractOptions').toggleClass('opacity-50', full).find('input').prop('disabled', full);
  $('#extractHint').text({
    full: 'Whole files are included.',
    context: 'Only lines matching a keyword, plus N lines around each, are included.',
    block: 'The whole function/class containing each match is included (falls back to ± N lines).',
  }[$('#extractMode').val()]);
}

module.exports = {
  setLoading, setProgress, showToast, updateMetadata, setOutput,
  updateConflictUI, blockOnConflict,
  renderFolders, renderFileTypes, refreshDetection,
  syncSearchModeLabel, syncExtractUi,
};
