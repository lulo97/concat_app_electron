const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const window = new BrowserWindow({
    width: Math.max(960, Math.floor(width * 0.9)),
    height: Math.max(640, Math.floor(height * 0.9)),
    minWidth: 960,
    minHeight: 640,
    title: 'Folder Concatenator',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('select-folders', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections'],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('show-large-file-warning', async (event, fileName, fileSizeMB) => {
  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Continue', 'Skip File & Add to Exclude', 'Stop Process'],
    defaultId: 0,
    cancelId: 2,
    title: 'Large File Detected',
    message: `The file "${path.basename(String(fileName))}" is ${Number(fileSizeMB).toFixed(2)} MB.`,
    detail: 'Large files can use substantial memory while being concatenated. What would you like to do?',
  });
  return result.response;
});

ipcMain.handle('pick-config-folder', async (event, folderPaths) => {
  if (!Array.isArray(folderPaths) || folderPaths.length === 0) return null;
  const buttons = folderPaths.map((folderPath) => (
    String(folderPath).replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/')
  ));
  buttons.push('Cancel');
  const result = await dialog.showMessageBox({
    type: 'question',
    title: 'Save .concatignore',
    message: 'Which folder should the config be saved into?',
    detail: 'The .concatignore file will be written to the root of the selected folder.',
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });
  return result.response >= 0 && result.response < folderPaths.length
    ? folderPaths[result.response]
    : null;
});

app.setPath('sessionData', path.join(app.getPath('userData'), 'sessionData'));
app.commandLine.appendSwitch('disable-http-cache');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
