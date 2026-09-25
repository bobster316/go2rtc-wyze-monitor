'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveRecording: (buffer, filename) => ipcRenderer.invoke('save-recording', { buffer, filename }),
  revealTimelapse: (id, name) => ipcRenderer.invoke('reveal-timelapse', id, name),
});
