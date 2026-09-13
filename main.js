const { app, BrowserWindow, ipcMain, dialog, Menu, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const windows = new Set();
const allowCloseFlags = new WeakMap();
let pendingFilePath = null;

const ICONS_DIRECTORY = path.join(__dirname, 'assets', 'icons');
const FALLBACK_ICON = path.join(__dirname, 'icon_256.png');

function readIconConfiguration() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(ICONS_DIRECTORY, 'icons.json'), 'utf8'));
    return config && typeof config === 'object' ? config : {};
  } catch (_err) {
    return {};
  }
}

function configuredIcon(name) {
  const icons = readIconConfiguration();
  const configured = icons[name];
  if (typeof configured !== 'string' || !configured.trim()) return null;
  const candidate = path.resolve(ICONS_DIRECTORY, configured);
  const root = path.resolve(ICONS_DIRECTORY) + path.sep;
  return candidate.startsWith(root) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ? candidate
    : null;
}

function appIconPath() {
  return configuredIcon('app') || FALLBACK_ICON;
}

function rendererIconUrls() {
  return ['txt', 'md', 'bb'].reduce((icons, name) => {
    const icon = configuredIcon(name) || FALLBACK_ICON;
    icons[name] = pathToFileURL(icon).href;
    return icons;
  }, {});
}

function preferencesPath() { return path.join(app.getPath('userData'), 'preferences.json'); }
function readPreferences() { try { return JSON.parse(fs.readFileSync(preferencesPath(), 'utf8')); } catch (_err) { return {}; } }
function writePreferences(preferences) { fs.writeFileSync(preferencesPath(), JSON.stringify(preferences, null, 2), 'utf8'); }

const DEFAULT_FONTS = {
  fontUI: 'Verdana, Geneva, sans-serif',
  fontText: 'Verdana, Geneva, sans-serif',
  fontHeading: '"Times New Roman", Times, serif',
  fontCode: '"Courier New", monospace'
};

const DEFAULT_FONT_SIZES = {
  fontSizeUi: 12,
  fontSizeText: 12,
  fontSizeHeading: 26,
  fontSizeCode: 11
};
const THEME_BACKGROUNDS = { light: '#fdfdfb', dark: '#1b1c1d' };

function sanitizedFontSize(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 6 && num <= 96 ? num : fallback;
}

function bootPreferences() {
  const preferences = readPreferences();
  const theme = preferences.theme === 'dark' ? 'dark' : 'light';
  return {
    theme,
    fontUI: typeof preferences.fontUI === 'string' && preferences.fontUI ? preferences.fontUI : DEFAULT_FONTS.fontUI,
    fontText: typeof preferences.fontText === 'string' && preferences.fontText ? preferences.fontText : DEFAULT_FONTS.fontText,
    fontHeading: typeof preferences.fontHeading === 'string' && preferences.fontHeading ? preferences.fontHeading : DEFAULT_FONTS.fontHeading,
    fontCode: typeof preferences.fontCode === 'string' && preferences.fontCode ? preferences.fontCode : DEFAULT_FONTS.fontCode,
    fontSizeUi: sanitizedFontSize(preferences.fontSizeUi, DEFAULT_FONT_SIZES.fontSizeUi),
    fontSizeText: sanitizedFontSize(preferences.fontSizeText, DEFAULT_FONT_SIZES.fontSizeText),
    fontSizeHeading: sanitizedFontSize(preferences.fontSizeHeading, DEFAULT_FONT_SIZES.fontSizeHeading),
    fontSizeCode: sanitizedFontSize(preferences.fontSizeCode, DEFAULT_FONT_SIZES.fontSizeCode),
    defaultView: ['edit', 'live', 'preview'].includes(preferences.defaultView) ? preferences.defaultView : 'edit'
  };
}

function readCustomDictionary() {
  const words = readPreferences().customDictionary;
  return Array.isArray(words) ? words.filter((word) => typeof word === 'string') : [];
}

function applyCustomDictionary(ses) {
  readCustomDictionary().forEach((word) => {
    try { ses.addWordToSpellCheckerDictionary(word); } catch (_err) { /* unavailable on this platform */ }
  });
}

function readShortcodes() {
  const list = readPreferences().shortcodes;
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item.key === 'string' && typeof item.expansion === 'string')
    .map((item) => ({ key: item.key, expansion: item.expansion }));
}

function writeShortcodes(list) {
  const seen = new Map();
  (Array.isArray(list) ? list : []).forEach((item) => {
    if (!item || typeof item.key !== 'string' || typeof item.expansion !== 'string') return;
    const key = item.key.trim();
    if (!key) return;
    seen.set(key.toLowerCase(), { key, expansion: item.expansion });
  });
  const sanitized = Array.from(seen.values()).sort((a, b) => a.key.localeCompare(b.key));
  writePreferences({ ...readPreferences(), shortcodes: sanitized });
  return sanitized;
}

function readWindowBounds() {
  const bounds = readPreferences().windowBounds;
  if (!bounds || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') return null;
  return bounds;
}

function saveWindowBounds(win) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
  writePreferences({ ...readPreferences(), windowBounds: { ...bounds, isMaximized: win.isMaximized() } });
}

function getOpenablePath(args) {
  const executablePath = path.resolve(process.execPath);
  return args.find((arg) => {
    if (!arg || arg.startsWith('-') || path.resolve(arg) === executablePath) return false;
    return fs.existsSync(arg) && fs.statSync(arg).isFile();
  }) || null;
}

function sendFileToRenderer(win, filePath) {
  if (!filePath || !win || win.isDestroyed()) return;
  const content = fs.readFileSync(filePath, 'utf8');
  win.webContents.send('file:open-path', { filePath, content, fileName: path.basename(filePath) });
}

function broadcast(channel, payload) {
  windows.forEach((win) => { if (!win.isDestroyed()) win.webContents.send(channel, payload); });
}

function wireSharedSpellcheckSession() {
  const ses = session.defaultSession;
  applyCustomDictionary(ses);
  try {
    const savedLangs = readPreferences().spellcheckLanguages;
    const initialLangs = Array.isArray(savedLangs) && savedLangs.length ? savedLangs : ['en-US'];
    ses.setSpellCheckerLanguages(initialLangs);
  } catch (err) {
    // Spellchecker may be unavailable on some platforms/builds.
  }

  ses.on('spellcheck-dictionary-download-success', (_event, lang) => broadcast('spellcheck:download-status', { lang, status: 'success' }));
  ses.on('spellcheck-dictionary-download-begin', (_event, lang) => broadcast('spellcheck:download-status', { lang, status: 'begin' }));
  ses.on('spellcheck-dictionary-download-failure', (_event, lang) => broadcast('spellcheck:download-status', { lang, status: 'failure' }));
  ses.on('spellcheck-dictionary-initialized', (_event, lang) => broadcast('spellcheck:download-status', { lang, status: 'success' }));
}

function createWindow(filePath) {
  const savedBounds = readWindowBounds();
  const boot = bootPreferences();
  const win = new BrowserWindow({
    width: savedBounds?.width || 1000,
    height: savedBounds?.height || 720,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: THEME_BACKGROUNDS[boot.theme],
    icon: appIconPath(),
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      additionalArguments: [`--boot-prefs=${encodeURIComponent(JSON.stringify(boot))}`]
    }
  });
  windows.add(win);
  allowCloseFlags.set(win, false);
  if (savedBounds?.isMaximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  let boundsSaveTimeout = null;
  const scheduleBoundsSave = () => {
    clearTimeout(boundsSaveTimeout);
    boundsSaveTimeout = setTimeout(() => saveWindowBounds(win), 400);
  };
  win.on('resize', scheduleBoundsSave);
  win.on('move', scheduleBoundsSave);

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    if (filePath) sendFileToRenderer(win, filePath);
  });

  win.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    const isMod = input.control || input.meta;
    const isDevToolsShortcut = isMod && input.shift && ['i', 'j', 'c'].includes(key);
    if (input.key === 'F5' || input.key === 'F12' || isDevToolsShortcut || (isMod && ['n', 'o', 'p', 'q', 'r', 'w'].includes(key))) event.preventDefault();
  });
  win.webContents.on('context-menu', (event, params) => {
    if (params.misspelledWord) {
      event.preventDefault();
      win.webContents.send('spellcheck:context-menu', {
        x: params.x,
        y: params.y,
        word: params.misspelledWord,
        suggestions: params.dictionarySuggestions || []
      });
      return;
    }

    const selection = (params.selectionText || '').trim();
    if (selection && /^[A-Za-z''-]+$/.test(selection)) {
      event.preventDefault();
      win.webContents.send('synonyms:context-menu', {
        x: params.x,
        y: params.y,
        word: selection
      });
    }
  });

  win.on('closed', () => { windows.delete(win); });
  win.on('close', (event) => {
    saveWindowBounds(win);
    if (allowCloseFlags.get(win)) return;
    event.preventDefault();
    win.webContents.send('window:request-close');
  });

  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  wireSharedSpellcheckSession();
  createWindow(pendingFilePath);
  pendingFilePath = null;
});

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  pendingFilePath = getOpenablePath(process.argv);
  app.on('second-instance', (_event, commandLine) => {
    const filePath = getOpenablePath(commandLine);
    if (filePath) {
      createWindow(filePath);
      return;
    }
    const target = BrowserWindow.getFocusedWindow() || windows.values().next().value;
    if (target) {
      if (target.isMinimized()) target.restore();
      target.focus();
    } else {
      createWindow();
    }
  });
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) createWindow(filePath);
  else pendingFilePath = filePath;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (windows.size === 0) createWindow();
});

const FILE_FILTERS = [
  { name: 'Text / Markdown / BBCode', extensions: ['txt', 'md', 'markdown', 'bbcode', 'bb', 'scratch'] },
  { name: 'All Files', extensions: ['*'] }
];

function windowFor(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.handle('dialog:open', async (event) => {
  const win = windowFor(event);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: FILE_FILTERS
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  createWindow(result.filePaths[0]);
  return null;
});

ipcMain.handle('file:save', async (event, { filePath, fileName, content }) => {
  let target = filePath;
  if (!target) {
    const result = await dialog.showSaveDialog(windowFor(event), { defaultPath: path.basename(fileName || 'Untitled'), filters: FILE_FILTERS });
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
  }
  fs.writeFileSync(target, content, 'utf-8');
  return { filePath: target, fileName: path.basename(target) };
});

ipcMain.handle('dialog:saveAs', async (event, { fileName, content }) => {
  const result = await dialog.showSaveDialog(windowFor(event), { defaultPath: path.basename(fileName || 'Untitled'), filters: FILE_FILTERS });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return { filePath: result.filePath, fileName: path.basename(result.filePath) };
});

ipcMain.handle('spellcheck:get-available', () => {
  try {
    return session.defaultSession.availableSpellCheckerLanguages;
  } catch (err) {
    return [];
  }
});

ipcMain.handle('spellcheck:get-enabled', () => {
  try {
    return session.defaultSession.getSpellCheckerLanguages();
  } catch (err) {
    return [];
  }
});

ipcMain.handle('spellcheck:set-languages', (event, langs) => {
  try {
    const ses = session.defaultSession;
    ses.setSpellCheckerLanguages(langs);
    const enabled = ses.getSpellCheckerLanguages();
    writePreferences({ ...readPreferences(), spellcheckLanguages: enabled });
    
    if (process.platform === 'darwin') {
      const win = windowFor(event);
      enabled.forEach((lang) => {
        win?.webContents.send('spellcheck:download-status', { lang, status: 'success' });
      });
    }
    return enabled;
  } catch (err) {
    return langs;
  }
});

ipcMain.handle('spellcheck:get-custom-words', () => readCustomDictionary());
ipcMain.handle('spellcheck:add-custom-word', (_event, candidate) => {
  const word = String(candidate || '').trim();
  if (!word || word.length > 100 || /[\r\n]/.test(word)) return readCustomDictionary();
  const preferences = readPreferences();
  const words = Array.isArray(preferences.customDictionary) ? preferences.customDictionary : [];
  if (!words.some((item) => item.toLocaleLowerCase() === word.toLocaleLowerCase())) words.push(word);
  preferences.customDictionary = words.sort((a, b) => a.localeCompare(b));
  writePreferences(preferences);
  try { session.defaultSession.addWordToSpellCheckerDictionary(word); } catch (_err) { /* unavailable on this platform */ }
  return preferences.customDictionary;
});
ipcMain.handle('spellcheck:remove-custom-word', (_event, candidate) => {
  const word = String(candidate || '').trim();
  const preferences = readPreferences();
  preferences.customDictionary = (Array.isArray(preferences.customDictionary) ? preferences.customDictionary : [])
    .filter((item) => item.toLocaleLowerCase() !== word.toLocaleLowerCase());
  writePreferences(preferences);
  try { session.defaultSession.removeWordFromSpellCheckerDictionary(word); } catch (_err) { /* unavailable on this platform */ }
  return preferences.customDictionary;
});

ipcMain.handle('shortcodes:get', () => readShortcodes());
ipcMain.handle('shortcodes:set', (_event, list) => writeShortcodes(list));

ipcMain.handle('preferences:get', () => readPreferences());
ipcMain.handle('icons:get', () => rendererIconUrls());
ipcMain.handle('preferences:set-theme', (_event, theme) => {
  if (theme !== 'light' && theme !== 'dark') return readPreferences();
  const preferences = { ...readPreferences(), theme };
  writePreferences(preferences);
  return preferences;
});
ipcMain.handle('preferences:set-font', (_event, { key, value } = {}) => {
  if (!['fontUI', 'fontText', 'fontHeading', 'fontCode'].includes(key) || typeof value !== 'string' || !value.trim()) {
    return readPreferences();
  }
  const preferences = { ...readPreferences(), [key]: value };
  writePreferences(preferences);
  return preferences;
});
ipcMain.handle('preferences:set-font-size', (_event, { key, value } = {}) => {
  if (!['fontSizeUi', 'fontSizeText', 'fontSizeHeading', 'fontSizeCode'].includes(key)) {
    return readPreferences();
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 6 || num > 96) return readPreferences();
  const preferences = { ...readPreferences(), [key]: num };
  writePreferences(preferences);
  return preferences;
});
ipcMain.handle('preferences:set-default-view', (_event, view) => {
  if (!['edit', 'live', 'preview'].includes(view)) return readPreferences();
  const preferences = { ...readPreferences(), defaultView: view };
  writePreferences(preferences);
  return preferences;
});
ipcMain.on('window:minimize', (event) => windowFor(event)?.minimize());
ipcMain.on('window:toggle-maximize', (event) => {
  const win = windowFor(event);
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('window:close', (event) => windowFor(event)?.close());
ipcMain.on('window:close-response', (event, shouldClose) => {
  const win = windowFor(event);
  if (!shouldClose || !win) return;
  allowCloseFlags.set(win, true);
  win.close();
});
