const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // For simplicity in this example
    }
  });
  win.loadFile('index.html');
}

// Handle the Multi-Folder Selection
ipcMain.handle('select-folders', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections']
  });
  return result.filePaths; // Returns an array of paths
});

ipcMain.handle('show-warning', async (event, message) => {
  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Continue', 'Clear List'],
    defaultId: 0,
    title: 'Warning',
    message: message,
  });
  return result.response; // 0 for Continue, 1 for Clear
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

app.whenReady().then(createWindow);