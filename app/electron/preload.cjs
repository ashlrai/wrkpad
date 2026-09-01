const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('agentBoard', {
  getStatus: () => ipcRenderer.invoke('board:getStatus'),
  getMissionControl: () => ipcRenderer.invoke('board:getMissionControl'),
  focusAgentSlot: (slot) => ipcRenderer.invoke('board:focusAgentSlot', slot),
  setProfile: (profile) => ipcRenderer.invoke('board:setProfile', profile),
  setFlightCheck: (active) => ipcRenderer.invoke('board:setFlightCheck', active),
  restartFlightCheck: () => ipcRenderer.invoke('board:restartFlightCheck'),
  requestAction: (actionId) => ipcRenderer.invoke('board:requestAction', actionId),
  confirmAction: (actionId, token) => ipcRenderer.invoke('board:confirmAction', actionId, token),
  beginHold: (actionId, token) => ipcRenderer.invoke('board:beginHold', actionId, token),
  cancelHold: (actionId, token) => ipcRenderer.invoke('board:cancelHold', actionId, token),
  chooseWorkspace: () => ipcRenderer.invoke('board:chooseWorkspace'),
  saveFlightReceipt: (receipt) => ipcRenderer.invoke('board:saveFlightReceipt', receipt),
  onControl: (callback) => {
    const listener = (_event, signal) => callback(signal)
    ipcRenderer.on('board:control', listener)
    return () => ipcRenderer.removeListener('board:control', listener)
  },
})
