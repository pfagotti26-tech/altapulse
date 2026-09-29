const { contextBridge, ipcRenderer } = require('electron');

// Interface mínima; nunca é instalada na página Privacy.
contextBridge.exposeInMainWorld('altaDesktop', Object.freeze({
  installed: true,
  info: () => ipcRenderer.invoke('alta:info'),
  authorize: ticket => ipcRenderer.invoke('alta:authorize', String(ticket)),
  register: () => ipcRenderer.invoke('alta:register'),
  open: creatorId => ipcRenderer.invoke('alta:open', String(creatorId)),
  close: () => ipcRenderer.invoke('alta:close'),
  navigationStatusVersion: 1,
  layout: rect => ipcRenderer.send('alta:layout', rect),
  navigate: action => ipcRenderer.invoke('alta:navigate', String(action)),
  onState: callback => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('alta:state', handler);
    return () => ipcRenderer.removeListener('alta:state', handler);
  }
}));