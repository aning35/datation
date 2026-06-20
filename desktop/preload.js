/**
 * Datation Desktop — Preload Script
 * Exposes a minimal API to the renderer process via contextBridge.
 * Used by both splash.html and the main window.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('datation', {
  isDesktop: true,
  platform: process.platform,
  version: process.env.npm_package_version || '0.1.0',

  // ── Splash / Setup IPC ──
  /** Receive environment detection results */
  onEnvStatus: (callback) => {
    ipcRenderer.on('env-status', (_event, data) => callback(data));
  },
  /** Receive installation progress updates */
  onInstallProgress: (callback) => {
    ipcRenderer.on('install-progress', (_event, data) => callback(data));
  },
  /** Receive splash status text updates (legacy compat) */
  onSplashStatus: (callback) => {
    ipcRenderer.on('splash-status', (_event, message) => callback(message));
  },
  /** Receive raw real-time logs */
  onInstallLog: (callback) => {
    ipcRenderer.on('install-log', (_event, message) => callback(message));
  },
  /** Trigger environment installation with options */
  startInstall: (options) => {
    ipcRenderer.send('start-install', options);
  },
  /** Cancel ongoing installation */
  cancelInstall: () => {
    ipcRenderer.send('cancel-install');
  },
  /** Skip setup and quit */
  skipSetup: () => {
    ipcRenderer.send('skip-setup');
  },
  /** Select local path for uv */
  selectUvPath: () => {
    return ipcRenderer.invoke('select-uv-path');
  },
});
