// Ponte mínima entre a página e o programa: só permite trazer a janela para a frente.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rotinaDesktop', {
  show: () => ipcRenderer.send('show')
});
