const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spareDesktop", Object.freeze({
  getStatus: () => ipcRenderer.invoke("runtime:get-status"),
  start: () => ipcRenderer.invoke("runtime:start"),
  installRuntime: () => ipcRenderer.invoke("runtime:install"),
  restartComputer: () => ipcRenderer.invoke("runtime:restart"),
  exportDiagnostics: () => ipcRenderer.invoke("runtime:diagnostics"),
  openDiagnostics: () => ipcRenderer.invoke("runtime:open-diagnostics"),
  onProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("runtime:progress", handler);
    return () => ipcRenderer.removeListener("runtime:progress", handler);
  },
}));
