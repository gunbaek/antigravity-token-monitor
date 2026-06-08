const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { exec } = require('child_process');

// Define app variables
let mainWindow = null;
let tray = null;
let isQuitting = false;
let configPollInterval = null;
let settings = {
    refreshInterval: 30, // seconds
    primaryModel: 'Gemini 3.5 Flash (Medium)',
    alertThreshold: 20, // percent
    showNotifications: true
};

const settingsPath = path.join(app.getPath('userData'), 'monitor_settings.json');

// Load settings from file
function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf8');
            settings = { ...settings, ...JSON.parse(data) };
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

// Save settings to file
function saveSettings(newSettings) {
    try {
        settings = { ...settings, ...newSettings };
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        // Reschedule polling with new interval
        startPolling();
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

// Auto-discovery of Antigravity Port & CSRF Token
function discoverAntigravity() {
    return new Promise((resolve) => {
        // Step 1: Run powershell command to find language_server.exe process command line
        const cmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name = \'language_server.exe\'\\" | Select-Object -ExpandProperty CommandLine"';
        exec(cmd, (error, stdout) => {
            if (error || !stdout.trim()) {
                console.log('language_server.exe is not running.');
                resolve(null);
                return;
            }

            const commandLine = stdout.trim();
            
            // Extract --csrf_token
            const csrfMatch = /--csrf_token\s+([^\s]+)/.exec(commandLine);
            const csrfToken = csrfMatch ? csrfMatch[1] : null;

            if (!csrfToken) {
                console.log('CSRF token not found in process arguments.');
                resolve(null);
                return;
            }

            // Step 2: Read language_server.log to find the active HTTPS port
            const homeDir = process.env.USERPROFILE || process.env.HOMEPATH;
            const logPath = path.join(homeDir, 'AppData', 'Roaming', 'Antigravity', 'logs', 'language_server.log');

            if (!fs.existsSync(logPath)) {
                console.log(`Language server log not found at: ${logPath}`);
                resolve(null);
                return;
            }

            try {
                const logs = fs.readFileSync(logPath, 'utf8');
                // We use HTTPS port for Connect RPC requests
                const portPattern = /listening on \w+ port at (\d+) for HTTPS \(gRPC\)/i;
                const matches = logs.match(portPattern);
                
                if (matches) {
                    const port = parseInt(matches[1], 10);
                    console.log(`Discovered Antigravity: Port = ${port}, CSRF = ${csrfToken}`);
                    resolve({ port, csrfToken });
                } else {
                    // Fallback to HTTP port
                    const httpPattern = /listening on \w+ port at (\d+) for HTTP/i;
                    const httpMatches = logs.match(httpPattern);
                    if (httpMatches) {
                        const port = parseInt(httpMatches[1], 10);
                        console.log(`Discovered Antigravity (HTTP): Port = ${port}, CSRF = ${csrfToken}`);
                        resolve({ port, csrfToken, isHttp: true });
                    } else {
                        console.log('Could not find listening port in logs.');
                        resolve(null);
                    }
                }
            } catch (err) {
                console.error('Failed to read logs:', err);
                resolve(null);
            }
        });
    });
}

// Query the user status (quotas)
function queryUserStatus(port, csrfToken, isHttp = false) {
    return new Promise((resolve, reject) => {
        const path = '/exa.language_server_pb.LanguageServerService/GetUserStatus';
        const requestBody = JSON.stringify({});

        const options = {
            hostname: '127.0.0.1',
            port: port,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-codeium-csrf-token': csrfToken,
                'Content-Length': Buffer.byteLength(requestBody)
            },
            // Bypass self-signed SSL certificate issues
            agent: new https.Agent({ rejectUnauthorized: false }),
            timeout: 5000
        };

        const client = isHttp ? require('http') : https;

        const req = client.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${e.message}`));
                    }
                } else {
                    reject(new Error(`Server responded with status code ${res.statusCode}`));
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });

        req.write(requestBody);
        req.end();
    });
}

// Active state of discovery
let activeConfig = null;

// Function to fetch status and send to renderer
async function fetchAndSendStatus() {
    try {
        // Rediscover if we don't have a config, or test existing one
        if (!activeConfig) {
            activeConfig = await discoverAntigravity();
        }

        if (!activeConfig) {
            if (mainWindow) {
                mainWindow.webContents.send('status-update', { error: 'Antigravity language server is not running.' });
            }
            return;
        }

        const data = await queryUserStatus(activeConfig.port, activeConfig.csrfToken, activeConfig.isHttp);
        if (mainWindow) {
            mainWindow.webContents.send('status-update', { success: true, data });
        }
    } catch (e) {
        console.error('Error fetching status:', e.message);
        // Reset config on failure so we rediscover next time
        activeConfig = null;
        if (mainWindow) {
            mainWindow.webContents.send('status-update', { error: `Connection failed: ${e.message}` });
        }
    }
}

// Start polling loop
function startPolling() {
    if (configPollInterval) clearInterval(configPollInterval);
    
    // Immediate fetch
    fetchAndSendStatus();
    
    // Periodic fetch
    configPollInterval = setInterval(fetchAndSendStatus, settings.refreshInterval * 1000);
}

// Create the main window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 420,
        height: 600,
        resizable: false,
        maximizable: false,
        show: false,
        frame: false, // Frameless for custom premium titlebar/glass design
        transparent: true, // Transparent for rounded glassmorphic look
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');

    mainWindow.on('ready-to-show', () => {
        mainWindow.show();
    });

    // Intercept close to hide window instead of exiting
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Create System Tray Icon
function createTrayIcon() {
    // Generate a default 16x16 transparent icon
    const defaultIcon = nativeImage.createEmpty();
    tray = new Tray(defaultIcon);
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open Dashboard',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                } else {
                    createWindow();
                }
            }
        },
        {
            label: 'Refresh Quota',
            click: () => {
                fetchAndSendStatus();
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('Antigravity Token Monitor');
    tray.setContextMenu(contextMenu);

    // Double click tray icon to show dashboard
    tray.on('double-click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
            }
        } else {
            createWindow();
        }
    });
}

// IPC Handlers
ipcMain.handle('refresh-status', async () => {
    await fetchAndSendStatus();
});

ipcMain.on('update-tray-icon', (event, dataUrl) => {
    if (tray) {
        // Convert canvas dataUrl to nativeImage
        const image = nativeImage.createFromDataURL(dataUrl);
        tray.setImage(image);
    }
});

ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.hide(); // Hide instead of closing to run in background
});

ipcMain.on('set-taskbar-progress', (event, progress) => {
    if (mainWindow) {
        // Electron accepts progress from 0.0 to 1.0. Set to -1 to clear
        mainWindow.setProgressBar(progress);
    }
});

ipcMain.on('send-notification', (event, { title, body }) => {
    if (settings.showNotifications) {
        new Notification({
            title: title || 'Antigravity Monitor',
            body: body || '',
            silent: false
        }).show();
    }
});

ipcMain.handle('get-settings', () => {
    return settings;
});

ipcMain.on('save-settings', (event, newSettings) => {
    saveSettings(newSettings);
});

ipcMain.on('open-external', (event, url) => {
    shell.openExternal(url);
});

// App Lifecycle
app.whenReady().then(() => {
    loadSettings();
    createTrayIcon();
    createWindow();
    startPolling();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
