(function () {
  const filenameInput = document.getElementById('filename');
  const fileTypeIcon = document.getElementById('fileTypeIcon');
  const modeSelect = document.getElementById('modeSelect');
  const viewSelect = document.getElementById('viewSelect');
  const openBtn = document.getElementById('openBtn');
  const saveBtn = document.getElementById('saveBtn');
  const saveAsBtn = document.getElementById('saveAsBtn');
  const saveAllBtn = document.getElementById('saveAllBtn');
  const autosaveBtn = document.getElementById('autosaveBtn');
  const fileMenuBtn = document.getElementById('fileMenuBtn');
  const fileMenu = document.getElementById('fileMenu');
  const editMenuBtn = document.getElementById('editMenuBtn');
  const editMenu = document.getElementById('editMenu');
  const editorEl = document.getElementById('editor');
  const linkTooltip = document.getElementById('linkTooltip');
  const linkTooltipSite = document.getElementById('linkTooltipSite');
  const linkTooltipUrl = document.getElementById('linkTooltipUrl');
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
  const restoreDefaultsBtn = document.getElementById('restoreDefaultsBtn');
  const tabsBar = document.getElementById('tabsBar');
  const tabsList = document.getElementById('tabsList');
  const newTabBtn = document.getElementById('newTabBtn');
  const tabsEnabledInput = document.getElementById('tabsEnabledInput');
  const statusBarInput = document.getElementById('statusBarInput');
  const wordWrapInput = document.getElementById('wordWrapInput');
  const textWidthStandardBtn = document.getElementById('textWidthStandardBtn');
  const textWidthWideBtn = document.getElementById('textWidthWideBtn');
  const minimizeBtn = document.getElementById('minimizeBtn');
  const maximizeBtn = document.getElementById('maximizeBtn');
  const closeBtn = document.getElementById('closeBtn');
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmMessage = document.getElementById('confirmMessage');
  const confirmOkBtn = document.getElementById('confirmOkBtn');
  const confirmCancelBtn = document.getElementById('confirmCancelBtn');
  const confirmSaveDraftBtn = document.getElementById('confirmSaveDraftBtn');

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

  function askCloseConfirm(message) {
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
      confirmSaveDraftBtn?.classList.remove('hidden');
      confirmOverlay.classList.remove('hidden');

      const cleanup = (result) => {
        confirmOverlay.classList.add('hidden');
        confirmSaveDraftBtn?.classList.add('hidden');
        confirmOkBtn.removeEventListener('click', onDiscard);
        confirmCancelBtn.removeEventListener('click', onCancel);
        confirmSaveDraftBtn?.removeEventListener('click', onSaveDraft);
        confirmOverlay.removeEventListener('click', onOverlayClick);
        document.removeEventListener('keydown', onKeydown, true);
        resolve(result);
      };
      const onDiscard = () => cleanup('discard');
      const onCancel = () => cleanup('cancel');
      const onSaveDraft = () => cleanup('save');
      const onOverlayClick = (event) => {
        if (event.target === confirmOverlay) cleanup('cancel');
      };
      const onKeydown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); cleanup('cancel'); }
        else if (event.key === 'Enter') { event.preventDefault(); cleanup('discard'); }
      };

      confirmOkBtn.addEventListener('click', onDiscard);
      confirmCancelBtn.addEventListener('click', onCancel);
      confirmSaveDraftBtn?.addEventListener('click', onSaveDraft);
      confirmOverlay.addEventListener('click', onOverlayClick);
      document.addEventListener('keydown', onKeydown, true);
      confirmCancelBtn.focus({ preventScroll: true });
    });
  }

  let currentFilePath = null;
  const DEFAULT_FILE_NAME = 'Untitled';
  let currentFileName = DEFAULT_FILE_NAME;
  let iconUrls = {};
  let tabsEnabled = false;
  let tabs = [];
  let activeTabIndex = 0;
  let syncingTab = false;
  let closedTabs = [];
  let hasSavedDraft = false;
  let pendingSessionRestore = null;
  let pendingFileOpen = null;
  let pendingTabTransfer = null;
  let uiInitialized = false;
  let dragState = null;
  let dragPointer = null;
  let dragStarted = false;
  let suppressNextTabClick = false;
  let detachPreview = null;
  let defaultViewPreference = 'edit';
  let autosaveEnabled = false;
  let autosaveTimer = null;
  let autosavePromise = null;
  const AUTOSAVE_DELAY_MS = 1500;

  function makeTab(data = {}) {
    return {
      content: typeof data.content === 'string' ? data.content : '',
      filePath: data.filePath || null,
      fileName: data.fileName || DEFAULT_FILE_NAME,
      mode: ['text', 'markdown', 'bbcode'].includes(data.mode) ? data.mode : detectModeFromFileName(data.fileName || ''),
      view: ['edit', 'live', 'preview'].includes(data.view) ? data.view : defaultViewPreference,
      dirty: data.dirty === true,
      caret: data.caret && Number.isFinite(data.caret.line) && Number.isFinite(data.caret.offset)
        ? { line: data.caret.line, offset: data.caret.offset } : { line: 0, offset: 0 }
    };
  }

  function captureActiveTab() {
    if (!tabsEnabled || !tabs[activeTabIndex] || !window.Editor) return;
    const tab = tabs[activeTabIndex];
    tab.content = window.Editor.getContent();
    tab.filePath = currentFilePath;
    tab.fileName = currentFileName;
    const state = window.Editor.getState();
    tab.mode = state.mode;
    tab.view = state.view;
    tab.dirty = window.Editor.isDirty();
    tab.caret = window.Editor.getCaret?.() || tab.caret;
  }

  function getTabIndexAtClientX(clientX) {
    const tabButtons = Array.from(tabsList?.querySelectorAll('.tab') || []);
    for (let i = 0; i < tabButtons.length; i += 1) {
      const rect = tabButtons[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return i;
    }
    return tabButtons.length;
  }

  function clearTabDragVisuals() {
    tabsList?.querySelectorAll('.tab').forEach((element) => element.classList.remove('dragging'));
    const indicator = tabsList?.querySelector('.tab-drop-indicator');
    if (indicator) indicator.remove();
    if (detachPreview) { detachPreview.remove(); detachPreview = null; }
  }

  function showTabDropIndicator(index) {
    if (!tabsList) return;
    const tabButtons = Array.from(tabsList.querySelectorAll('.tab'));
    const indicator = document.createElement('span');
    indicator.className = 'tab-drop-indicator';
    const listRect = tabsList.getBoundingClientRect();
    let left = 0;
    if (tabButtons.length) {
      if (index < tabButtons.length) {
        left = tabButtons[index].getBoundingClientRect().left - listRect.left + tabsList.scrollLeft - 1;
      } else {
        const last = tabButtons[tabButtons.length - 1].getBoundingClientRect();
        left = last.right - listRect.left + tabsList.scrollLeft + 1;
      }
    }
    indicator.style.left = `${Math.max(0, left)}px`;
    tabsList.appendChild(indicator);
  }

  function updateTabDragVisuals() {
    clearTabDragVisuals();
    if (!dragState?.active || !tabsList) return;
    if (dragState.sourceWindowId === window.api?.windowId) {
      tabsList.querySelector(`.tab:nth-child(${dragState.index + 1})`)?.classList.add('dragging');
    }
    if (dragState.verticalDetach && dragState.sourceWindowId === window.api?.windowId) {
      const bounds = window.api?.getWindowBounds?.();
      detachPreview = document.createElement('div');
      detachPreview.className = 'tab-detach-preview';
      detachPreview.textContent = tabs[dragState.index]?.fileName || DEFAULT_FILE_NAME;
      detachPreview.style.left = `${dragState.x - (bounds?.x || 0) + 12}px`;
      detachPreview.style.top = `${dragState.y - (bounds?.y || 0) + 12}px`;
      document.body.appendChild(detachPreview);
    }
    if (dragState.targetWindowId === window.api?.windowId && !dragState.verticalDetach) {
      const bounds = dragState.targetBounds;
      if (!bounds || !Number.isFinite(dragState.x)) return;
      const clientX = dragState.x - bounds.x;
      const targetIndex = Math.max(0, Math.min(tabs.length, getTabIndexAtClientX(clientX)));
      showTabDropIndicator(targetIndex);
    }
  }

  function renderTabs() {
    if (!tabsBar || !tabsList) return;
    tabsBar.classList.toggle('hidden', !tabsEnabled);
    tabsList.innerHTML = '';
    if (!tabsEnabled) return;
    tabs.forEach((tab, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tab${index === activeTabIndex ? ' active' : ''}`;
      button.title = tab.fileName + (tab.dirty ? ' — Unsaved changes' : '');
      button.setAttribute('aria-selected', index === activeTabIndex ? 'true' : 'false');
      button.addEventListener('click', () => {
        if (suppressNextTabClick) {
          suppressNextTabClick = false;
          return;
        }
        if (!dragStarted) switchTab(index);
      });
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('.tab-close')) return;
        dragPointer = { index, pointerId: event.pointerId, startX: event.screenX, startY: event.screenY };
        dragStarted = false;
        button.setPointerCapture?.(event.pointerId);
      });
      button.addEventListener('dragstart', (event) => event.preventDefault());

      const name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = tab.fileName || DEFAULT_FILE_NAME;
      const dirty = document.createElement('span');
      dirty.className = 'tab-dirty';
      dirty.textContent = tab.dirty ? '•' : '';
      const close = document.createElement('span');
      close.className = 'tab-close';
      close.title = 'Close tab';
      close.setAttribute('aria-label', `Close ${tab.fileName || DEFAULT_FILE_NAME}`);
      close.setAttribute('role', 'button');
      close.tabIndex = 0;
      close.textContent = '×';
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        closeTab(index);
      });
      close.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          closeTab(index);
        }
      });
      button.append(name, dirty, close);
      tabsList.appendChild(button);
    });
    updateTabDragVisuals();
  }

  async function persistTabs() {
    if (!tabsEnabled || !window.api?.saveSession) return;
    captureActiveTab();
    return window.api.saveSession({
      tabs: tabs,
      activeTabIndex,
      content: tabs[activeTabIndex]?.content || '',
      filePath: tabs[activeTabIndex]?.filePath || null,
      fileName: tabs[activeTabIndex]?.fileName || DEFAULT_FILE_NAME,
      mode: tabs[activeTabIndex]?.mode || 'text',
      view: tabs[activeTabIndex]?.view || 'edit',
      dirty: tabs.some((tab) => tab.dirty),
      restore: hasSavedDraft
    });
  }

  function loadTabIntoEditor(tab) {
    syncingTab = true;
    try {
      currentFilePath = tab.filePath || null;
      currentFileName = tab.fileName || DEFAULT_FILE_NAME;
      window.Editor.setContent(tab.content || '');
      window.Editor.setMode(tab.mode || detectModeFromFileName(currentFileName));
      window.Editor.setView(tab.view || 'edit');
    } finally {
      syncingTab = false;
    }
    if (tab.dirty) window.Editor.forceDirty();
    else window.Editor.markSaved();
    updateDocumentIcon();
    updateFilenameDisplay(tab.dirty);
    updateViewSelectAvailability();
    window.Editor.restoreFocus?.(tab.caret);
  }

  function switchTab(index) {
    if (!tabsEnabled || index === activeTabIndex || !tabs[index]) return;
    captureActiveTab();
    activeTabIndex = index;
    loadTabIntoEditor(tabs[activeTabIndex]);
    renderTabs();
    persistTabs();
  }

  function createNewTab(data = {}) {
    if (!tabsEnabled) return;
    captureActiveTab();
    tabs.push(makeTab(data));
    activeTabIndex = tabs.length - 1;
    loadTabIntoEditor(tabs[activeTabIndex]);
    renderTabs();
    persistTabs();
  }

  async function closeTab(index) {
    if (!tabs[index]) return;
    captureActiveTab();
    const tab = tabs[index];
    if (tab.dirty) {
      const choice = await askTabCloseConfirm(`"${tab.fileName || DEFAULT_FILE_NAME}" has unsaved changes. Discard them?`);
      if (!choice) return;
    }
    if (!tab.dirty) closedTabs.push(makeTab(tab));
    tabs.splice(index, 1);
    if (!tabs.length) {
      renderTabs();
      window.api?.closeWindow?.();
      return;
    }
    if (activeTabIndex >= tabs.length) activeTabIndex = tabs.length - 1;
    if (index < activeTabIndex) activeTabIndex -= 1;
    loadTabIntoEditor(tabs[activeTabIndex]);
    renderTabs();
    persistTabs();
  }

  function askTabCloseConfirm(message) {
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
      confirmSaveDraftBtn?.classList.add('hidden');
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

  function removeTransferredTab(index) {
    if (!tabs[index]) return;
    captureActiveTab();
    tabs.splice(index, 1);
    if (!tabs.length) {
      renderTabs();
      window.api?.closeWindow?.();
      return;
    }
    if (index < activeTabIndex) activeTabIndex -= 1;
    if (activeTabIndex >= tabs.length) activeTabIndex = tabs.length - 1;
    loadTabIntoEditor(tabs[activeTabIndex]);
    renderTabs();
    persistTabs();
  }

  function reorderTab(index, targetIndex) {
    if (!tabs[index]) return;
    captureActiveTab();
    const destination = Math.max(0, Math.min(tabs.length - 1, Number(targetIndex)));
    if (index === destination) return;
    const [tab] = tabs.splice(index, 1);
    tabs.splice(destination, 0, tab);
    if (activeTabIndex === index) activeTabIndex = destination;
    else if (index < activeTabIndex && destination >= activeTabIndex) activeTabIndex -= 1;
    else if (index > activeTabIndex && destination <= activeTabIndex) activeTabIndex += 1;
    renderTabs();
    persistTabs();
  }

  function acceptTransferredTab(tab, screenX, detached = false) {
    if (!tabsEnabled || !tab) return;
    captureActiveTab();
    const bounds = window.api?.getWindowBounds?.();
    const clientX = bounds && Number.isFinite(Number(screenX)) ? Number(screenX) - bounds.x : Number.POSITIVE_INFINITY;
    const destination = Number.isFinite(clientX) ? Math.max(0, Math.min(tabs.length, getTabIndexAtClientX(clientX))) : tabs.length;
    const onlyBlankTab = tabs.length === 1 && activeTabIndex === 0 && !tabs[0].filePath && tabs[0].fileName === DEFAULT_FILE_NAME && tabs[0].content === '' && !tabs[0].dirty;
    if (onlyBlankTab) {
      tabs[0] = makeTab(detached ? { ...tab, filePath: null, dirty: true } : tab);
      activeTabIndex = 0;
    } else {
      tabs.splice(destination, 0, makeTab(detached ? { ...tab, filePath: null, dirty: true } : tab));
      activeTabIndex = destination;
    }
    loadTabIntoEditor(tabs[activeTabIndex]);
    renderTabs();
    if (tabs[activeTabIndex]?.dirty) {
      hasSavedDraft = true;
      persistTabs();
    } else if (hasSavedDraft) {
      persistTabs();
    }
  }

  function cycleTab(delta) {
    if (!tabsEnabled || tabs.length < 2) return;
    switchTab((activeTabIndex + delta + tabs.length) % tabs.length);
    tabsList?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function reopenClosedTab() {
    if (!tabsEnabled || !closedTabs.length) return;
    captureActiveTab();
    const tab = closedTabs.pop();
    tabs.push(makeTab(tab));
    activeTabIndex = tabs.length - 1;
    loadTabIntoEditor(tabs[activeTabIndex]);
    renderTabs();
    persistTabs();
  }

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

  async function saveSessionSnapshot() {
    if (!window.Editor || !window.api?.saveSession) return;
    hasSavedDraft = true;
    if (tabsEnabled) {
      await persistTabs();
      return;
    }
    return window.api.saveSession({
      content: window.Editor.getContent(),
      filePath: currentFilePath,
      fileName: currentFileName,
      mode: window.Editor.getState().mode,
      view: window.Editor.getState().view,
      restore: true
    });
  }

  window.addEventListener('editor:dirty-change', (event) => {
    const dirty = !!event.detail?.dirty;
    updateFilenameDisplay(dirty);
    if (tabsEnabled && !syncingTab && tabs[activeTabIndex]) {
      tabs[activeTabIndex].dirty = dirty;
      tabs[activeTabIndex].fileName = currentFileName;
      renderTabs();
      if (hasSavedDraft) persistTabs();
    } else if (!tabsEnabled && !syncingTab) {
      if (dirty && hasSavedDraft) saveSessionSnapshot();
      else window.api?.clearSession?.();
    }
  });

  setInterval(() => {
    if (hasSavedDraft && (tabsEnabled ? tabs.some((tab) => tab.dirty) : window.Editor?.isDirty?.())) saveSessionSnapshot();
  }, 4000);

  function applySessionRestore(data) {
    if (!window.Editor || !data) return;
    hasSavedDraft = true;
    if (tabsEnabled && Array.isArray(data.tabs) && data.tabs.length) {
      tabs = data.tabs.map(makeTab);
      closedTabs = [];
      activeTabIndex = Math.min(Math.max(Number(data.activeTabIndex) || 0, 0), tabs.length - 1);
      loadTabIntoEditor(tabs[activeTabIndex]);
      renderTabs();
      return;
    }
    window.Editor.setContent(data.content || '');
    currentFilePath = data.filePath || null;
    currentFileName = data.fileName || DEFAULT_FILE_NAME;
    updateDocumentIcon();
    updateFilenameDisplay(true);
    const mode = ['text', 'markdown', 'bbcode'].includes(data.mode) ? data.mode : detectModeFromFileName(currentFileName);
    window.Editor.setMode(mode);
    if (modeSelect) modeSelect.value = mode;
    const view = ['edit', 'live', 'preview'].includes(data.view) ? data.view : 'edit';
    window.Editor.setView(view);
    if (viewSelect) viewSelect.value = view;
    updateViewSelectAvailability();
    if (data.dirty) window.Editor.forceDirty?.();
  }

  window.api?.onSessionRestore?.((data) => {
    pendingSessionRestore = data;
  });

  window.api?.onTabShortcut?.((shortcut) => {
    if (!tabsEnabled) return;
    if (shortcut === 'new') createNewTab();
    else if (shortcut === 'reopen') reopenClosedTab();
    else if (shortcut === 'close') closeTab(activeTabIndex);
    else if (shortcut === 'next') cycleTab(1);
    else if (shortcut === 'prev') cycleTab(-1);
  });

  window.api?.onTabDragState?.((state) => {
    dragState = state;
    updateTabDragVisuals();
  });

  window.api?.onTabDropReorder?.((data) => {
    dragState = null;
    clearTabDragVisuals();
    reorderTab(Number(data?.index), Number(data?.targetIndex));
  });

  window.api?.onTabTransferRemove?.((data) => {
    dragState = null;
    clearTabDragVisuals();
    removeTransferredTab(Number(data?.index));
  });

  window.api?.onTabAcceptTransfer?.((data) => {
    dragState = null;
    clearTabDragVisuals();
    if (!uiInitialized) {
      pendingTabTransfer = data;
      return;
    }
    acceptTransferredTab(data?.tab, data?.screenX, data?.detached === true);
  });

  window.addEventListener('pointermove', (event) => {
    if (!dragPointer || !tabsEnabled) return;
    if (!dragStarted) {
      const distance = Math.hypot(event.screenX - dragPointer.startX, event.screenY - dragPointer.startY);
      if (distance < 6) return;
      dragStarted = true;
      captureActiveTab();
      window.api?.tabDragStart?.({ index: dragPointer.index, tab: makeTab(tabs[dragPointer.index]), tabCount: tabs.length });
    }
    const windowBounds = window.api?.getWindowBounds?.();
    const tabsRect = tabsBar?.getBoundingClientRect?.();
    window.api?.tabDragMove?.({
      screenX: event.screenX,
      screenY: event.screenY,
      tabsTop: windowBounds && tabsRect ? windowBounds.y + tabsRect.top : null,
      tabsBottom: windowBounds && tabsRect ? windowBounds.y + tabsRect.bottom : null,
      tabsLeft: windowBounds && tabsRect ? windowBounds.x + tabsRect.left : null,
      tabsRight: windowBounds && tabsRect ? windowBounds.x + tabsRect.right : null
    });
  });

  window.addEventListener('pointerup', (event) => {
    if (!dragPointer) return;
    const wasDragging = dragStarted;
    const index = dragPointer.index;
    dragPointer = null;
    dragStarted = false;
    if (!wasDragging) return;
    suppressNextTabClick = true;
    const targetIndex = getTabIndexAtClientX(event.clientX);
    const windowBounds = window.api?.getWindowBounds?.();
    const tabsRect = tabsBar?.getBoundingClientRect?.();
    window.api?.tabDragEnd?.({
      screenX: event.screenX,
      screenY: event.screenY,
      targetIndex,
      tabsTop: windowBounds && tabsRect ? windowBounds.y + tabsRect.top : null,
      tabsBottom: windowBounds && tabsRect ? windowBounds.y + tabsRect.bottom : null,
      tabsLeft: windowBounds && tabsRect ? windowBounds.x + tabsRect.left : null,
      tabsRight: windowBounds && tabsRect ? windowBounds.x + tabsRect.right : null
    });
  });

  window.addEventListener('dragover', (event) => {
    event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    if (!window.api?.getPathForFile || !window.api?.openDroppedFiles) return;
    const files = Array.from(event.dataTransfer?.files || []);
    const filePaths = files.map((file) => {
      try { return window.api.getPathForFile(file); } catch (_err) { return null; }
    }).filter(Boolean);
    if (filePaths.length) window.api.openDroppedFiles(filePaths);
  });

  window.api?.onFileOpen?.((result) => {
    if (!uiInitialized) {
      pendingFileOpen = result;
      return;
    }
    const caret = window.Editor?.getCaret?.();
    if (tabsEnabled) {
      loadFileResult(result);
    } else if (!window.Editor.isDirty() || askConfirm('You have unsaved changes. Open another file anyway?')) {
      loadFileResult(result);
    } else {
      window.Editor?.restoreFocus?.(caret);
    }
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

  function applyStatusBar(visible) {
    document.documentElement.dataset.statusbar = visible ? 'shown' : 'hidden';
    if (statusBarInput) statusBarInput.checked = visible;
  }

  function applyWordWrap(enabled) {
    document.documentElement.dataset.wrap = enabled ? 'on' : 'off';
    if (wordWrapInput) wordWrapInput.checked = enabled;
  }

  function applyTextWidth(width) {
    const wide = width === 'wide';
    document.documentElement.dataset.width = wide ? 'wide' : 'standard';
    textWidthStandardBtn?.classList.toggle('active', !wide);
    textWidthWideBtn?.classList.toggle('active', wide);
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
    defaultViewPreference = ['edit', 'live', 'preview'].includes(preferences?.defaultView) ? preferences.defaultView : 'edit';
    tabsEnabled = preferences?.tabsEnabled === true;
    if (tabsEnabledInput) tabsEnabledInput.checked = tabsEnabled;
    applyStatusBar(preferences?.statusBar !== false);
    applyWordWrap(preferences?.wordWrap !== false);
    applyTextWidth(preferences?.textWidth === 'wide' ? 'wide' : 'standard');
    autosaveEnabled = preferences?.autosave === true;
    updateAutosaveToggle();
    updateThemeButtons();
    iconUrls = await window.api?.getIcons?.() || {};
    updateDocumentIcon();
    if (window.Editor?.init) {
      window.Editor.init();
    }
    const restored = pendingSessionRestore;
    pendingSessionRestore = null;
    if (restored) applySessionRestore(restored);
    const fileToOpen = pendingFileOpen;
    pendingFileOpen = null;
    if (fileToOpen) loadFileResult(fileToOpen);
    if (tabsEnabled && tabs.length === 0) tabs.push(makeTab());
    renderTabs();
    const defaultView = defaultViewPreference;
    if (!restored) window.Editor?.setView?.(defaultView);
    if (defaultViewSelect) defaultViewSelect.value = defaultView;
    updateViewSelectAvailability();
    uiInitialized = true;
    const transfer = pendingTabTransfer;
    pendingTabTransfer = null;
    if (transfer) acceptTransferredTab(transfer?.tab, transfer?.screenX, transfer?.detached === true);
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
  tabsEnabledInput?.addEventListener('change', async () => {
    const enabled = tabsEnabledInput.checked;
    if (enabled) {
      if (!tabs.length) {
        tabs = [makeTab({
          content: window.Editor?.getContent?.() || '',
          filePath: currentFilePath,
          fileName: currentFileName,
          mode: window.Editor?.getState?.().mode || 'text',
          view: window.Editor?.getState?.().view || 'edit',
          dirty: window.Editor?.isDirty?.() || false
        })];
        activeTabIndex = 0;
      } else {
        captureActiveTab();
      }
      tabsEnabled = true;
      renderTabs();
      persistTabs();
    } else {
      captureActiveTab();
      tabsEnabled = false;
      renderTabs();
      if (tabs.length) loadTabIntoEditor(tabs[activeTabIndex]);
      if (tabs.some((tab) => tab.dirty)) persistTabs();
      else window.api?.clearSession?.();
    }
    await window.api?.setTabsEnabledPreference?.(enabled);
  });
  newTabBtn?.addEventListener('click', () => createNewTab());
  statusBarInput?.addEventListener('change', () => {
    applyStatusBar(statusBarInput.checked);
    window.api?.setStatusBarPreference?.(statusBarInput.checked);
  });
  wordWrapInput?.addEventListener('change', () => {
    applyWordWrap(wordWrapInput.checked);
    window.api?.setWordWrapPreference?.(wordWrapInput.checked);
  });
  textWidthStandardBtn?.addEventListener('click', () => {
    applyTextWidth('standard');
    window.api?.setTextWidthPreference?.('standard');
  });
  textWidthWideBtn?.addEventListener('click', () => {
    applyTextWidth('wide');
    window.api?.setTextWidthPreference?.('wide');
  });


  restoreDefaultsBtn?.addEventListener('click', async () => {
    const preferences = await window.api?.resetPreferences?.();
    if (!preferences) return;
    document.documentElement.dataset.theme = preferences.theme;
    updateThemeButtons();
    applyFontSelectValue(fontUiSelect, preferences.fontUI);
    applyFontSelectValue(fontTextSelect, preferences.fontText);
    applyFontSelectValue(fontHeadingSelect, preferences.fontHeading);
    applyFontSelectValue(fontCodeSelect, preferences.fontCode);
    document.documentElement.style.setProperty('--font-ui', preferences.fontUI);
    document.documentElement.style.setProperty('--font-text', preferences.fontText);
    document.documentElement.style.setProperty('--font-heading', preferences.fontHeading);
    document.documentElement.style.setProperty('--font-code', preferences.fontCode);
    applyFontSizeInputValue(fontUiSizeInput, preferences.fontSizeUi, DEFAULT_FONT_SIZES.fontSizeUi);
    applyFontSizeInputValue(fontTextSizeInput, preferences.fontSizeText, DEFAULT_FONT_SIZES.fontSizeText);
    applyFontSizeInputValue(fontHeadingSizeInput, preferences.fontSizeHeading, DEFAULT_FONT_SIZES.fontSizeHeading);
    applyFontSizeInputValue(fontCodeSizeInput, preferences.fontSizeCode, DEFAULT_FONT_SIZES.fontSizeCode);
    document.documentElement.style.setProperty('--font-size-ui', preferences.fontSizeUi + 'px');
    document.documentElement.style.setProperty('--font-size-text', preferences.fontSizeText + 'px');
    document.documentElement.style.setProperty('--font-size-heading', preferences.fontSizeHeading + 'px');
    document.documentElement.style.setProperty('--font-size-code', preferences.fontSizeCode + 'px');
    if (defaultViewSelect) defaultViewSelect.value = preferences.defaultView;
    tabsEnabled = preferences.tabsEnabled === true;
    if (tabsEnabledInput) tabsEnabledInput.checked = tabsEnabled;
    applyStatusBar(preferences.statusBar !== false);
    applyWordWrap(preferences.wordWrap !== false);
    applyTextWidth(preferences.textWidth === 'wide' ? 'wide' : 'standard');
    if (tabsEnabled && !tabs.length) tabs.push(makeTab());
    renderTabs();
    window.Editor?.setView?.(preferences.defaultView);
    updateViewSelectAvailability();
  });

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
    if (tabsEnabled) {
      createNewTab({
        content: result.content,
        filePath: result.filePath,
        fileName: result.fileName || DEFAULT_FILE_NAME,
        mode: detectModeFromFileName(result.fileName || ''),
        view: defaultViewPreference,
        dirty: false
      });
      return;
    }
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
      if (tabsEnabled && tabs[activeTabIndex]) {
        tabs[activeTabIndex].filePath = currentFilePath;
        tabs[activeTabIndex].fileName = currentFileName;
        tabs[activeTabIndex].dirty = false;
        renderTabs();
        persistTabs();
      }
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
      if (tabsEnabled && tabs[activeTabIndex]) {
        tabs[activeTabIndex].filePath = currentFilePath;
        tabs[activeTabIndex].fileName = currentFileName;
        tabs[activeTabIndex].dirty = false;
        renderTabs();
        persistTabs();
      }
      updateFilenameDisplay(false);
    }
  }

  async function doSaveAll() {
    if (!window.api || !window.Editor) return;
    if (!tabsEnabled) {
      await doSave();
      return;
    }
    captureActiveTab();
    const originalTab = tabs[activeTabIndex];
    for (const tab of tabs.slice()) {
      if (!tab.dirty || !tabs.includes(tab)) continue;
      if (tab === tabs[activeTabIndex]) {
        await doSave();
      } else if (tab.filePath) {
        const result = await window.api.saveFile({ filePath: tab.filePath, fileName: tab.fileName, content: tab.content });
        if (result) {
          tab.filePath = result.filePath;
          tab.fileName = result.fileName || tab.fileName;
          tab.dirty = false;
        }
      } else {
        switchTab(tabs.indexOf(tab));
        await doSave();
      }
    }
    const originalIndex = tabs.indexOf(originalTab);
    if (originalIndex !== -1 && originalIndex !== activeTabIndex) switchTab(originalIndex);
    renderTabs();
    persistTabs();
  }

  saveBtn?.addEventListener('click', doSave);
  saveAsBtn?.addEventListener('click', doSaveAs);
  saveAllBtn?.addEventListener('click', doSaveAll);

  function updateAutosaveToggle() {
    autosaveBtn?.setAttribute('aria-checked', autosaveEnabled ? 'true' : 'false');
  }

  function scheduleAutosave(delay = AUTOSAVE_DELAY_MS) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    if (autosaveEnabled) autosaveTimer = setTimeout(runAutosave, delay);
  }

  async function performAutosave() {
    if (!autosaveEnabled || !window.api?.autosaveFile || !window.Editor) return;
    const targets = [];
    if (tabsEnabled) {
      captureActiveTab();
      tabs.forEach((tab) => targets.push({ tab, filePath: tab.filePath, dirty: tab.dirty, content: tab.content }));
    } else {
      targets.push({
        tab: null,
        filePath: currentFilePath,
        dirty: window.Editor.isDirty(),
        content: window.Editor.getContent()
      });
    }
    for (const target of targets) {
      if (!target.dirty || !target.filePath) continue;
      const saved = await window.api.autosaveFile({ filePath: target.filePath, content: target.content });
      if (!saved) continue;
      const isActive = !target.tab || target.tab === tabs[activeTabIndex];
      if (isActive) {
        if (window.Editor.getContent() !== target.content) continue;
        window.Editor.markSaved();
      } else if (target.tab.content !== target.content) {
        continue;
      }
      if (target.tab) {
        target.tab.dirty = false;
        renderTabs();
        persistTabs();
      }
      updateFilenameDisplay(false);
    }
  }

  function runAutosave() {
    autosaveTimer = null;
    if (!autosavePromise) {
      autosavePromise = performAutosave().catch(() => {}).finally(() => { autosavePromise = null; });
    }
    return autosavePromise;
  }

  window.addEventListener('editor:edited', () => scheduleAutosave());

  window.api?.onAutosaveChanged?.((enabled) => {
    autosaveEnabled = enabled === true;
    updateAutosaveToggle();
    if (autosaveEnabled) scheduleAutosave(0);
  });

  autosaveBtn?.addEventListener('click', async () => {
    autosaveEnabled = !autosaveEnabled;
    updateAutosaveToggle();
    await window.api?.setAutosavePreference?.(autosaveEnabled);
    if (autosaveEnabled) scheduleAutosave(0);
  });

  const menus = [
    { button: fileMenuBtn, panel: fileMenu },
    { button: editMenuBtn, panel: editMenu }
  ].filter((menu) => menu.button && menu.panel);

  function closeMenus() {
    menus.forEach(({ button, panel }) => {
      panel.classList.add('hidden');
      panel.style.left = '';
      button.setAttribute('aria-expanded', 'false');
    });
  }

  function refreshEditMenuState() {
    const state = window.Editor?.getState?.();
    const readOnly = !state || state.view === 'preview';
    editMenu.querySelectorAll('[data-edit]').forEach((item) => {
      const action = item.dataset.edit;
      if (['undo', 'redo', 'cut', 'paste'].includes(action)) item.disabled = readOnly;
      else if (action === 'clear') item.disabled = readOnly || state.mode === 'text';
    });
  }

  function toggleMenu(menu) {
    const wasHidden = menu.panel.classList.contains('hidden');
    closeMenus();
    if (!wasHidden) return;
    settingsPanel?.classList.add('hidden');
    if (menu.panel === editMenu) refreshEditMenuState();
    menu.panel.classList.remove('hidden');
    menu.button.setAttribute('aria-expanded', 'true');
    const overflow = menu.panel.getBoundingClientRect().right - (window.innerWidth - 8);
    if (overflow > 0) menu.panel.style.left = `${-overflow}px`;
  }

  menus.forEach((menu) => {
    menu.button.addEventListener('mousedown', (event) => event.preventDefault());
    menu.button.addEventListener('click', () => toggleMenu(menu));
    menu.panel.addEventListener('mousedown', (event) => {
      if (event.target.closest('.menu-item')) event.preventDefault();
    });
    menu.panel.addEventListener('click', (event) => {
      const item = event.target.closest('.menu-item');
      if (!item || item.disabled || item.dataset.keepOpen === 'true') return;
      closeMenus();
    });
  });

  document.addEventListener('click', (event) => {
    const path = event.composedPath();
    if (!menus.some(({ button, panel }) => path.includes(button) || path.includes(panel))) closeMenus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menus.some(({ panel }) => !panel.classList.contains('hidden'))) closeMenus();
  });
  settingsBtn?.addEventListener('click', closeMenus);

  const editActions = {
    undo: () => window.Editor?.undo?.(),
    redo: () => window.Editor?.redo?.(),
    clear: () => window.Editor?.clearFormatting?.(),
    cut: () => window.api?.editCommand?.('cut'),
    copy: () => window.api?.editCommand?.('copy'),
    paste: () => window.api?.editCommand?.('paste'),
    find: () => window.Find?.open(false),
    replace: () => window.Find?.open(true)
  };

  editMenu?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-edit]');
    if (!item || item.disabled) return;
    editActions[item.dataset.edit]?.();
  });

  function normalizeLinkUrl(rawHref) {
    const href = String(rawHref || '').trim();
    if (!href) return null;
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : (/^www\.\S+$/i.test(href) ? `https://${href}` : null);
    if (!candidate) return null;
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return null;
      return parsed;
    } catch (_err) {
      return null;
    }
  }

  let hoveredLink = null;

  function hideLinkTooltip() {
    hoveredLink = null;
    linkTooltip?.classList.add('hidden');
  }

  function positionLinkTooltip(event) {
    if (!linkTooltip) return;
    const gap = 16;
    const width = linkTooltip.offsetWidth;
    const height = linkTooltip.offsetHeight;
    let left = event.clientX + gap;
    let top = event.clientY + gap + 4;
    if (left + width > window.innerWidth - 6) left = Math.max(6, event.clientX - width - gap);
    if (top + height > window.innerHeight - 6) top = Math.max(6, event.clientY - height - gap);
    linkTooltip.style.left = `${left}px`;
    linkTooltip.style.top = `${top}px`;
  }

  editorEl?.addEventListener('mouseover', (event) => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor) {
      if (hoveredLink) hideLinkTooltip();
      return;
    }
    if (anchor === hoveredLink) return;
    const parsed = normalizeLinkUrl(anchor.getAttribute('href'));
    if (!parsed) {
      hideLinkTooltip();
      return;
    }
    hoveredLink = anchor;
    if (parsed.protocol === 'mailto:') {
      linkTooltipSite.textContent = 'Email';
      linkTooltipUrl.textContent = parsed.href;
    } else {
      linkTooltipSite.textContent = parsed.hostname.replace(/^www\./i, '');
      linkTooltipUrl.textContent = parsed.href;
    }
    linkTooltip.classList.remove('hidden');
    positionLinkTooltip(event);
  });
  editorEl?.addEventListener('mousemove', (event) => {
    if (hoveredLink) positionLinkTooltip(event);
  });
  editorEl?.addEventListener('mouseout', (event) => {
    if (!hoveredLink) return;
    const next = event.relatedTarget;
    if (next && hoveredLink.contains(next)) return;
    hideLinkTooltip();
  });
  window.addEventListener('blur', hideLinkTooltip);
  document.addEventListener('keydown', (event) => {
    if (!['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) hideLinkTooltip();
  }, true);
  document.getElementById('editorWrap')?.addEventListener('scroll', hideLinkTooltip);

  function openLinkExternally(event) {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    event.preventDefault();
    if (event.type === 'auxclick' && event.button !== 1) return;
    const inPreview = window.Editor?.getState?.().view === 'preview';
    if (event.type === 'click' && !inPreview && !(event.ctrlKey || event.metaKey)) return;
    const parsed = normalizeLinkUrl(anchor.getAttribute('href'));
    if (parsed) window.api?.openExternal?.(parsed.href);
  }
  editorEl?.addEventListener('click', openLinkExternally);
  editorEl?.addEventListener('auxclick', openLinkExternally);

  window.addEventListener('keydown', (event) => {
    const isMod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (isMod && !event.altKey && !event.shiftKey && key === 't') {
      event.preventDefault();
      if (tabsEnabled) createNewTab();
      return;
    }
    if (isMod && event.shiftKey && key === 't') {
      event.preventDefault();
      if (tabsEnabled) reopenClosedTab();
      return;
    }
    if (isMod && !event.shiftKey && !event.altKey && key === 'w') {
      if (tabsEnabled) {
        event.preventDefault();
        closeTab(activeTabIndex);
      }
      return;
    }
    if (isMod && key === 's') {
      event.preventDefault();
      if (event.shiftKey) {
        doSaveAs();
      } else {
        doSave();
      }
    }
  });


  window.api?.onWindowCloseRequest?.(async () => {
    const caret = window.Editor?.getCaret?.();
    if (autosaveEnabled) {
      clearTimeout(autosaveTimer);
      await runAutosave();
    }
    if (tabsEnabled) {
      captureActiveTab();
      const dirty = tabs.some((tab) => tab.dirty);
      if (!dirty) {
        if (hasSavedDraft) persistTabs();
        window.api.respondToWindowClose(true);
        return;
      }
      const choice = await askCloseConfirm('One or more tabs have unsaved changes. Save a draft, discard them, or cancel?');
      if (choice === 'save') {
        await saveSessionSnapshot();
        window.api.respondToWindowClose(true, true);
      } else if (choice === 'discard') {
        window.api.respondToWindowClose(true, false);
      } else {
        window.Editor?.restoreFocus?.(caret);
        window.api.respondToWindowClose(false);
      }
      return;
    }
    if (!window.Editor?.isDirty?.()) {
      window.api.respondToWindowClose(true);
      return;
    }
    const choice = await askCloseConfirm('You have unsaved changes. Save a draft, discard them, or cancel?');
    if (choice === 'save') {
      await saveSessionSnapshot();
      window.api.respondToWindowClose(true, true);
    } else if (choice === 'discard') {
      window.api.respondToWindowClose(true, false);
    } else {
      window.Editor?.restoreFocus?.(caret);
      window.api.respondToWindowClose(false);
    }
  });
})();
