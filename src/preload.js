const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openhouse", {
  listApps: () => ipcRenderer.invoke("apps:list"),
  openApp: (id) => ipcRenderer.invoke("apps:open", id),
  getServiceStatuses: () => ipcRenderer.invoke("services:status"),
  getRuntimeStatus: () => ipcRenderer.invoke("runtime:status"),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
});
