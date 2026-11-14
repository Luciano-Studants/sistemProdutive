// Rotina Noturna para Windows: abre o app web empacotado numa janela própria.
// Ao fechar a janela, o app continua na bandeja do sistema para os avisos seguirem saindo.
const { app, BrowserWindow, Tray, Menu, protocol, session, shell, nativeImage, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DIST = path.join(__dirname, '..', 'dist');
const ICON = path.join(__dirname, 'icon.png');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Endereço próprio (app://rotina/): o armazenamento local e o login do Supabase ficam estáveis.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let tray = null;
let quitting = false;

function showWin() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#0f1218',
    title: 'Rotina Noturna',
    icon: ICON,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // os avisos continuam com a janela escondida
      autoplayPolicy: 'no-user-gesture-required' // o som do aviso toca sem clique prévio
    }
  });

  win.loadURL('app://rotina/index.html');
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
}

function createTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 });
  tray = new Tray(img);
  tray.setToolTip('Rotina Noturna');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Rotina Noturna', click: showWin },
      { type: 'separator' },
      {
        label: 'Abrir com o Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] })
      },
      { type: 'separator' },
      { label: 'Sair', click: () => { quitting = true; app.quit(); } }
    ])
  );
  tray.on('click', showWin);
}

app.on('second-instance', showWin);
app.on('before-quit', () => { quitting = true; });
// Janela fechada não encerra o app: ele segue na bandeja.
app.on('window-all-closed', () => {});

app.whenReady().then(() => {
  app.setAppUserModelId('com.rotinanoturna.app'); // necessário para as notificações do Windows

  protocol.handle('app', async (request) => {
    const u = new URL(request.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(DIST, p));
    if (!file.startsWith(DIST)) return new Response('Acesso negado', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch (e) {
      return new Response('Não encontrado', { status: 404 });
    }
  });

  // Só notificações são liberadas; qualquer outra permissão é negada.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'notifications'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'notifications');

  ipcMain.on('show', showWin);
  createWindow();
  createTray();
});
