const $ = window.jQuery;
const state = require('./state');
const actions = require('./actions');
const folders = require('./folders');
const {
  renderFolders,
  renderFileTypes,
  refreshDetection,
  updateConflictUI,
  syncSearchModeLabel,
  syncExtractUi,
} = require('./ui');
const { debounce } = require('./utils');

function init() {
  const refreshFilters = debounce(() => refreshDetection(false), 550);
  const refreshSearch = debounce(() => refreshDetection(false), 700);

  // Header and pinned action buttons.
  $('#addBtn').on('click', folders.addFolders);
  $('#clearBtn').on('click', folders.clearAll);
  $('#listBtn').on('click', actions.listFiles);
  $('#concatBtn').on('click', actions.concatFiles);
  $('#copyBtn').on('click', actions.copyContent);
  $('#saveConfigBtn').on('click', actions.saveConfigAction);
  $('#cancelBtn').on('click', actions.cancelTask);

  // Folder list (delegated so it survives rerendering).
  $('#folderList')
    .on('change', 'input[data-idx]', function () {
      folders.toggleFolder(Number($(this).attr('data-idx')));
    })
    .on('click', 'button[data-remove]', function () {
      folders.removeFolder(Number($(this).attr('data-remove')));
    });

  // Auto-detected exclude chips.
  $('#smartExcludes').on('change', 'input[data-noise]', function () {
    const name = $(this).attr('data-noise');
    if (this.checked) state.smartExcludes.add(name);
    else state.smartExcludes.delete(name);
    refreshFilters();
  });

  // File-type chips.
  $('#fileTypeChips').on('change', 'input[data-ext]', function () {
    const extension = $(this).attr('data-ext');
    if (this.checked) state.excludedTypes.delete(extension);
    else state.excludedTypes.add(extension);
    renderFileTypes();
  });
  $('#incAllTypes').on('click', () => {
    state.excludedTypes.clear();
    renderFileTypes();
  });
  $('#excAllTypes').on('click', () => {
    state.detectedExts.forEach((extension) => state.excludedTypes.add(extension));
    renderFileTypes();
  });

  // Manual include/exclude filters.
  $('#excludeInput, #includeInput').on('input', () => {
    updateConflictUI();
    refreshFilters();
  });

  // Content search affects both the output file list and the detected extensions list.
  $('#contentFilterInput').on('input', refreshSearch);
  $('#wholeWordToggle').on('change', refreshSearch);
  $('#searchModeToggle').on('change', () => {
    syncSearchModeLabel();
    refreshSearch();
  });

  $('#extractMode').on('change', syncExtractUi);
  $('#summarizeBtn').on('click', actions.summarizeProject);
  syncSearchModeLabel();
  syncExtractUi();
  renderFolders();
  renderFileTypes();
}

module.exports = { init };
