(function () {
  const filenameInput = document.getElementById('filename');
  const fileTypeIcon = document.getElementById('fileTypeIcon');
  const modeSelect = document.getElementById('modeSelect');
  const viewSelect = document.getElementById('viewSelect');
  const openBtn = document.getElementById('openBtn');
  const saveBtn = document.getElementById('saveBtn');
  const saveAsBtn = document.getElementById('saveAsBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const themeLightBtn = document.getElementById('themeLightBtn');
  const themeDarkBtn = document.getElementById('themeDarkBtn');
  const fontUiSelect = document.getElementById('fontUiSelect');
  const fontTextSelect = document.getElementById('fontTextSelect');
  const fontHeadingSelect = document.getElementById('fontHeadingSelect');
  const fontCodeSelect = document.getElementById('fontCodeSelect');
  const fontUiSizeInput = document.getElementById('fontUiSizeInput');
  const fontTextSizeInput = document.getElementById('fontTextSizeInput');
  const fontHeadingSizeInput = document.getElementById('fontHeadingSizeInput');
  const fontCodeSizeInput = document.getElementById('fontCodeSizeInput');
  const defaultViewSelect = document.getElementById('defaultViewSelect');
  const minimizeBtn = document.getElementById('minimizeBtn');
  const maximizeBtn = document.getElementById('maximizeBtn');
  const closeBtn = document.getElementById('closeBtn');
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmMessage = document.getElementById('confirmMessage');
  const confirmOkBtn = document.getElementById('confirmOkBtn');
  const confirmCancelBtn = document.getElementById('confirmCancelBtn');

  function askConfirm(message) {
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
      confirmOverlay.classList.remove('hidden');

      const cleanup = (result) => {
        confirmOverlay.classList.add('hidden');
        confirmOkBtn.removeEventListener('click', onOk);
        confirmCancelBtn.removeEventListener('click', onCancel);
        confirmOverlay.removeEventListener('click', onOverlayClick);
        document.removeEventListener('keydown', onKeydown, true);
        resolve(result);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onOverlayClick = (event) => {
        if (event.target === confirmOverlay) cleanup(false);
      };
      const onKeydown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); cleanup(false); }
        else if (event.key === 'Enter') { event.preventDefault(); cleanup(true); }
      };

      confirmOkBtn.addEventListener('click', onOk);
      confirmCancelBtn.addEventListener('click', onCancel);
      confirmOverlay.addEventListener('click', onOverlayClick);
      document.addEventListener('keydown', onKeydown, true);
      confirmCancelBtn.focus({ preventScroll: true });
    });
  }

  let currentFilePath = null;
  const DEFAULT_FILE_NAME = 'Untitled';
  let currentFileName = DEFAULT_FILE_NAME;
  let iconUrls = {};

  function suggestedFileName(content) {
    if (currentFilePath || currentFileName !== DEFAULT_FILE_NAME) return currentFileName;
    const firstLine = (content || '').split(/\r\n|\r|\n/)[0] || '';
    const cleaned = firstLine
      .replace(/^#{1,6}\s+/, '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    return cleaned || currentFileName;
  }

  const MODE_EXTENSIONS = { text: 'txt', markdown: 'md', bbcode: 'bb' };
  function defaultExtensionForMode(mode) {
    return MODE_EXTENSIONS[mode] || 'txt';
  }

  function nameForSave(content) {
    const name = suggestedFileName(content);
    if (currentFilePath || /\.[^./\\]+$/.test(name)) return name;
    const mode = window.Editor?.getState?.().mode;
    return `${name}.${defaultExtensionForMode(mode)}`;
  }

  function iconTypeForFileName(fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    if (ext === 'md' || ext === 'markdown') return 'md';
    if (ext === 'bbcode' || ext === 'bb' || ext === 'scratch') return 'bb';
    return 'txt';
  }

  function updateDocumentIcon() {
    if (!fileTypeIcon) return;
    const src = iconUrls[iconTypeForFileName(currentFileName)];
    fileTypeIcon.src = src || '';
    fileTypeIcon.classList.toggle('has-icon', !!src);
  }

  function updateFilenameDisplay(dirty) {
    if (!filenameInput || document.activeElement === filenameInput) return;
    const isDirty = typeof dirty === 'boolean' ? dirty : !!window.Editor?.isDirty?.();
    filenameInput.value = currentFileName + (isDirty ? '*' : '');
  }

  window.addEventListener('editor:dirty-change', (event) => {
    updateFilenameDisplay(event.detail?.dirty);
  });

  filenameInput?.addEventListener('focus', () => {
    filenameInput.value = currentFileName;
  });
  filenameInput?.addEventListener('blur', () => {
    updateFilenameDisplay();
  });

  const DEFAULT_FONT_SIZES = { fontSizeUi: 12, fontSizeText: 12, fontSizeHeading: 26, fontSizeCode: 11 };

  function applyFontSizeInputValue(input, value, fallback) {
    if (!input) return;
    const num = Number(value);
    input.value = Number.isFinite(num) && num > 0 ? num : fallback;
  }

  async function initUI() {
    const preferences = await window.api?.getPreferences?.();
    if (preferences?.theme === 'dark' || preferences?.theme === 'light') {
      document.documentElement.dataset.theme = preferences.theme;
    }
    applyFontSelectValue(fontUiSelect, preferences?.fontUI);
    applyFontSelectValue(fontTextSelect, preferences?.fontText);
    applyFontSelectValue(fontHeadingSelect, preferences?.fontHeading);
    applyFontSelectValue(fontCodeSelect, preferences?.fontCode);
    applyFontSizeInputValue(fontUiSizeInput, preferences?.fontSizeUi, DEFAULT_FONT_SIZES.fontSizeUi);
    applyFontSizeInputValue(fontTextSizeInput, preferences?.fontSizeText, DEFAULT_FONT_SIZES.fontSizeText);
    applyFontSizeInputValue(fontHeadingSizeInput, preferences?.fontSizeHeading, DEFAULT_FONT_SIZES.fontSizeHeading);
    applyFontSizeInputValue(fontCodeSizeInput, preferences?.fontSizeCode, DEFAULT_FONT_SIZES.fontSizeCode);
    updateThemeButtons();
    iconUrls = await window.api?.getIcons?.() || {};
    updateDocumentIcon();
    if (window.Editor?.init) {
      window.Editor.init();
    }
    const defaultView = ['edit', 'live', 'preview'].includes(preferences?.defaultView) ? preferences.defaultView : 'edit';
    window.Editor?.setView?.(defaultView);
    if (defaultViewSelect) defaultViewSelect.value = defaultView;
    updateViewSelectAvailability();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }

  function updateViewSelectAvailability() {
    if (!viewSelect || !window.Editor) return;
    const state = window.Editor.getState();
    viewSelect.disabled = state.mode === 'text';
    viewSelect.value = state.view;
    if (modeSelect) modeSelect.value = state.mode;
  }

  function detectModeFromFileName(fileName) {
    if (!fileName) return 'text';
    const ext = fileName.split('.').pop().toLowerCase();
    if (ext === 'md' || ext === 'markdown') return 'markdown';
    if (ext === 'bbcode' || ext === 'bb') return 'bbcode';
    return 'text';
  }

  modeSelect?.addEventListener('change', () => {
    if (!window.Editor) return;
    window.Editor.setMode(modeSelect.value);
    updateViewSelectAvailability();
  });

  viewSelect?.addEventListener('change', () => {
    if (window.Editor) {
      window.Editor.setView(viewSelect.value);
    }
  });

  // Settings panel
  function setTheme(next) {
    document.documentElement.dataset.theme = next;
    updateThemeButtons();
    window.api?.setThemePreference?.(next);
  }

  function updateThemeButtons() {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    themeLightBtn?.classList.toggle('active', theme === 'light');
    themeDarkBtn?.classList.toggle('active', theme === 'dark');
  }

  function applyFontSelectValue(select, value) {
    if (!select || !value) return;
    const hasOption = Array.from(select.options).some((option) => option.value === value);
    if (hasOption) select.value = value;
  }

  function setFontVariable(cssVar, prefKey, value) {
    document.documentElement.style.setProperty(cssVar, value);
    window.api?.setFontPreference?.(prefKey, value);
  }

  function wireFontSizeInput(input, cssVar, prefKey) {
    if (!input) return;
    const apply = () => {
      const num = parseFloat(input.value);
      if (Number.isFinite(num) && num > 0) document.documentElement.style.setProperty(cssVar, num + 'px');
      return num;
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', () => {
      const num = apply();
      if (Number.isFinite(num) && num > 0) window.api?.setFontSizePreference?.(prefKey, num);
    });
  }

  themeLightBtn?.addEventListener('click', () => setTheme('light'));
  themeDarkBtn?.addEventListener('click', () => setTheme('dark'));
  fontUiSelect?.addEventListener('change', () => setFontVariable('--font-ui', 'fontUI', fontUiSelect.value));
  fontTextSelect?.addEventListener('change', () => setFontVariable('--font-text', 'fontText', fontTextSelect.value));
  fontHeadingSelect?.addEventListener('change', () => setFontVariable('--font-heading', 'fontHeading', fontHeadingSelect.value));
  fontCodeSelect?.addEventListener('change', () => setFontVariable('--font-code', 'fontCode', fontCodeSelect.value));
  wireFontSizeInput(fontUiSizeInput, '--font-size-ui', 'fontSizeUi');
  wireFontSizeInput(fontTextSizeInput, '--font-size-text', 'fontSizeText');
  wireFontSizeInput(fontHeadingSizeInput, '--font-size-heading', 'fontSizeHeading');
  wireFontSizeInput(fontCodeSizeInput, '--font-size-code', 'fontSizeCode');
  defaultViewSelect?.addEventListener('change', () => window.api?.setDefaultViewPreference?.(defaultViewSelect.value));
  
  updateThemeButtons();

  settingsBtn?.addEventListener('click', () => settingsPanel?.classList.toggle('hidden'));
  document.addEventListener('click', (event) => {
    const path = event.composedPath();
    if (settingsPanel && !path.includes(settingsPanel) && !path.includes(settingsBtn)) {
      settingsPanel.classList.add('hidden');
    }
  });

  minimizeBtn?.addEventListener('click', () => window.api?.minimizeWindow?.());
  maximizeBtn?.addEventListener('click', () => window.api?.toggleMaximizeWindow?.());
  closeBtn?.addEventListener('click', () => window.api?.closeWindow?.());

  filenameInput?.addEventListener('change', () => {
    currentFileName = (filenameInput.value || DEFAULT_FILE_NAME).replace(/\*+$/, '');
    updateDocumentIcon();
    updateFilenameDisplay();
  });

  openBtn?.addEventListener('click', async () => {
    if (!window.api || !window.Editor) return;
    const result = await window.api.openFile();
    if (!result) return;
    loadFileResult(result);
  });

  function loadFileResult(result) {
    window.Editor.setContent(result.content);
    currentFilePath = result.filePath;
    currentFileName = result.fileName || DEFAULT_FILE_NAME;
    updateDocumentIcon();
    updateFilenameDisplay(false);
    const detectedMode = detectModeFromFileName(currentFileName);
    window.Editor.setMode(detectedMode);
    if (modeSelect) modeSelect.value = detectedMode;
    updateViewSelectAvailability();
  }

  async function doSave() {
    if (!window.api || !window.Editor) return;
    const content = window.Editor.getContent();
    const result = await window.api.saveFile({ filePath: currentFilePath, fileName: nameForSave(content), content });
    if (result) {
      currentFilePath = result.filePath;
      currentFileName = result.fileName || currentFileName;
      updateDocumentIcon();
      window.Editor.markSaved();
      updateFilenameDisplay(false);
    }
  }

  async function doSaveAs() {
    if (!window.api || !window.Editor) return;
    const content = window.Editor.getContent();
    const result = await window.api.saveFileAs({ fileName: nameForSave(content), content });
    if (result) {
      currentFilePath = result.filePath;
      currentFileName = result.fileName || currentFileName;
      updateDocumentIcon();
      window.Editor.markSaved();
      updateFilenameDisplay(false);
    }
  }

  saveBtn?.addEventListener('click', doSave);
  saveAsBtn?.addEventListener('click', doSaveAs);

  window.addEventListener('keydown', (event) => {
    const isMod = event.metaKey || event.ctrlKey;
    if (isMod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (event.shiftKey) {
        doSaveAs();
      } else {
        doSave();
      }
    }
  });

  window.api?.onFileOpen?.(async (result) => {
    const caret = window.Editor?.getCaret?.();
    if (!window.Editor.isDirty() || await askConfirm('You have unsaved changes. Open another file anyway?')) {
      loadFileResult(result);
    } else {
      window.Editor?.restoreFocus?.(caret);
    }
  });

  window.api?.onWindowCloseRequest?.(async () => {
    const caret = window.Editor?.getCaret?.();
    const mayClose = !window.Editor?.isDirty?.() || await askConfirm('You have unsaved changes. Close without saving?');
    if (mayClose) {
      window.api.respondToWindowClose(true);
    } else {
      window.Editor?.restoreFocus?.(caret);
      window.api.respondToWindowClose(false);
    }
  });
})();
