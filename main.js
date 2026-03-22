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

app.whenReady().then(createWindow);