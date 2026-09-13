(function () {
  const spellBtn = document.getElementById('spellBtn');
  const spellPanel = document.getElementById('spellPanel');
  const spellToggle = document.getElementById('spellToggle');
  const langList = document.getElementById('langList');
  const langSearch = document.getElementById('langSearch');
  const contextMenu = document.getElementById('spellContextMenu');
  let enabledLangs = [];
  let lastEnabledLangs = [];
  const installed = new Set();
  const downloading = new Set();
  const downloadTimeouts = new Map();
  let wordRange = null;
  let customWords = [];

  const DOWNLOAD_TIMEOUT_MS = 20000;

  function clearDownloadTimeout(lang) {
    const timeoutId = downloadTimeouts.get(lang);
    if (timeoutId) {
      clearTimeout(timeoutId);
      downloadTimeouts.delete(lang);
    }
  }

  function armDownloadTimeout(lang, available) {
    clearDownloadTimeout(lang);
    const timeoutId = setTimeout(() => {
      downloadTimeouts.delete(lang);
      if (!downloading.has(lang)) return;
      downloading.delete(lang);
      console.warn(`Spellcheck dictionary download for "${lang}" timed out with no response - allowing retry.`);
      renderList(available);
    }, DOWNLOAD_TIMEOUT_MS);
    downloadTimeouts.set(lang, timeoutId);
  }

  spellBtn.addEventListener('click', () => spellPanel.classList.toggle('hidden'));
  document.addEventListener('click', (event) => {
    const path = event.composedPath();
    if (!path.includes(spellPanel) && !path.includes(spellBtn)) spellPanel.classList.add('hidden');
    if (!path.includes(contextMenu)) contextMenu.classList.add('hidden');
  });

  langSearch?.addEventListener('input', () => {
    renderList(JSON.parse(langList.dataset.available || '[]'));
  });
  langSearch?.addEventListener('click', (event) => event.stopPropagation());

  async function setEnabled(next) {
    enabledLangs = await window.api.setSpellcheckLanguages(next);
    if (enabledLangs.length) lastEnabledLangs = enabledLangs.slice();
    renderList(JSON.parse(langList.dataset.available || '[]'));
  }

  spellToggle.addEventListener('change', async () => {
    document.getElementById('editor').spellcheck = spellToggle.checked;
    spellBtn.innerHTML = `Spellcheck: ${spellToggle.checked ? 'On' : 'Off'} &#9662;`;
    if (spellToggle.checked) {
      await setEnabled(lastEnabledLangs.length ? lastEnabledLangs : ['en-US']);
    } else {
      lastEnabledLangs = enabledLangs.slice();
      await setEnabled([]);
    }
  });

  function displayName(lang) {
    try {
      const dn = new Intl.DisplayNames(['en'], { type: 'language' });
      const base = lang.split(/[-_]/)[0];
      const name = dn.of(base);
      return name && name.toLowerCase() !== base.toLowerCase() ? name : null;
    } catch (_err) {
      return null;
    }
  }

  async function addCustomWord(word) {
    if (!word || !window.api?.addCustomDictionaryWord) return;
    customWords = await window.api.addCustomDictionaryWord(word);
    renderList(JSON.parse(langList.dataset.available || '[]'));
  }

  function renderCustomDictionary() {
    const section = document.createElement('section');
    section.className = 'custom-dictionary';
    const title = document.createElement('div');
    title.className = 'custom-dictionary-title';
    title.textContent = 'Custom dictionary';
    const form = document.createElement('form');
    form.className = 'custom-dictionary-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add a word';
    input.maxLength = 100;
    input.spellcheck = false;
    const add = document.createElement('button');
    add.type = 'submit';
    add.textContent = 'Add';
    form.append(input, add);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await addCustomWord(input.value.trim());
    });
    section.append(title, form);
    if (!customWords.length) {
      const empty = document.createElement('div');
      empty.className = 'spell-note';
      empty.textContent = 'Words added here are treated as correctly spelled.';
      section.appendChild(empty);
    } else {
      const words = document.createElement('div');
      words.className = 'custom-word-list';
      customWords.forEach((word) => {
        const row = document.createElement('div');
        row.className = 'custom-word-row';
        const label = document.createElement('span');
        label.textContent = word;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'dictionary-remove';
        remove.title = `Remove ${word}`;
        remove.innerHTML = '&#128465;';
        remove.addEventListener('click', async () => {
          customWords = await window.api.removeCustomDictionaryWord(word);
          renderList(JSON.parse(langList.dataset.available || '[]'));
        });
        row.append(label, remove);
        words.appendChild(row);
      });
      section.appendChild(words);
    }
    return section;
  }

  function renderList(available) {
    langList.dataset.available = JSON.stringify(available);
    langList.innerHTML = '';
    langList.appendChild(renderCustomDictionary());
    const note = document.createElement('div');
    note.className = 'spell-note';
    note.textContent = 'Enable installed dictionaries individually. The English dictionary is retained as the default.';
    langList.appendChild(note);

    const query = (langSearch?.value || '').trim().toLowerCase();
    const visible = query
      ? available.filter((lang) => lang.toLowerCase().includes(query) || (displayName(lang) || '').toLowerCase().includes(query))
      : available;

    if (query && !visible.length) {
      const empty = document.createElement('div');
      empty.className = 'spell-note';
      empty.textContent = `No dictionaries match "${langSearch.value.trim()}".`;
      langList.appendChild(empty);
    }

    visible.forEach((lang) => {
      const row = document.createElement('div');
      row.className = 'lang-row';
      row.dataset.lang = lang;
      const label = document.createElement('span');
      const name = displayName(lang);
      label.textContent = name ? `${name} (${lang})` : lang;
      row.appendChild(label);

      if (!installed.has(lang)) {
        const download = document.createElement('button');
        download.textContent = downloading.has(lang) ? 'Downloading…' : 'Download';
        download.disabled = downloading.has(lang);
        download.addEventListener('click', async () => {
          downloading.add(lang);
          armDownloadTimeout(lang, available);
          renderList(available);
          await setEnabled(Array.from(new Set([...enabledLangs, lang])));
        });
        row.appendChild(download);
      } else {
        const controls = document.createElement('div');
        controls.className = 'dictionary-controls';
        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabled.checked = enabledLangs.includes(lang);
        enabled.title = `Enable ${lang}`;
        enabled.addEventListener('change', async () => {
          await setEnabled(enabled.checked ? [...enabledLangs, lang] : enabledLangs.filter((item) => item !== lang));
        });
        const remove = document.createElement('button');
        remove.className = 'dictionary-remove';
        remove.innerHTML = '&#128465;';
        remove.title = `Remove ${lang}`;
        const isEnglish = /^en(?:-|$)/i.test(lang);
        remove.disabled = isEnglish;
        if (isEnglish) controls.classList.add('dictionary-required');
        remove.addEventListener('click', async () => {
          if (isEnglish) return;
          installed.delete(lang);
          await setEnabled(enabledLangs.filter((item) => item !== lang));
        });
        controls.append(enabled, remove);
        row.appendChild(controls);
      }
      langList.appendChild(row);
    });
  }

  function rememberWordRange(event) {
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return;
    const text = range.startContainer.textContent;
    let start = range.startOffset;
    let end = start;
    while (start > 0 && /[\p{L}'-]/u.test(text[start - 1])) start -= 1;
    while (end < text.length && /[\p{L}'-]/u.test(text[end])) end += 1;
    if (start === end) return;
    range.setStart(range.startContainer, start);
    range.setEnd(range.startContainer, end);
    wordRange = range;
  }

  function showContextMenu({ x, y, word, suggestions }) {
    contextMenu.innerHTML = '';
    const choices = suggestions.length ? suggestions : [`No suggestions for “${word}”`];
    choices.forEach((suggestion) => {
      const button = document.createElement('button');
      button.textContent = suggestion;
      button.disabled = !suggestions.length;
      button.addEventListener('click', () => {
        if (wordRange) {
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(wordRange);
          document.execCommand('insertText', false, suggestion);
        }
        contextMenu.classList.add('hidden');
      });
      contextMenu.appendChild(button);
    });
    const addToDictionary = document.createElement('button');
    addToDictionary.textContent = `Add “${word}” to custom dictionary`;
    addToDictionary.addEventListener('click', async () => {
      await addCustomWord(word);
      contextMenu.classList.add('hidden');
    });
    contextMenu.appendChild(addToDictionary);
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove('hidden');
  }

  async function init() {
    document.getElementById('editor').addEventListener('contextmenu', rememberWordRange);
    if (!window.api?.getSpellcheckAvailable) return;
    const [available, enabled] = await Promise.all([window.api.getSpellcheckAvailable(), window.api.getSpellcheckEnabled()]);
    customWords = await window.api.getCustomDictionary?.() || [];
    enabledLangs = enabled || [];
    if (enabledLangs.length) lastEnabledLangs = enabledLangs.slice();
    enabledLangs.forEach((lang) => installed.add(lang));
    const spellcheckOn = enabledLangs.length > 0;
    spellToggle.checked = spellcheckOn;
    const editorEl = document.getElementById('editor');
    if (editorEl) editorEl.spellcheck = spellcheckOn;
    spellBtn.innerHTML = `Spellcheck: ${spellcheckOn ? 'On' : 'Off'} &#9662;`;
    renderList(available || []);
    window.api.onSpellcheckDownloadStatus?.(({ lang, status }) => {
      if (status === 'success') {
        clearDownloadTimeout(lang);
        downloading.delete(lang);
        installed.add(lang);
      }
      if (status === 'failure') {
        clearDownloadTimeout(lang);
        downloading.delete(lang);
      }
      if (status === 'begin') {
        downloading.add(lang);
        armDownloadTimeout(lang, available || []);
      }
      renderList(available || []);
    });
    window.api.onSpellcheckContextMenu?.(showContextMenu);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
