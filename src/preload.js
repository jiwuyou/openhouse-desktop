const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openhouse", {
  listApps: () => ipcRenderer.invoke("apps:list"),
  getServiceStatuses: () => ipcRenderer.invoke("services:status"),
  serviceAction: (serviceId, action) => ipcRenderer.invoke("services:action", serviceId, action),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url)
});
