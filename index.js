// DOM Elements
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');
const userTierName = document.getElementById('user-tier-name');
const userTierDesc = document.getElementById('user-tier-desc');
const connStatus = document.getElementById('conn-status');
const connStatusText = document.getElementById('conn-status-text');
const quotaGrid = document.getElementById('quota-grid');
const lastUpdated = document.getElementById('last-updated');

// Settings Elements
const btnSettings = document.getElementById('btn-settings');
const settingsOverlay = document.getElementById('settings-overlay');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const selectModel = document.getElementById('select-model');
const inputInterval = document.getElementById('input-interval');
const inputThreshold = document.getElementById('input-threshold');
const checkboxNotifications = document.getElementById('checkbox-notifications');

// Canvas for dynamic tray icon drawing
const trayCanvas = document.getElementById('tray-canvas');
const ctx = trayCanvas.getContext('2d');

// State variables
let currentSettings = {
    refreshInterval: 30,
    primaryModel: 'Gemini 3.5 Flash (Medium)',
    alertThreshold: 20,
    showNotifications: true
};

let lastData = null;
let notifiedModels = {}; // Throttling alerts: { [modelLabel]: true }

// Window Control Listeners
btnMinimize.addEventListener('click', () => {
    window.api.minimizeWindow();
});

btnClose.addEventListener('click', () => {
    window.api.closeWindow();
});

// Load settings on startup
async function init() {
    currentSettings = await window.api.getSettings();
    
    // Update settings modal inputs
    inputInterval.value = currentSettings.refreshInterval;
    inputThreshold.value = currentSettings.alertThreshold;
    checkboxNotifications.checked = currentSettings.showNotifications;
    
    // Set up status listener
    window.api.onStatusUpdate((status) => {
        handleStatusUpdate(status);
    });
}

// Handle status updates from main process
function handleStatusUpdate(status) {
    const now = new Date();
    lastUpdated.innerText = now.toLocaleTimeString();

    if (status.error) {
        // Show disconnected state
        userTierName.innerText = "Antigravity Inactive";
        userTierDesc.innerText = status.error;
        
        connStatus.className = "status-badge error";
        connStatusText.innerText = "Disconnected";
        
        quotaGrid.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-muted); font-size: 13px;">
                ${status.error}<br>
                <span style="font-size: 11px; margin-top: 8px; display: inline-block;">Make sure the Antigravity desktop application is open.</span>
            </div>
        `;
        
        // Reset taskbar progress and tray icon to gray
        window.api.setTaskbarProgress(-1);
        drawTrayIcon(0, 'gray');
        return;
    }

    if (status.success && status.data) {
        lastData = status.data;
        const userStatus = lastData.userStatus;
        
        // Update user profile info
        const tierName = userStatus?.userTier?.name || "Google AI User";
        const tierDesc = userStatus?.userTier?.description || "Antigravity Active Session";
        
        userTierName.innerText = tierName;
        userTierDesc.innerText = tierDesc;
        
        connStatus.className = "status-badge";
        connStatusText.innerText = "Connected";

        // Get list of client model configurations
        const configs = userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
        
        // Dynamically update the settings model dropdown options if new models discovered
        updateModelDropdownOptions(configs);

        // Populate quota cards
        if (configs.length === 0) {
            quotaGrid.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-muted); font-size: 13px;">
                    No model configurations found.
                </div>
            `;
            return;
        }

        let gridHtml = '';
        let primaryModelConfig = null;

        configs.forEach(cfg => {
            if (!cfg.quotaInfo) return;

            const remainingFraction = cfg.quotaInfo.remainingFraction !== undefined ? cfg.quotaInfo.remainingFraction : 1.0;
            const remainingPercent = Math.round(remainingFraction * 100);
            
            // Format reset time
            let resetText = 'Quota Available';
            if (cfg.quotaInfo.resetTime) {
                const resetDate = new Date(cfg.quotaInfo.resetTime);
                if (resetDate > now) {
                    const diffMs = resetDate - now;
                    const diffMins = Math.floor(diffMs / 60000);
                    if (diffMins < 60) {
                        resetText = `Reset in ${diffMins}m`;
                    } else {
                        const diffHours = Math.floor(diffMins / 60);
                        resetText = `Reset in ${diffHours}h ${diffMins % 60}m`;
                    }
                }
            }

            // Determine color class based on remaining fraction
            let colorClass = 'status-green';
            if (remainingPercent <= currentSettings.alertThreshold) {
                colorClass = 'status-red';
                // Trigger notification if configured and not notified yet
                triggerLowQuotaNotification(cfg.label, remainingPercent);
            } else if (remainingPercent <= 50) {
                colorClass = 'status-yellow';
                // Reset notification flag when quota recovers
                delete notifiedModels[cfg.label];
            } else {
                delete notifiedModels[cfg.label];
            }

            // Check if this model is the primary model we are monitoring
            if (cfg.label === currentSettings.primaryModel) {
                primaryModelConfig = cfg;
            }

            // Calculate SVG stroke offset for progress circle
            // Circumference is 2 * pi * r = 2 * 3.14159 * 23 = 144.5
            const radius = 23;
            const circumference = 2 * Math.PI * radius;
            const strokeDashoffset = circumference - (remainingFraction * circumference);

            gridHtml += `
                <div class="quota-card" onclick="setPrimaryModel('${cfg.label}')">
                    <div class="progress-circle-container">
                        <svg class="progress-circle">
                            <circle class="bg" cx="27" cy="27" r="${radius}"></circle>
                            <circle class="bar ${colorClass}" cx="27" cy="27" r="${radius}" 
                                    stroke-dasharray="${circumference}" 
                                    stroke-dashoffset="${strokeDashoffset}"></circle>
                        </svg>
                        <div class="progress-percentage ${colorClass}">${remainingPercent}%</div>
                    </div>
                    <div class="quota-details">
                        <div class="quota-header">
                            <div class="model-name" title="${cfg.label}">${cfg.label}</div>
                            <div class="reset-time">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                                <span>${resetText}</span>
                            </div>
                        </div>
                        <div class="quota-status-text">
                            ${cfg.label === currentSettings.primaryModel ? '★ Monitoring Active' : 'Click to monitor in taskbar'}
                        </div>
                    </div>
                </div>
            `;
        });

        quotaGrid.innerHTML = gridHtml;

        // If no model is marked as primary or found, default to the first available model
        if (!primaryModelConfig && configs.length > 0) {
            primaryModelConfig = configs.find(c => c.quotaInfo);
            if (primaryModelConfig) {
                currentSettings.primaryModel = primaryModelConfig.label;
                selectModel.value = primaryModelConfig.label;
            }
        }

        // Update taskbar and system tray based on the primary model
        if (primaryModelConfig) {
            const fraction = primaryModelConfig.quotaInfo.remainingFraction !== undefined ? primaryModelConfig.quotaInfo.remainingFraction : 1.0;
            const percent = Math.round(fraction * 100);
            
            // 1. Taskbar progress overlay
            window.api.setTaskbarProgress(fraction);
            
            // 2. Tray icon drawing
            let color = '#10b981'; // Success Green
            if (percent <= currentSettings.alertThreshold) {
                color = '#ef4444'; // Alert Red
            } else if (percent <= 50) {
                color = '#f59e0b'; // Warning Amber
            }
            
            drawTrayIcon(percent, color);
        }
    }
}

// Dynamically populate options in settings dropdown
function updateModelDropdownOptions(configs) {
    const existingOptions = Array.from(selectModel.options).map(o => o.value);
    
    configs.forEach(cfg => {
        if (cfg.quotaInfo && !existingOptions.includes(cfg.label)) {
            const opt = document.createElement('option');
            opt.value = cfg.label;
            opt.innerText = cfg.label;
            selectModel.appendChild(opt);
        }
    });
    
    // Set selected value
    if (existingOptions.includes(currentSettings.primaryModel) || Array.from(selectModel.options).some(o => o.value === currentSettings.primaryModel)) {
        selectModel.value = currentSettings.primaryModel;
    }
}

// Click quota card to set as primary monitoring model
function setPrimaryModel(modelLabel) {
    currentSettings.primaryModel = modelLabel;
    selectModel.value = modelLabel;
    window.api.saveSettings(currentSettings);
    if (lastData) {
        handleStatusUpdate({ success: true, data: lastData });
    }
}

// Trigger warning notifications (with throttling)
function triggerLowQuotaNotification(modelLabel, percent) {
    if (currentSettings.showNotifications && !notifiedModels[modelLabel]) {
        notifiedModels[modelLabel] = true;
        window.api.sendNotification(
            'Antigravity Quota Low',
            `Your quota for model [${modelLabel}] is critically low at ${percent}%.`
        );
    }
}

// Draw percentage onto the 32x32 system tray icon
function drawTrayIcon(percent, colorCode) {
    // Clear canvas
    ctx.clearRect(0, 0, 32, 32);
    
    // Draw a solid rounded rectangle badge with high-contrast background
    const x = 0;
    const y = 3;
    const w = 32;
    const h = 26;
    const r = 6; // Corner radius
    
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = colorCode;
    ctx.fill();
    
    // Add a very subtle dark border for definition
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Draw text inside the badge (White text for high contrast on solid color)
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Dynamically adjust font size to be as large and clean as possible
    if (percent >= 100) {
        ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
        ctx.fillText('100', 16, 16);
    } else if (percent >= 10) {
        ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
        ctx.fillText(percent.toString(), 16, 16);
    } else {
        ctx.font = 'bold 19px "Segoe UI", Arial, sans-serif';
        ctx.fillText(percent.toString(), 16, 16);
    }
    
    // Convert canvas to data URL and send to main process
    const dataUrl = trayCanvas.toDataURL('image/png');
    window.api.updateTrayIcon(dataUrl);
}

// Settings modal listeners
btnSettings.addEventListener('click', () => {
    settingsOverlay.classList.add('active');
});

btnCancelSettings.addEventListener('click', () => {
    settingsOverlay.classList.remove('active');
});

btnSaveSettings.addEventListener('click', () => {
    const updatedSettings = {
        refreshInterval: parseInt(inputInterval.value, 10) || 30,
        primaryModel: selectModel.value,
        alertThreshold: parseInt(inputThreshold.value, 10) || 20,
        showNotifications: checkboxNotifications.checked
    };
    
    currentSettings = updatedSettings;
    window.api.saveSettings(updatedSettings);
    settingsOverlay.classList.remove('active');
});

// Run init
init();
