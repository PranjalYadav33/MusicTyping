const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  youtubeCookies: {
    status: () => ipcRenderer.invoke("youtube-cookies-status"),
    ensure: () => ipcRenderer.invoke("youtube-cookies-ensure"),
  },
});
