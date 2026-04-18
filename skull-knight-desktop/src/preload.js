const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("Skull Knight", {
  getSavedConnection: () => ipcRenderer.invoke("get-saved-connection"),
  getPendingError: () => ipcRenderer.invoke("get-pending-error"),
  connectToServer: (opts) => ipcRenderer.invoke("connect-to-server", opts),
  goBackToConnect: () => ipcRenderer.invoke("go-back-to-connect"),
});
