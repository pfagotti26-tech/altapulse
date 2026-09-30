const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulse', {
  login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getState: () => ipcRenderer.invoke('state:get'),
  snapshot: () => ipcRenderer.invoke('state:snapshot'),

  openProfile: (id, platform) => ipcRenderer.invoke('profile:open', id, platform),
  vaultUse: (id) => ipcRenderer.invoke('vault:use', id),
  showProfile: (id) => ipcRenderer.invoke('profile:show', id),
  closeProfile: (id) => ipcRenderer.invoke('profile:close', id),
  reloadProfile: (id) => ipcRenderer.invoke('profile:reload', id),
  backProfile: (id) => ipcRenderer.invoke('profile:back', id),
  clearProfile: (id, what) => ipcRenderer.invoke('profile:clear', { id, what }),
  hideAll: () => ipcRenderer.invoke('profile:hideAll'),
  calibrate: (id) => ipcRenderer.invoke('profile:calibrate', id),
  readExtrato: (id) => ipcRenderer.invoke('extrato:read', id),
  toggleExtrato: (id) => ipcRenderer.invoke('extrato:toggle', id),

  startShift: (creatorId) => ipcRenderer.invoke('shift:start', creatorId),
  shiftAction: (shiftId, action) => ipcRenderer.invoke('shift:action', { shiftId, action }),

  setCreatorLocal: (id, patch) => ipcRenderer.invoke('local:setCreator', { id, patch }),
  setGroups: (groups) => ipcRenderer.invoke('local:setGroups', groups),
  setTags: (tags) => ipcRenderer.invoke('local:setTags', tags),
  setOrigin: (origin) => ipcRenderer.invoke('config:setOrigin', origin),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  appInfo: () => ipcRenderer.invoke('app:info'),

  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onToast: (fn) => ipcRenderer.on('toast', (_e, m) => fn(m)),
});
