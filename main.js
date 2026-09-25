const { app, BrowserWindow, ipcMain, dialog, Menu, session, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const windows = new Set();
const allowCloseFlags = new WeakMap();
let pendingFilePath = null;

const ICONS_DIRECTORY = path.join(__dirname, 'assets', 'icons');
const FALLBACK_ICON = path.join(__dirname, 'icon_256.png');
const sessionIdForWindow = new WeakMap();
const tabDragStates = new WeakMap();

function sessionsDirectory() { return path.join(app.getPath('userData'), '.sessions'); }
function ensureSessionsDirectory() {
  try { fs.mkdirSync(sessionsDirectory(), { recursive: true }); } catch (_err) {}
}
function sessionFilePath(id) { return path.join(sessionsDirectory(), `${id}.json`); }
function createSessionId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
function writeSessionFile(id, data) {
  ensureSessionsDirectory();
  try { fs.writeFileSync(sessionFilePath(id), JSON.stringify(data), 'utf8'); } catch (_err) {}
}
function deleteSessionFile(id) {
  try { fs.unlinkSync(sessionFilePath(id)); } catch (_err) {}
}
function readSessionFiles() {
  ensureSessionsDirectory();
  let entries = [];
  try { entries = fs.readdirSync(sessionsDirectory()); } catch (_err) { entries = []; }
  return entries
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        return { id: name.slice(0, -5), data: JSON.parse(fs.readFileSync(path.join(sessionsDirectory(), name), 'utf8')) };
      } catch (_err) {
        return null;
      }
    })
    .filter(Boolean);
}
function sessionIdFor(win) {
  let id = sessionIdForWindow.get(win);
  if (!id) {
    id = createSessionId();
    sessionIdForWindow.set(win, id);
  }
  return id;
}

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
    defaultView: ['edit', 'live', 'preview'].includes(preferences.defaultView) ? preferences.defaultView : 'edit',
    tabsEnabled: preferences.tabsEnabled === true,
    statusBar: preferences.statusBar !== false,
    wordWrap: preferences.wordWrap !== false,
    textWidth: preferences.textWidth === 'wide' ? 'wide' : 'standard'
  };
}

function readCustomDictionary() {
  const words = readPreferences().customDictionary;
  return Array.isArray(words) ? words.filter((word) => typeof word === 'string') : [];
}

function applyCustomDictionary(ses) {
  readCustomDictionary().forEach((word) => {
    try { ses.addWordToSpellCheckerDictionary(word); } catch (_err) {}
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

function openExternalUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl)); } catch (_err) { return false; }
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return false;
  shell.openExternal(parsed.href).catch(() => {});
  return true;
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
  } catch (err) {}

  ses.on('spellcheck-dictionary-download-success', (_event, lang) => broadcast('spellcheck:download-status', { lang, status: 'success' }));
  ses.on('spellcheck-dictionary-download-begin', (_event, lang) => broadcast('spellcheck:download-status', { lang, status: 'begin' }));
  ses.on('spellcheck-dictionary-download-failure', (_event, lang) => broadcast('spellcheck:download-status', { lang, status: 'failure' }));
  ses.on('spellcheck-dictionary-initialized', (_event, lang) => broadcast('spellcheck:download-status', { lang, status: 'success' }));
}

function createWindow(filePath, restoredSession, initialTab) {
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
  sessionIdForWindow.set(win, restoredSession ? restoredSession.id : createSessionId());
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
    if (restoredSession) win.webContents.send('session:restore', restoredSession.data);
    if (initialTab) win.webContents.send('tab:accept-transfer', { tab: initialTab.tab, sourceWindowId: initialTab.sourceWindowId, detached: initialTab.detached === true });
    if (filePath) sendFileToRenderer(win, filePath);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    openExternalUrl(url);
  });

  win.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    const isMod = input.control || input.meta;
    const isDevToolsShortcut = isMod && input.shift && ['i', 'j', 'c'].includes(key);
    if (input.type === 'keyDown' && input.control && !input.alt && !input.meta && key === 'tab' && readPreferences().tabsEnabled === true) {
      event.preventDefault();
      win.webContents.send('tab:shortcut', input.shift ? 'prev' : 'next');
      return;
    }
    if (isMod && ['t', 'w'].includes(key) && readPreferences().tabsEnabled === true) {
      event.preventDefault();
      win.webContents.send('tab:shortcut', input.shift && key === 't' ? 'reopen' : key === 't' ? 'new' : 'close');
      return;
    }
    if (input.key === 'F5' || input.key === 'F12' || isDevToolsShortcut || (isMod && ['n', 'o', 'p', 'q', 'r'].includes(key))) event.preventDefault();
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
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('window:request-close');
  });

  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  wireSharedSpellcheckSession();
  const bootTabsEnabled = bootPreferences().tabsEnabled;
  let restorable = readSessionFiles().filter((entry) => {
    if (!entry.data) return false;
    if (entry.data.restore !== true) return false;
    if (bootTabsEnabled && Array.isArray(entry.data.tabs) && entry.data.tabs.length) return true;
    return entry.data.dirty === true;
  }).sort((a, b) => Number(b.data.savedAt || 0) - Number(a.data.savedAt || 0));
  const restoredSession = restorable[0] || null;
  if (restoredSession) {
    restorable.slice(1).forEach((entry) => deleteSessionFile(entry.id));
    createWindow(pendingFilePath, restoredSession);
  } else {
    createWindow(pendingFilePath);
  }
  pendingFilePath = null;
});

function openFileInExistingTabsWindow(filePath) {
  if (!filePath || readPreferences().tabsEnabled !== true) return false;
  const target = BrowserWindow.getFocusedWindow() || windows.values().next().value;
  if (!target || target.isDestroyed()) return false;
  if (target.isMinimized()) target.restore();
  target.focus();
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    target.webContents.send('file:open-path', { filePath, content, fileName: path.basename(filePath) });
    return true;
  } catch (_err) {
    return false;
  }
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  pendingFilePath = getOpenablePath(process.argv);
  app.on('second-instance', (_event, commandLine) => {
    const filePath = getOpenablePath(commandLine);
    if (filePath) {
      if (!openFileInExistingTabsWindow(filePath)) createWindow(filePath);
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
  if (app.isReady()) {
    if (!openFileInExistingTabsWindow(filePath)) createWindow(filePath);
  } else pendingFilePath = filePath;
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
  const filePath = result.filePaths[0];
  if (readPreferences().tabsEnabled === true) {
    const content = fs.readFileSync(filePath, 'utf8');
    return { filePath, content, fileName: path.basename(filePath) };
  }
  createWindow(filePath);
  return null;
});

ipcMain.on('file:open-dropped', (event, filePaths) => {
  const win = windowFor(event);
  const paths = Array.isArray(filePaths) ? filePaths.filter((entry) => typeof entry === 'string' && entry) : [];
  const tabsEnabled = readPreferences().tabsEnabled === true;
  paths.forEach((filePath) => {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;
    if (tabsEnabled && win && !win.isDestroyed()) {
      sendFileToRenderer(win, filePath);
    } else {
      createWindow(filePath);
    }
  });
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

ipcMain.handle('file:autosave', (_event, { filePath, content } = {}) => {
  if (typeof filePath !== 'string' || typeof content !== 'string' || !path.isAbsolute(filePath)) return null;
  try {
    if (!fs.statSync(filePath).isFile()) return null;
    fs.writeFileSync(filePath, content, 'utf-8');
    return { filePath, fileName: path.basename(filePath) };
  } catch (_err) {
    return null;
  }
});

ipcMain.on('link:open', (_event, url) => { openExternalUrl(url); });

ipcMain.on('edit:command', (event, command) => {
  const contents = event.sender;
  if (command === 'cut') contents.cut();
  else if (command === 'copy') contents.copy();
  else if (command === 'paste') contents.paste();
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

ipcMain.on('window:id', (event) => { event.returnValue = windowFor(event)?.id || 0; });
ipcMain.on('window:bounds', (event) => { event.returnValue = windowFor(event)?.getBounds() || null; });
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
ipcMain.handle('preferences:reset', () => {
  const preferences = {
    ...readPreferences(),
    theme: 'light',
    fontUI: DEFAULT_FONTS.fontUI,
    fontText: DEFAULT_FONTS.fontText,
    fontHeading: DEFAULT_FONTS.fontHeading,
    fontCode: DEFAULT_FONTS.fontCode,
    fontSizeUi: DEFAULT_FONT_SIZES.fontSizeUi,
    fontSizeText: DEFAULT_FONT_SIZES.fontSizeText,
    fontSizeHeading: DEFAULT_FONT_SIZES.fontSizeHeading,
    fontSizeCode: DEFAULT_FONT_SIZES.fontSizeCode,
    defaultView: 'edit',
    tabsEnabled: false,
    statusBar: true,
    wordWrap: true,
    textWidth: 'standard',
  };
  writePreferences(preferences);
  return preferences;
});
ipcMain.handle('preferences:set-tabs-enabled', (_event, enabled) => {
  const preferences = { ...readPreferences(), tabsEnabled: enabled === true };
  writePreferences(preferences);
  return preferences;
});
ipcMain.handle('preferences:set-status-bar', (_event, visible) => {
  const preferences = { ...readPreferences(), statusBar: visible !== false };
  writePreferences(preferences);
  return preferences;
});
ipcMain.handle('preferences:set-word-wrap', (_event, enabled) => {
  const preferences = { ...readPreferences(), wordWrap: enabled !== false };
  writePreferences(preferences);
  return preferences;
});
ipcMain.handle('preferences:set-text-width', (_event, width) => {
  const preferences = { ...readPreferences(), textWidth: width === 'wide' ? 'wide' : 'standard' };
  writePreferences(preferences);
  return preferences;
});
ipcMain.handle('preferences:set-autosave', (_event, enabled) => {
  const preferences = { ...readPreferences(), autosave: enabled === true };
  writePreferences(preferences);
  broadcast('autosave:changed', preferences.autosave);
  return preferences;
});
ipcMain.handle('preferences:set-default-view', (_event, view) => {
  if (!['edit', 'live', 'preview'].includes(view)) return readPreferences();
  const preferences = { ...readPreferences(), defaultView: view };
  writePreferences(preferences);
  return preferences;
});
function sendTabDragState(sourceWindow, state) {
  windows.forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('tab:drag-state', state);
  });
}

function findWindowAtPoint(point, sourceWindow = null) {
  if (sourceWindow && !sourceWindow.isDestroyed()) {
    const sourceBounds = sourceWindow.getBounds();
    if (point.x >= sourceBounds.x && point.x <= sourceBounds.x + sourceBounds.width &&
        point.y >= sourceBounds.y && point.y <= sourceBounds.y + sourceBounds.height) {
      return sourceWindow;
    }
  }
  for (const win of windows) {
    if (win.isDestroyed() || win === sourceWindow) continue;
    const bounds = win.getBounds();
    if (point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height) return win;
  }
  return null;
}

ipcMain.on('tab:drag-start', (event, payload) => {
  const win = windowFor(event);
  if (!win || !payload?.tab) return;
  tabDragStates.set(win, { tab: payload.tab, index: Number(payload.index), tabCount: Math.max(1, Number(payload.tabCount) || 1) });
  sendTabDragState(win, { active: true, sourceWindowId: win.id, index: Number(payload.index), x: null, y: null, targetWindowId: null });
});

ipcMain.on('tab:drag-move', (event, payload) => {
  const sourceWindow = windowFor(event);
  const state = tabDragStates.get(sourceWindow);
  if (!sourceWindow || !state) return;
  const point = { x: Number(payload?.screenX), y: Number(payload?.screenY) };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const targetWindow = findWindowAtPoint(point, sourceWindow);
  const sourceBounds = sourceWindow.getBounds();
  const sourceTabsTop = Number(payload?.tabsTop);
  const sourceTabsBottom = Number(payload?.tabsBottom);
  const sourceTabsLeft = Number(payload?.tabsLeft);
  const sourceTabsRight = Number(payload?.tabsRight);
  let tabsTop = Number.isFinite(sourceTabsTop) ? sourceTabsTop : sourceBounds.y;
  let tabsBottom = Number.isFinite(sourceTabsBottom) ? sourceTabsBottom : sourceBounds.y;
  let tabsLeft = Number.isFinite(sourceTabsLeft) ? sourceTabsLeft : sourceBounds.x;
  let tabsRight = Number.isFinite(sourceTabsRight) ? sourceTabsRight : sourceBounds.x + sourceBounds.width;
  if (targetWindow && targetWindow.id !== sourceWindow.id) {
    const targetBounds = targetWindow.getBounds();
    const topOffset = Number.isFinite(sourceTabsTop) ? sourceTabsTop - sourceBounds.y : 0;
    const bottomOffset = Number.isFinite(sourceTabsBottom) ? sourceTabsBottom - sourceBounds.y : 34;
    tabsTop = targetBounds.y + topOffset;
    tabsBottom = targetBounds.y + bottomOffset;
  }
  const insideTabsSection = point.x >= tabsLeft && point.x <= tabsRight && point.y >= tabsTop && point.y <= tabsBottom;
  const verticalDetach = !insideTabsSection && (point.y < tabsTop || point.y > tabsBottom);
  sendTabDragState(sourceWindow, {
    active: true,
    sourceWindowId: sourceWindow.id,
    index: state.index,
    x: point.x,
    y: point.y,
    targetWindowId: targetWindow?.id || null,
    targetBounds: targetWindow ? targetWindow.getBounds() : null,
    verticalDetach: verticalDetach && state.tabCount > 1,
    canDetach: state.tabCount > 1
  });
});

ipcMain.on('tab:drag-end', (event, payload) => {
  const sourceWindow = windowFor(event);
  const state = tabDragStates.get(sourceWindow);
  tabDragStates.delete(sourceWindow);
  if (!sourceWindow || !state) return;
  const point = { x: Number(payload?.screenX), y: Number(payload?.screenY) };
  const targetWindow = Number.isFinite(point.x) && Number.isFinite(point.y) ? findWindowAtPoint(point, sourceWindow) : null;
  const sourceBounds = sourceWindow.getBounds();
  const sourceTabsTop = Number(payload?.tabsTop);
  const sourceTabsBottom = Number(payload?.tabsBottom);
  const sourceTabsLeft = Number(payload?.tabsLeft);
  const sourceTabsRight = Number(payload?.tabsRight);
  let tabsTop = Number.isFinite(sourceTabsTop) ? sourceTabsTop : sourceBounds.y;
  let tabsBottom = Number.isFinite(sourceTabsBottom) ? sourceTabsBottom : sourceBounds.y;
  let tabsLeft = Number.isFinite(sourceTabsLeft) ? sourceTabsLeft : sourceBounds.x;
  let tabsRight = Number.isFinite(sourceTabsRight) ? sourceTabsRight : sourceBounds.x + sourceBounds.width;
  if (targetWindow && targetWindow.id !== sourceWindow.id) {
    const targetBounds = targetWindow.getBounds();
    const topOffset = Number.isFinite(sourceTabsTop) ? sourceTabsTop - sourceBounds.y : 0;
    const bottomOffset = Number.isFinite(sourceTabsBottom) ? sourceTabsBottom - sourceBounds.y : 34;
    tabsTop = targetBounds.y + topOffset;
    tabsBottom = targetBounds.y + bottomOffset;
  }
  const insideTabsSection = Number.isFinite(point.x) && point.x >= tabsLeft && point.x <= tabsRight && Number.isFinite(point.y) && point.y >= tabsTop && point.y <= tabsBottom;
  const verticalDetach = Number.isFinite(point.y) && !insideTabsSection && (point.y < tabsTop || point.y > tabsBottom);
  if (verticalDetach && state.tabCount > 1 && (targetWindow === null || targetWindow.id === sourceWindow.id)) {
    sourceWindow.webContents.send('tab:transfer-remove', { index: state.index, transfer: true });
    const newWindow = createWindow(null, null, { tab: { ...state.tab, filePath: null, dirty: true }, sourceWindowId: sourceWindow.id, detached: true });
    newWindow.once('ready-to-show', () => newWindow.focus());
    sendTabDragState(sourceWindow, { active: false });
    return;
  }
  if (!targetWindow) {
    sendTabDragState(sourceWindow, { active: false });
    return;
  }
  if (targetWindow.id === sourceWindow.id) {
    sourceWindow.webContents.send('tab:drop-reorder', { index: state.index, targetIndex: Number(payload?.targetIndex) });
  } else {
    sourceWindow.webContents.send('tab:transfer-remove', { index: state.index, transfer: true });
    targetWindow.webContents.send('tab:accept-transfer', { tab: state.tab, sourceWindowId: sourceWindow.id, screenX: point.x, transfer: true });
    if (targetWindow.isMinimized()) targetWindow.restore();
    targetWindow.focus();
  }
  sendTabDragState(sourceWindow, { active: false });
});

ipcMain.on('window:minimize', (event) => windowFor(event)?.minimize());
ipcMain.on('window:toggle-maximize', (event) => {
  const win = windowFor(event);
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('window:close', (event) => windowFor(event)?.close());
ipcMain.on('window:close-response', (event, shouldClose, keepDraft) => {
  const win = windowFor(event);
  if (!shouldClose || !win) return;
  const id = sessionIdForWindow.get(win);
  if (id && !keepDraft) deleteSessionFile(id);
  allowCloseFlags.set(win, true);
  win.close();
});

ipcMain.handle('session:save', (event, payload) => {
  const win = windowFor(event);
  if (!win) return;
  writeSessionFile(sessionIdFor(win), { ...payload, dirty: true, savedAt: Date.now() });
});
ipcMain.on('session:clear', (event) => {
  const win = windowFor(event);
  const id = win && sessionIdForWindow.get(win);
  if (id) deleteSessionFile(id);
});
