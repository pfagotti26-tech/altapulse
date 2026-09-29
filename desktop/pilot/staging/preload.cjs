const { contextBridge, ipcRenderer } = require('electron');
// Esta bridge existe somente no painel Alta Pulse. O Chrome não carrega preload.
contextBridge.exposeInMainWorld('altaDesktop', Object.freeze({
  installed: true,
  engine: 'chrome-pilot',
  info: () => ipcRenderer.invoke('alta:info'),
  authorize: ticket => ipcRenderer.invoke('alta:authorize', String(ticket)),
  register: () => ipcRenderer.invoke('alta:register'),
  open: creatorId => ipcRenderer.invoke('alta:open', String(creatorId)),
  close: () => ipcRenderer.invoke('alta:close'),
  layout: rect => ipcRenderer.send('alta:layout', rect),
  navigate: action => ipcRenderer.invoke('alta:navigate', String(action)),
  onState: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('alta:state', listener);
    return () => ipcRenderer.removeListener('alta:state', listener);
  }
}));