const $ = window.jQuery;
const path = require('path');
const { ipcRenderer } = require('electron');
const state = require('./state');
const { applyConfig, loadConfig } = require('./config');
const {
  renderFolders,
  refreshDetection,
  showToast,
  updateConflictUI,
  updateMetadata,
  syncSearchModeLabel,
  syncExtractUi,
} = require('./ui');

async function addFolders() {
  try {
    const selectedPaths = await ipcRenderer.invoke('select-folders');
    if (!Array.isArray(selectedPaths) || !selectedPaths.length) return;

    for (const folderPath of selectedPaths) {
      const resolved = path.resolve(folderPath);
      if (!state.folders.some((folder) => path.resolve(folder.path) === resolved)) {
        state.folders.push({ path: resolved, enabled: true });
      }
    }

    const loadedConfigs = [];
    for (const folderPath of selectedPaths) {
      const config = await loadConfig(folderPath);
      if (config) {
        await applyConfig(config);
        loadedConfigs.push(path.basename(folderPath));
      }
    }

    renderFolders();
    refreshDetection();
    if (loadedConfigs.length) showToast(`Loaded .concatignore from ${loadedConfigs.join(', ')}`);
  } catch (error) {
    alert(`Could not add folders: ${error.message}`);
  }
}

function removeFolder(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.folders.length) return;
  state.folders.splice(index, 1);
  renderFolders();
  refreshDetection();
}

function toggleFolder(index) {
  if (!Number.isInteger(index) || !state.folders[index]) return;
  state.folders[index].enabled = !state.folders[index].enabled;
  refreshDetection();
}

function clearAll() {
  state.abort?.abort();
  state.folders = [];
  state.smartExcludes.clear();
  state.seenNoise.clear();
  state.excludedTypes.clear();
  state.detectedExts = [];
  $('#textContent').val('');
  $('#excludeInput, #includeInput, #contentFilterInput').val('');
  $('#searchModeToggle, #wholeWordToggle').prop('checked', false);
  $('#extractMode').val('block');
  $('#ctxLines').val(10);
  $('#smallFile').val(150);
  $('#keepHead').val(0);
  $('#lineNumbers').prop('checked', true);
  syncSearchModeLabel();
  syncExtractUi();
  updateConflictUI();
  updateMetadata('');
  renderFolders();
  refreshDetection();
}

module.exports = { addFolders, removeFolder, toggleFolder, clearAll };
