(function () {
  const menu = document.getElementById('synonymsContextMenu');
  const editorEl = document.getElementById('editor');
  if (!menu || !editorEl) return;

  let savedRange = null;
  let requestToken = 0;

  editorEl.addEventListener('contextmenu', () => {
    const sel = window.getSelection();
    savedRange = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
  });

  document.addEventListener('click', (event) => {
    if (!event.composedPath().includes(menu)) {
      menu.classList.add('hidden');
      requestToken += 1;
    }
  });

  const SYNONYM_SOURCES = {
    en: async (word) => {
      const res = await fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}&max=10`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data.map((entry) => entry.word).filter(Boolean) : [];
    }
  };

  async function fetchSynonyms(word) {
    let activeLangs = [];
    try {
      activeLangs = (await window.api?.getSpellcheckEnabled?.()) || [];
    } catch (_err) {
      activeLangs = [];
    }
    if (!activeLangs.length) activeLangs = ['en-US'];

    const prefixes = Array.from(new Set(activeLangs.map((lang) => lang.split(/[-_]/)[0].toLowerCase())));
    const best = new Map();

    await Promise.all(prefixes.map(async (prefix) => {
      const source = SYNONYM_SOURCES[prefix];
      if (!source) return;
      try {
        const words = await source(word);
        words.forEach((candidate, rank) => {
          const lower = candidate.toLowerCase();
          if (lower === word.toLowerCase()) return;
          const existing = best.get(lower);
          if (!existing || existing.rank > rank) best.set(lower, { word: candidate, rank });
        });
      } catch (_err) {}
    }));

    return Array.from(best.values()).sort((a, b) => a.rank - b.rank).map((entry) => entry.word).slice(0, 10);
  }

  function replaceSelectionWith(synonym) {
    if (!savedRange) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
    document.execCommand('insertText', false, matchCapitalization(savedRange.toString(), synonym));
  }

  function matchCapitalization(original, replacement) {
    if (!original || !replacement) return replacement;
    if (original === original.toLocaleUpperCase()) return replacement.toLocaleUpperCase();
    if (original === original.toLocaleLowerCase()) return replacement.toLocaleLowerCase();
    const first = original.charAt(0);
    const rest = original.slice(1);
    if (first === first.toLocaleUpperCase() && rest === rest.toLocaleLowerCase()) {
      return replacement.charAt(0).toLocaleUpperCase() + replacement.slice(1).toLocaleLowerCase();
    }
    return replacement;
  }

  function renderMenu(x, y, bodyEl) {
    menu.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'context-menu-heading';
    heading.textContent = 'Synonyms';
    menu.appendChild(heading);
    menu.appendChild(bodyEl);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.remove('hidden');
  }

  function placeholderButton(text) {
    const button = document.createElement('div');
    button.className = 'context-menu-heading';
    button.textContent = text;
    return button;
  }

  function synonymList(word, synonyms) {
    const wrap = document.createDocumentFragment();
    if (!synonyms.length) {
      const empty = document.createElement('button');
      empty.disabled = true;
      empty.textContent = `No synonyms found for “${word}”`;
      wrap.appendChild(empty);
      return wrap;
    }
    synonyms.forEach((syn) => {
      const button = document.createElement('button');
      button.textContent = syn;
      button.addEventListener('click', () => {
        replaceSelectionWith(syn);
        menu.classList.add('hidden');
      });
      wrap.appendChild(button);
    });
    return wrap;
  }

  async function handleContextMenu({ x, y, word }) {
    const token = ++requestToken;
    renderMenu(x, y, placeholderButton('Looking up synonyms…'));

    const synonyms = await fetchSynonyms(word);
    if (token !== requestToken) return;
    renderMenu(x, y, synonymList(word, synonyms));
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.api?.onSynonymsContextMenu?.(handleContextMenu);
  });
})();
