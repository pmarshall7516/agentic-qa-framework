import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('probe', {
  getRuntimeInfo: () => ipcRenderer.invoke('probe:runtime-info'),
});
