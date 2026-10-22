// Preload of the popup window: the only thing the page may ask of the app (follow its content height, hide, hear "restart" and "hangup").
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("overlay", {
  resize: (height) => ipcRenderer.send("gota-overlay-resize", height),
  hide: () => ipcRenderer.send("gota-overlay-hide"),
  on: (channel, callback) => ipcRenderer.on("gota-overlay-" + channel, (_event, data) => callback(data)),
})
