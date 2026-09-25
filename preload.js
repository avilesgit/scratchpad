const { contextBridge, ipcRenderer, webUtils } = require('electron');

function readBootPrefs() {
  const marker = '--boot-prefs=';
  const arg = process.argv.find((entry) => entry.startsWith(marker));
  if (!arg) return {};
  try {
    return JSON.parse(decodeURIComponent(arg.slice(marker.length)));
  } catch (_err) {
    return {};
  }
}
contextBridge.exposeInMainWorld('bootPrefs', readBootPrefs());

contextBridge.exposeInMainWorld('api', {
  windowId: ipcRenderer.sendSync('window:id'),
  getWindowBounds: () => ipcRenderer.sendSync('window:bounds'),
  openFile: () => ipcRenderer.invoke('dialog:open'),
  saveFile: (payload) => ipcRenderer.invoke('file:save', payload),
  saveFileAs: (payload) => ipcRenderer.invoke('dialog:saveAs', payload),
  autosaveFile: (payload) => ipcRenderer.invoke('file:autosave', payload),
  openExternal: (url) => ipcRenderer.send('link:open', url),
  editCommand: (command) => ipcRenderer.send('edit:command', command),
  setAutosavePreference: (enabled) => ipcRenderer.invoke('preferences:set-autosave', enabled),
  onAutosaveChanged: (callback) => ipcRenderer.on('autosave:changed', (_event, enabled) => callback(enabled)),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  getIcons: () => ipcRenderer.invoke('icons:get'),
  setThemePreference: (theme) => ipcRenderer.invoke('preferences:set-theme', theme),
  setFontPreference: (key, value) => ipcRenderer.invoke('preferences:set-font', { key, value }),
  setFontSizePreference: (key, value) => ipcRenderer.invoke('preferences:set-font-size', { key, value }),
  setDefaultViewPreference: (view) => ipcRenderer.invoke('preferences:set-default-view', view),
  setTabsEnabledPreference: (enabled) => ipcRenderer.invoke('preferences:set-tabs-enabled', enabled),
  setStatusBarPreference: (visible) => ipcRenderer.invoke('preferences:set-status-bar', visible),
  setWordWrapPreference: (enabled) => ipcRenderer.invoke('preferences:set-word-wrap', enabled),
  setTextWidthPreference: (width) => ipcRenderer.invoke('preferences:set-text-width', width),
  resetPreferences: () => ipcRenderer.invoke('preferences:reset'),
  saveSession: (payload) => ipcRenderer.invoke('session:save', payload),
  clearSession: () => ipcRenderer.send('session:clear'),
  onSessionRestore: (callback) => ipcRenderer.on('session:restore', (_event, data) => callback(data)),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  respondToWindowClose: (shouldClose, keepDraft) => ipcRenderer.send('window:close-response', shouldClose, keepDraft),
  onWindowCloseRequest: (callback) => ipcRenderer.on('window:request-close', () => callback()),
  onFileOpen: (callback) => ipcRenderer.on('file:open-path', (_event, data) => callback(data)),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openDroppedFiles: (filePaths) => ipcRenderer.send('file:open-dropped', filePaths),
  onTabShortcut: (callback) => ipcRenderer.on('tab:shortcut', (_event, shortcut) => callback(shortcut)),
  tabDragStart: (payload) => ipcRenderer.send('tab:drag-start', payload),
  tabDragMove: (payload) => ipcRenderer.send('tab:drag-move', payload),
  tabDragEnd: (payload) => ipcRenderer.send('tab:drag-end', payload),
  onTabDragState: (callback) => ipcRenderer.on('tab:drag-state', (_event, data) => callback(data)),
  onTabDropReorder: (callback) => ipcRenderer.on('tab:drop-reorder', (_event, data) => callback(data)),
  onTabTransferRemove: (callback) => ipcRenderer.on('tab:transfer-remove', (_event, data) => callback(data)),
  onTabAcceptTransfer: (callback) => ipcRenderer.on('tab:accept-transfer', (_event, data) => callback(data)),

  getSpellcheckAvailable: () => ipcRenderer.invoke('spellcheck:get-available'),
  getSpellcheckEnabled: () => ipcRenderer.invoke('spellcheck:get-enabled'),
  setSpellcheckLanguages: (langs) => ipcRenderer.invoke('spellcheck:set-languages', langs),
  getCustomDictionary: () => ipcRenderer.invoke('spellcheck:get-custom-words'),
  addCustomDictionaryWord: (word) => ipcRenderer.invoke('spellcheck:add-custom-word', word),
  removeCustomDictionaryWord: (word) => ipcRenderer.invoke('spellcheck:remove-custom-word', word),
  onSpellcheckDownloadStatus: (callback) => {
    ipcRenderer.on('spellcheck:download-status', (_event, data) => callback(data));
  },
  onSpellcheckContextMenu: (callback) => ipcRenderer.on('spellcheck:context-menu', (_event, data) => callback(data)),
  onSynonymsContextMenu: (callback) => ipcRenderer.on('synonyms:context-menu', (_event, data) => callback(data)),

  getShortcodes: () => ipcRenderer.invoke('shortcodes:get'),
  setShortcodes: (list) => ipcRenderer.invoke('shortcodes:set', list)
});
