const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');

let server, window;
if (process.env.FIGURA_USER_DATA) app.setPath('userData', process.env.FIGURA_USER_DATA);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    process.env.FIGURA_DOCUMENTS = path.join(app.getPath('documents'), 'Figura');
    await fs.mkdir(process.env.FIGURA_DOCUMENTS, { recursive: true });
    const { createServer } = await import(pathToFileURL(path.join(__dirname, '..', 'server.js')).href);
    server = createServer();
    // A stable origin preserves IndexedDB projects across launches.
    const port = Number(process.env.FIGURA_PORT || 14317);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({
      width: 1500, height: 1000, minWidth: 1100, minHeight: 760,
      title: 'Figura SVG Studio', backgroundColor: '#f7f8f2', show: false,
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.once('ready-to-show', () => window.show());
    await window.loadURL(origin);
  }).catch(error => {
    dialog.showErrorBox('Figura 无法启动', error.code === 'EADDRINUSE'
      ? '桌面服务端口已被占用。请关闭其他 Figura 实例，或通过 FIGURA_PORT 设置固定的备用端口。'
      : error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { server?.closeAllConnections(); server?.close(); });
}
