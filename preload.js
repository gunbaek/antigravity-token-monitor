const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Receive token status updates from the main process
    onStatusUpdate: (callback) => ipcRenderer.on('status-update', (event, data) => callback(data)),
    
    // Request an immediate status refresh
    refreshStatus: () => ipcRenderer.invoke('refresh-status'),
    
    // Send canvas data URL to set dynamic tray icon
    updateTrayIcon: (dataUrl) => ipcRenderer.send('update-tray-icon', dataUrl),
    
    // Set taskbar progress bar (0.0 to 1.0)
    setTaskbarProgress: (progress) => ipcRenderer.send('set-taskbar-progress', progress),
    
    // Trigger desktop notification
    sendNotification: (title, body) => ipcRenderer.send('send-notification', { title, body }),
    
    // Save/Get local configuration settings
    saveSettings: (settings) => ipcRenderer.send('save-settings', settings),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    
    // Window control functions
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    
    // Open a link in default browser
    openExternal: (url) => ipcRenderer.send('open-external', url)
});
