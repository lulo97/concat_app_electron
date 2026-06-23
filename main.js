const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: Math.floor(width * 0.9),
    height: Math.floor(height * 0.9),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  win.center();
  win.loadFile('index.html');
}

// Handle the Multi-Folder Selection
ipcMain.handle('select-folders', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections']
  });
  return result.filePaths;
});

ipcMain.handle('show-warning', async (event, message) => {
  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Continue', 'Clear List'],
    defaultId: 0,
    title: 'Warning',
    message: message,
  });
  return result.response;
});

ipcMain.handle('show-large-file-warning', async (event, fileName, fileSizeMB) => {
  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Continue', 'Skip File & Add to Exclude', 'Stop Process'],
    defaultId: 0,
    cancelId: 2,
    title: 'Large File Detected',
    message: `The file "${fileName}" is ${fileSizeMB.toFixed(2)} MB.`,
    detail: 'Large files can cause the application to hang or crash. What would you like to do?'
  });
  return result.response; // 0: Continue, 1: Skip, 2: Cancel
});

// Let user pick which folder to save .concatignore into (when multiple folders are open)
ipcMain.handle('pick-config-folder', async (event, folderPaths) => {
  // Build a list dialog using button labels (truncated paths)
  const buttons = folderPaths.map((p) => {
    // Show last 2 segments of path to keep labels readable
    const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.slice(-2).join('/');
  });
  buttons.push('Cancel');

  const result = await dialog.showMessageBox({
    type: 'question',
    title: 'Save .concatignore',
    message: 'Which folder should the config be saved into?',
    detail: 'A .concatignore file will be written to the root of the chosen folder.',
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });

  const chosen = result.response;
  if (chosen === folderPaths.length) return null; // Cancel
  return folderPaths[chosen];
});

// Put Electron session/cache data somewhere writable
app.setPath('sessionData', path.join(app.getPath('userData'), 'sessionData'));
app.commandLine.appendSwitch('disable-http-cache');

app.whenReady().then(createWindow);