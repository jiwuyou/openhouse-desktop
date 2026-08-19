const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openhouse", {
  listApps: () => ipcRenderer.invoke("apps:list"),
  openApp: (id, options) => ipcRenderer.invoke("apps:open", id, options),
  listTabs: () => ipcRenderer.invoke("tabs:list"),
  openTab: (appId) => ipcRenderer.invoke("tabs:open", appId),
  closeTab: (tabId) => ipcRenderer.invoke("tabs:close", tabId),
  activateTab: (tabId) => ipcRenderer.invoke("tabs:activate", tabId),
  openNewWindow: (appId) => ipcRenderer.invoke("tabs:new-window", appId),
  getContainerSettings: () => ipcRenderer.invoke("containers:settings"),
  setMaxWebContainers: (value) => ipcRenderer.invoke("containers:set-max", value),
  closeAppWindow: () => ipcRenderer.invoke("app-window:close"),
  onTabsState: (callback) => ipcRenderer.on("tabs:state", (_event, value) => callback(value)),
  onTabsError: (callback) => ipcRenderer.on("tabs:error", (_event, value) => callback(value)),
  getServiceStatuses: () => ipcRenderer.invoke("services:status"),
  getRuntimeStatus: () => ipcRenderer.invoke("runtime:status"),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
});
