'use strict';

// Opens the Raspberry Pi dashboard in its own window, with the Pi icon and its
// own taskbar identity, so it can be pinned beside the Windows monitor.
//   electron src/pi-viewer.js [--url=http://192.168.1.155:18765]

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const DEFAULT_URL = 'http://192.168.1.155:18765';
// Must match System.AppUserModel.ID on the "Wyze Monitor Pi" shortcut.
const APP_USER_MODEL_ID = 'WyzeCameraMonitor.Pi';

const urlArg = process.argv.find((arg) => arg.startsWith('--url='));
const DASHBOARD_URL = urlArg ? urlArg.slice('--url='.length) : DEFAULT_URL;
const ORIGIN = new URL(DASHBOARD_URL).origin;

if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
app.setName('Wyze Monitor Pi');

let mainWindow = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
      width: 1800,
      height: 1050,
      minWidth: 1180,
      minHeight: 760,
      backgroundColor: '#070a0e',
      title: 'Wyze Monitor Pi',
      icon: path.join(__dirname, '..', 'assets', 'icons', 'pi', 'wyze-monitor.ico'),
      autoHideMenuBar: true,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });

    // Keep the window on the dashboard; anything else opens in the browser.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== ORIGIN) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });

    // Timelapse and recording downloads go to Downloads, like the browser.
    mainWindow.webContents.session.on('will-download', (_event, item) => {
      item.setSavePath(path.join(app.getPath('downloads'), item.getFilename()));
      item.once('done', (_e, state) => {
        if (state === 'completed') shell.showItemInFolder(item.getSavePath());
      });
    });

    mainWindow.webContents.on('did-fail-load', (_e, code, description) => {
      if (code === -3) return; // aborted by a redirect/navigation
      const message = `Could not reach the Raspberry Pi dashboard at ${DASHBOARD_URL} (${description}). Check the Pi is powered on and on the network.`;
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
        `<body style="background:#070a0e;color:#e8eef5;font:15px Segoe UI,sans-serif;padding:40px">
         <h2>Wyze Monitor Pi</h2><p>${message}</p>
         <button onclick="location.href='${DASHBOARD_URL}'" style="font:inherit;padding:8px 16px">Retry</button></body>`,
      )}`);
    });

    // The dashboard page is titled "Wyze Monitor"; keep this window distinguishable.
    mainWindow.on('page-title-updated', (event) => event.preventDefault());
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.loadURL(DASHBOARD_URL);
  });

  app.on('window-all-closed', () => app.quit());
}
