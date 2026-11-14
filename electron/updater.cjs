// Atualização automática do app do Windows.
// Procura versão nova ao abrir e a cada 4 horas, baixa em segundo plano só o que mudou
// (o instalador publica um .blockmap) e instala quando você fecha a janela para a bandeja,
// ou pelo menu da bandeja / clicando no aviso. Instalação silenciosa, sem pedir administrador.
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

const FOUR_HOURS = 4 * 60 * 60 * 1000;

function setupUpdater({ app, notify, beforeInstall, onChange }) {
  const feed = process.env.ROTINA_UPDATE_URL; // só para teste, e só fora do app instalado
  if (!app.isPackaged && !feed) return { enabled: false, checkNow() {}, install() {}, state: () => ({}) };
  if (!app.isPackaged && feed) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    autoUpdater.forceDevUpdateConfig = true;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // se você fechar de vez pelo menu "Sair", instala
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;

  const st = { checking: false, ready: '', error: '' };
  const change = () => { if (onChange) onChange(st); };

  autoUpdater.on('checking-for-update', () => { st.checking = true; change(); });
  autoUpdater.on('update-not-available', () => { st.checking = false; st.error = ''; change(); });
  autoUpdater.on('error', (e) => { st.checking = false; st.error = String((e && e.message) || e); change(); });
  autoUpdater.on('update-downloaded', (info) => {
    st.checking = false; st.ready = info.version; st.error = '';
    change();
    if (notify) notify('Atualização ' + info.version + ' pronta', 'Ela será instalada quando você fechar a janela. Clique aqui para instalar agora.', install);
  });

  function checkNow() {
    if (st.checking || st.ready) return;
    // Falha de rede ou de download já chega pelo evento 'error'; aqui só evita rejeição solta.
    autoUpdater.checkForUpdates()
      .then((r) => { if (r && r.downloadPromise) r.downloadPromise.catch(() => {}); })
      .catch(() => {});
  }

  function install() {
    if (!st.ready) return;
    try {
      // Depois de instalar, o app reabre; o marcador faz ele reabrir escondido se estava escondido.
      fs.writeFileSync(path.join(app.getPath('userData'), 'relaunch-hidden'), String(Date.now()));
    } catch (e) { /* sem marcador, a janela só abre normalmente */ }
    if (beforeInstall) beforeInstall();
    autoUpdater.quitAndInstall(true, true);
  }

  setTimeout(checkNow, 20 * 1000);
  setInterval(checkNow, FOUR_HOURS).unref();

  return { enabled: true, checkNow, install, state: () => st };
}

/* Verdadeiro se o app acabou de ser reaberto por uma atualização que começou escondida. */
function consumeHiddenFlag(app) {
  const f = path.join(app.getPath('userData'), 'relaunch-hidden');
  try {
    const t = Number(fs.readFileSync(f, 'utf8'));
    fs.unlinkSync(f);
    return Date.now() - t < 2 * 60 * 1000;
  } catch (e) {
    return false;
  }
}

module.exports = { setupUpdater, consumeHiddenFlag };
