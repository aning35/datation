/**
 * Datation Desktop — Electron Main Process
 *
 * Responsibilities:
 * 1. On first launch: install Python + dependencies via embedded uv
 * 2. Start the Python FastAPI backend as a child process
 * 3. Wait for backend health check, then open BrowserWindow
 * 4. Gracefully shut down the backend when the window closes
 */

const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const { spawn, execFile } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const http = require('http');
const log = require('electron-log');
const execFileAsync = util.promisify(execFile);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const IS_DEV = !app.isPackaged;

// In production, extraResources are placed under `<app>/Contents/Resources/`
const RESOURCES = IS_DEV
  ? path.resolve(__dirname, '..')
  : process.resourcesPath;

const BACKEND_DIR = IS_DEV
  ? path.resolve(__dirname, '..')
  : path.join(RESOURCES, 'backend');

// User-local data directory for the embedded Python environment
const USER_DATA = app.getPath('userData'); // ~/Library/Application Support/Datation
const PYTHON_HOME = path.join(USER_DATA, 'python-env');
let UV_BIN = path.join(PYTHON_HOME, 'uv', process.platform === 'win32' ? 'uv.exe' : 'uv');
const VENV_DIR = path.join(PYTHON_HOME, 'venv');

const API_PORT = 18321;
const API_URL = `http://127.0.0.1:${API_PORT}`;

// Extend PATH for macOS/Linux GUI apps so they can find tools installed via brew, curl, cargo, etc.
if (process.platform !== 'win32') {
  const extraPaths = [
    '/opt/homebrew/Caskroom/miniconda/base/bin',
    path.join(app.getPath('home'), 'miniconda3/bin'),
    path.join(app.getPath('home'), 'anaconda3/bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(app.getPath('home'), '.local/bin'),
    path.join(app.getPath('home'), '.cargo/bin')
  ];
  process.env.PATH = extraPaths.join(':') + ':' + (process.env.PATH || '');
}

// Load custom user config for manual paths
const CONFIG_FILE = path.join(USER_DATA, 'datation-env.json');
let userConfig = {};
try {
  if (fs.existsSync(CONFIG_FILE)) {
    userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (userConfig.uvPath) {
      UV_BIN = userConfig.uvPath;
    }
  }
} catch (e) {}

function saveUserConfig(key, value) {
  userConfig[key] = value;
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(userConfig, null, 2), 'utf8');
  } catch (e) {}
}

let mainWindow = null;
let splashWindow = null;
let backendProcess = null;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
log.transports.file.level = 'info';
log.transports.console.level = IS_DEV ? 'debug' : 'info';

// ---------------------------------------------------------------------------
// Splash Screen
// ---------------------------------------------------------------------------
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 680,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

// ---------------------------------------------------------------------------
// Python Environment Setup
// ---------------------------------------------------------------------------
let activeInstallProcess = null;

async function detectEnvironment() {
  const result = {
    uv: { found: false, version: '', path: '' },
    python: { found: false, version: '', path: '' },
    needsSetup: true
  };

  // 1. Detect uv
  if (userConfig.uvPath && fs.existsSync(userConfig.uvPath)) {
    try {
      const { stdout } = await execFileAsync(userConfig.uvPath, ['--version']);
      result.uv.found = true;
      result.uv.version = stdout.trim();
      result.uv.path = userConfig.uvPath;
      UV_BIN = userConfig.uvPath;
    } catch (e) {}
  }

  if (!result.uv.found) {
    try {
      const { stdout } = await execFileAsync('uv', ['--version']);
      result.uv.found = true;
      result.uv.version = stdout.trim();
      result.uv.path = 'System PATH';
      UV_BIN = 'uv'; // use system uv
    } catch (err) {
      if (fs.existsSync(UV_BIN)) {
        try {
          const { stdout } = await execFileAsync(UV_BIN, ['--version']);
          result.uv.found = true;
          result.uv.version = stdout.trim();
          result.uv.path = UV_BIN;
        } catch (e) {}
      }
    }
  }

  // 2. Detect python3 (informative)
  try {
    const { stdout } = await execFileAsync('python3', ['--version']);
    result.python.found = true;
    result.python.version = stdout.trim().replace('Python ', '');
    result.python.path = 'System PATH';
  } catch (err) {
    try {
      const { stdout } = await execFileAsync('python', ['--version']);
      result.python.found = true;
      result.python.version = stdout.trim().replace('Python ', '');
      result.python.path = 'System PATH';
    } catch (e) {}
  }

  // 3. Needs interactive setup if uv is missing OR venv is not initialized
  result.needsSetup = !result.uv.found || !fs.existsSync(path.join(VENV_DIR, 'pyvenv.cfg'));
  // Needs automatic sync is no longer used since we always show the UI to pick mirrors
  result.needsSync = false;
  
  return result;
}

function notifySplashProgress(message) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('install-progress', { message });
  }
}

function notifySplashLog(message) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('install-log', message);
  }
}

/** Download and install uv into the app's user data directory */
async function installUv() {
  log.info('[Setup] Installing uv...');
  notifySplashProgress('Installing Python package manager (uv)...');

  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let proc;

    if (platform === 'win32') {
      proc = spawn('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `irm https://astral.sh/uv/install.ps1 | iex`
      ], {
        env: { ...process.env, UV_INSTALL_DIR: path.join(PYTHON_HOME, 'uv') },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      const uvDir = path.join(PYTHON_HOME, 'uv');
      fs.mkdirSync(uvDir, { recursive: true });
      proc = spawn('sh', ['-c', `curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="${uvDir}" sh`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    activeInstallProcess = proc;

    proc.stdout.on('data', (d) => {
      const msg = d.toString().trim();
      log.info(`[uv-install] ${msg}`);
      notifySplashLog(msg);
    });
    proc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      log.warn(`[uv-install] ${msg}`);
      notifySplashLog(msg);
    });
    
    proc.on('close', (code) => {
      activeInstallProcess = null;
      if (platform !== 'win32') {
        const altBin = path.join(PYTHON_HOME, 'uv', 'bin', 'uv');
        if (!fs.existsSync(UV_BIN) && fs.existsSync(altBin)) {
          fs.copyFileSync(altBin, UV_BIN);
          fs.chmodSync(UV_BIN, 0o755);
        }
      }
      code === 0 ? resolve() : reject(new Error(`uv install exited ${code}`));
    });

    proc.on('error', (err) => {
      activeInstallProcess = null;
      reject(err);
    });
  });
}

/** Use uv to create a venv and install all Python dependencies */
async function installPythonDeps(options = {}) {
  log.info('[Setup] Installing Python dependencies...');
  notifySplashProgress('Setting up isolated Python environment & dependencies...\nThis may take a few minutes on first launch.');

  return new Promise((resolve, reject) => {
    const envVars = {
      ...process.env,
      VIRTUAL_ENV: VENV_DIR,
      UV_PROJECT_ENVIRONMENT: VENV_DIR,
    };

    if (options.mirror === 'china') {
      envVars.UV_INDEX_URL = 'https://pypi.tuna.tsinghua.edu.cn/simple';
    }

    const proc = spawn(UV_BIN, [
      'sync',
      '--python', '3.12',
      '--project', BACKEND_DIR,
    ], {
      cwd: BACKEND_DIR,
      env: envVars,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeInstallProcess = proc;

    proc.stdout.on('data', (d) => {
      const line = d.toString().trim();
      log.info(`[uv-sync] ${line}`);
      notifySplashLog(line);
      if (line.includes('Resolved') || line.includes('Installing') || line.includes('Installed')) {
        notifySplashProgress(`Installing dependencies...\n${line}`);
      }
    });
    
    proc.stderr.on('data', (d) => {
      const line = d.toString().trim();
      log.warn(`[uv-sync] ${line}`);
      notifySplashLog(line);
    });
    
    proc.on('close', (code) => {
      activeInstallProcess = null;
      code === 0 ? resolve() : reject(new Error(`uv sync exited with code ${code}`));
    });

    proc.on('error', (err) => {
      activeInstallProcess = null;
      reject(err);
    });
  });
}

ipcMain.handle('select-uv-path', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(splashWindow || mainWindow, {
    title: 'Select uv executable (选择 uv 可执行程序)',
    properties: ['openFile'],
    filters: [
      { name: 'Executables', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }
    ]
  });
  
  if (!canceled && filePaths.length > 0) {
    const selectedPath = filePaths[0];
    UV_BIN = selectedPath;
    saveUserConfig('uvPath', selectedPath);
    
    // Re-detect and update splash
    const newStatus = await detectEnvironment();
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('env-status', newStatus);
    }
    
    return selectedPath;
  }
  return null;
});

/** Interactive setup flow using IPC */
async function ensurePythonEnv() {
  const envStatus = await detectEnvironment();
  log.info('[Setup] Environment status:', envStatus);

  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('env-status', envStatus);
  }

  if (envStatus.needsSetup) {
    // uv or venv is missing — show interactive setup page and wait for user action
    return new Promise((resolve, reject) => {
      ipcMain.once('start-install', async (event, options) => {
        try {
          // Save user's mirror preference for future background syncs
          if (options && options.mirror) {
            saveUserConfig('mirror', options.mirror);
          }
          if (!envStatus.uv.found) {
            await installUv();
          }
          await installPythonDeps(options);
          log.info('[Setup] Python environment ready.');
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      
      ipcMain.once('skip-setup', () => {
        log.info('[Setup] User skipped setup');
        resolve();
      });

      ipcMain.once('cancel-install', () => {
        if (activeInstallProcess) {
          activeInstallProcess.kill();
        }
        reject(new Error('User cancelled installation'));
      });
    });
  } else {
    // Fast path: everything is ready (uv + venv both exist)
    log.info('[Setup] Environment ready. Starting fast path.');
    // Optional: background sync to keep deps up-to-date, using saved mirror preference
    const savedMirror = userConfig.mirror || 'official';
    installPythonDeps({ mirror: savedMirror }).catch(e => log.warn("[Setup] Fast sync failed:", e));
  }
}

// ---------------------------------------------------------------------------
// Backend Process Management
// ---------------------------------------------------------------------------
function getPythonBin() {
  if (process.platform === 'win32') {
    return path.join(VENV_DIR, 'Scripts', 'python.exe');
  }
  return path.join(VENV_DIR, 'bin', 'python');
}

function startBackend() {
  log.info('[Backend] Starting FastAPI backend...');
  updateSplash('Starting Datation backend...');

  const pythonBin = getPythonBin();

  backendProcess = spawn(pythonBin, ['-m', 'datation.main'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PYTHONPATH: path.join(BACKEND_DIR, 'datation') + (process.platform === 'win32' ? ';' : ':') + BACKEND_DIR,
      VIRTUAL_ENV: VENV_DIR,
      PATH: path.dirname(pythonBin) + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || ''),
      PYTHONNOUSERSITE: '1',
      SETUPTOOLS_USE_DISTUTILS: 'stdlib',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout.on('data', (d) => {
    const msg = d.toString().trimEnd();
    log.info(`[Backend] ${msg}`);
    notifySplashLog(msg);
  });
  backendProcess.stderr.on('data', (d) => {
    const msg = d.toString().trimEnd();
    log.warn(`[Backend] ${msg}`);
    notifySplashLog(msg);
  });

  backendProcess.on('close', (code) => {
    log.info(`[Backend] Process exited with code ${code}`);
    backendProcess = null;
  });

  backendProcess.on('error', (err) => {
    log.error(`[Backend] Failed to start: ${err.message}`);
    backendProcess = null;
  });
}

/** Poll the /health endpoint until it returns { ready: true } */
function waitForBackend(timeoutMs = 120000) {
  updateSplash('Waiting for backend to be ready...');
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - startTime > timeoutMs) {
        return reject(new Error('Backend startup timed out'));
      }

      // If the backend process has already exited, stop waiting
      if (backendProcess === null) {
        return reject(new Error('Backend process terminated unexpectedly'));
      }

      const req = http.get(`${API_URL}/health`, { timeout: 2000 }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.ready) {
              log.info('[Backend] Health check passed — ready!');
              return resolve();
            }
          } catch {}
          setTimeout(check, 1500);
        });
      });
      req.on('error', () => setTimeout(check, 1500));
      req.on('timeout', () => { req.destroy(); setTimeout(check, 1500); });
    };
    check();
  });
}

function stopBackend() {
  if (!backendProcess) return;
  log.info('[Backend] Stopping...');

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(backendProcess.pid), '/T', '/F']);
    } else {
      backendProcess.kill('SIGTERM');
      // Force kill after 5 seconds if it doesn't exit
      setTimeout(() => {
        if (backendProcess) {
          backendProcess.kill('SIGKILL');
        }
      }, 5000);
    }
  } catch (err) {
    log.warn(`[Backend] Error stopping: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main Window
// ---------------------------------------------------------------------------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'Datation',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(API_URL);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          title: 'Datation Print Preview'
        }
      };
    }
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Splash update helper
// ---------------------------------------------------------------------------
function updateSplash(message) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash-status', message);
  }
}

// ---------------------------------------------------------------------------
// App Lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  createSplashWindow();

  try {
    await ensurePythonEnv();
    startBackend();
    await waitForBackend();
    createMainWindow();
  } catch (err) {
    log.error(`[Startup] Fatal error: ${err.message}`);
    dialog.showErrorBox(
      'Datation Startup Error',
      `Failed to start Datation:\n\n${err.message}\n\nPlease check the logs at:\n${log.transports.file.getFile().path}`
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});

app.on('before-quit', () => {
  stopBackend();
});

// macOS: re-create window when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && backendProcess) {
    createMainWindow();
  }
});
