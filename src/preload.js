'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveRecording: (buffer, filename) => ipcRenderer.invoke('save-recording', { buffer, filename }),
});
