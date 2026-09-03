const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('agentBoard', {
  getStatus: () => ipcRenderer.invoke('board:getStatus'),
  getMissionControl: () => ipcRenderer.invoke('board:getMissionControl'),
  getRecoveryGuide: () => ipcRenderer.invoke('board:getRecoveryGuide'),
  getNativeAcceptance: () => ipcRenderer.invoke('board:getNativeAcceptance'),
  prepareNativeAcceptance: () => ipcRenderer.invoke('board:prepareNativeAcceptance'),
  acceptNativeAcceptance: (attestations) => ipcRenderer.invoke('board:acceptNativeAcceptance', attestations),
  clearNativeAcceptance: () => ipcRenderer.invoke('board:clearNativeAcceptance'),
  getNativeControlCheck: () => ipcRenderer.invoke('board:getNativeControlCheck'),
  saveNativeControlCheck: (report) => ipcRenderer.invoke('board:saveNativeControlCheck', report),
  setBoardRoute: (boardRoute) => ipcRenderer.invoke('board:setBoardRoute', boardRoute),
  focusAgentSlot: (slot) => ipcRenderer.invoke('board:focusAgentSlot', slot),
  focusAttention: () => ipcRenderer.invoke('board:focusAttention'),
  showCompactDeck: () => ipcRenderer.invoke('board:showCompactDeck'),
  setProfile: (profile) => ipcRenderer.invoke('board:setProfile', profile),
  setFlightCheck: (active, variant) => ipcRenderer.invoke('board:setFlightCheck', active, variant),
  restartFlightCheck: (variant) => ipcRenderer.invoke('board:restartFlightCheck', variant),
  requestAction: (actionId) => ipcRenderer.invoke('board:requestAction', actionId),
  confirmAction: (actionId, token) => ipcRenderer.invoke('board:confirmAction', actionId, token),
  beginHold: (actionId, token) => ipcRenderer.invoke('board:beginHold', actionId, token),
  cancelHold: (actionId, token) => ipcRenderer.invoke('board:cancelHold', actionId, token),
  chooseWorkspace: () => ipcRenderer.invoke('board:chooseWorkspace'),
  createCorrectedInputProfile: () => ipcRenderer.invoke('board:createCorrectedInputProfile'),
  revealRecoveryArtifact: () => ipcRenderer.invoke('board:revealRecoveryArtifact'),
  copyRecoveryChecklist: () => ipcRenderer.invoke('board:copyRecoveryChecklist'),
  dismissRecoveryHandoff: () => ipcRenderer.invoke('board:dismissRecoveryHandoff'),
  openInputMonitoringSettings: () => ipcRenderer.invoke('board:openInputMonitoringSettings'),
  saveFlightReceipt: (receipt) => ipcRenderer.invoke('board:saveFlightReceipt', receipt),
  onControl: (callback) => {
    const listener = (_event, signal) => callback(signal)
    ipcRenderer.on('board:control', listener)
    return () => ipcRenderer.removeListener('board:control', listener)
  },
})
