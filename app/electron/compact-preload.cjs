const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('compactDeck', {
  getSnapshot: () => ipcRenderer.invoke('compact:getSnapshot'),
  focusAgentSlot: (slot) => ipcRenderer.invoke('compact:focusAgentSlot', slot),
  runSkillAction: (actionId) => ipcRenderer.invoke('compact:runSkillAction', actionId),
  runWorkflowAction: (actionId) => ipcRenderer.invoke('compact:runWorkflowAction', actionId),
  getPreferences: () => ipcRenderer.invoke('compact:getPreferences'),
  savePreferences: (preferences) => ipcRenderer.invoke('compact:savePreferences', preferences),
  hide: () => ipcRenderer.invoke('compact:hide'),
  onSnapshot: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot)
    ipcRenderer.on('compact:snapshot', listener)
    return () => ipcRenderer.removeListener('compact:snapshot', listener)
  },
})
