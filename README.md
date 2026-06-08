# Antigravity Token Monitor

A visual Windows desktop app that monitors Google Antigravity token usage/quotas in real time.

## Features
- **Auto-Discovery**: Dynamically parses the running Antigravity instance port and CSRF token on startup.
- **Dynamic System Tray Icon**: Renders a solid progress color badge with remaining percentage digits in the system tray.
- **Taskbar Progress Overlay**: Updates Windows taskbar progress indicator.
- **Modern UI**: Dark-themed, glassmorphic layout using Outfit/Plus Jakarta Sans.
- **Low Quota alerts**: Triggers native desktop notifications.

## How to Run
1. Install dependencies:
   ```bash
   npm install
   ```
2. Launch development version:
   ```bash
   npm start
   ```

## Built With
- Electron
- Node.js
- HTML5 Canvas & CSS3
