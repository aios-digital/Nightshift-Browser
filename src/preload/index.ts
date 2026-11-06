import { contextBridge, ipcRenderer } from 'electron'
import { createApi, type IpcLike } from './api'

// Only a narrow adapter is handed to createApi; ipcRenderer itself never reaches the page.
const ipc: IpcLike = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, listener) => void ipcRenderer.on(channel, listener as never),
  off: (channel, listener) => void ipcRenderer.off(channel, listener as never)
}

contextBridge.exposeInMainWorld('ns', createApi(ipc))
