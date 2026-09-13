const { contextBridge, ipcRenderer } = require('electron');

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
  openFile: () => ipcRenderer.invoke('dialog:open'),
  saveFile: (payload) => ipcRenderer.invoke('file:save', payload),
  saveFileAs: (payload) => ipcRenderer.invoke('dialog:saveAs', payload),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  getIcons: () => ipcRenderer.invoke('icons:get'),
  setThemePreference: (theme) => ipcRenderer.invoke('preferences:set-theme', theme),
  setFontPreference: (key, value) => ipcRenderer.invoke('preferences:set-font', { key, value }),
  setFontSizePreference: (key, value) => ipcRenderer.invoke('preferences:set-font-size', { key, value }),
  setDefaultViewPreference: (view) => ipcRenderer.invoke('preferences:set-default-view', view),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  respondToWindowClose: (shouldClose) => ipcRenderer.send('window:close-response', shouldClose),
  onWindowCloseRequest: (callback) => ipcRenderer.on('window:request-close', () => callback()),
  onFileOpen: (callback) => ipcRenderer.on('file:open-path', (_event, data) => callback(data)),

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
