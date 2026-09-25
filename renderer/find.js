(function () {
  const bar = document.getElementById('findBar');
  const findInput = document.getElementById('findInput');
  const replaceInput = document.getElementById('replaceInput');
  const replaceRow = document.getElementById('replaceRow');
  const findCount = document.getElementById('findCount');
  const prevBtn = document.getElementById('findPrevBtn');
  const nextBtn = document.getElementById('findNextBtn');
  const caseBtn = document.getElementById('findCaseBtn');
  const wrapBtn = document.getElementById('findWrapBtn');
  const closeBtn = document.getElementById('findCloseBtn');
  const replaceBtn = document.getElementById('replaceBtn');
  const replaceAllBtn = document.getElementById('replaceAllBtn');
  const editorEl = document.getElementById('editor');
  const editorWrap = document.getElementById('editorWrap');
  if (!bar || !findInput || !editorEl) return;

  const HIGHLIGHTS = !!(window.CSS && CSS.highlights && window.Highlight);
  const MAX_PREFILL = 200;

  let isOpen = false;
  let matchCase = false;
  let wrapAround = true;
  let matches = [];
  let current = -1;
  let cursor = { line: 0, offset: 0 };
  let savedCaret = { line: 0, offset: 0 };
  let notice = '';
  let refreshQueued = false;

  const observer = new MutationObserver(() => {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refresh(false);
    });
  });

  function isPreview() {
    return window.Editor?.getState?.().view === 'preview';
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildPattern(query) {
    return new RegExp(escapeRegExp(query), matchCase ? 'g' : 'gi');
  }

  function collectSourceMatches(query) {
    const pattern = buildPattern(query);
    const found = [];
    window.Editor.getLines().forEach((text, line) => {
      pattern.lastIndex = 0;
      let hit = pattern.exec(text);
      while (hit) {
        const start = hit.index;
        const end = start + hit[0].length;
        const range = window.Editor.rangeInLine(line, start, end);
        if (range) found.push({ line, start, end, range });
        hit = pattern.exec(text);
      }
    });
    return found;
  }

  function collectPreviewMatches(query) {
    const pattern = buildPattern(query);
    const found = [];
    Array.from(editorEl.children).forEach((lineEl, line) => {
      if (lineEl.hidden) return;
      const parts = [];
      let text = '';
      const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (node.parentElement && node.parentElement.closest('svg, .katex-mathml')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT)
      });
      let node = walker.nextNode();
      while (node) {
        parts.push({ node, start: text.length, length: node.nodeValue.length });
        text += node.nodeValue.replace(/\u00a0/g, ' ');
        node = walker.nextNode();
      }
      if (!parts.length) return;
      pattern.lastIndex = 0;
      let hit = pattern.exec(text);
      while (hit) {
        const start = hit.index;
        const end = start + hit[0].length;
        const from = parts.find((part) => start >= part.start && start < part.start + part.length);
        const to = parts.find((part) => end > part.start && end <= part.start + part.length);
        if (from && to) {
          const range = document.createRange();
          range.setStart(from.node, start - from.start);
          range.setEnd(to.node, end - to.start);
          found.push({ line, start, end, range });
        }
        hit = pattern.exec(text);
      }
    });
    return found;
  }

  function collectMatches(query) {
    return isPreview() ? collectPreviewMatches(query) : collectSourceMatches(query);
  }

  function firstIndexAtOrAfter(position) {
    return matches.findIndex((match) => match.line > position.line
      || (match.line === position.line && match.start >= position.offset));
  }

  function lastIndexBefore(position) {
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const match = matches[i];
      if (match.line < position.line || (match.line === position.line && match.start < position.offset)) return i;
    }
    return -1;
  }

  function clearHighlights() {
    if (!HIGHLIGHTS) return;
    CSS.highlights.delete('find-match');
    CSS.highlights.delete('find-current');
  }

  function paint() {
    if (!HIGHLIGHTS) return;
    const others = [];
    let active = null;
    matches.forEach((match, index) => {
      if (index === current) active = match.range;
      else others.push(match.range);
    });
    if (others.length) CSS.highlights.set('find-match', new Highlight(...others));
    else CSS.highlights.delete('find-match');
    if (active) {
      const highlight = new Highlight(active);
      highlight.priority = 1;
      CSS.highlights.set('find-current', highlight);
    } else {
      CSS.highlights.delete('find-current');
    }
  }

  function revealCurrent() {
    const match = matches[current];
    if (!match || !editorWrap) return;
    const rect = match.range.getBoundingClientRect();
    const view = editorWrap.getBoundingClientRect();
    if (rect.top < view.top + 24 || rect.bottom > view.bottom - 24) {
      editorWrap.scrollTop += rect.top - (view.top + view.height / 2);
    }
  }

  function updateStatus() {
    const readOnly = isPreview();
    let label = '';
    if (notice) label = notice;
    else if (findInput.value) {
      if (!matches.length) label = 'No results';
      else if (current === -1) label = `${matches.length} found`;
      else label = `${current + 1} of ${matches.length}`;
    }
    findCount.textContent = label;
    prevBtn.disabled = !matches.length;
    nextBtn.disabled = !matches.length;
    replaceInput.disabled = readOnly;
    replaceBtn.disabled = readOnly || current === -1;
    replaceAllBtn.disabled = readOnly || !matches.length;
  }

  function refresh(fromUser) {
    if (!isOpen) return;
    if (fromUser) notice = '';
    const query = findInput.value;
    matches = query ? collectMatches(query) : [];
    if (!matches.length) {
      current = -1;
    } else {
      current = firstIndexAtOrAfter(cursor);
      if (current === -1 && wrapAround) current = 0;
    }
    paint();
    updateStatus();
  }

  function step(direction) {
    if (!matches.length) return;
    let next;
    if (current === -1) {
      next = direction > 0 ? firstIndexAtOrAfter(cursor) : lastIndexBefore(cursor);
    } else {
      next = current + direction;
      if (next >= matches.length || next < 0) next = -1;
    }
    if (next === -1) {
      if (!wrapAround) return;
      next = direction > 0 ? 0 : matches.length - 1;
    }
    current = next;
    notice = '';
    cursor = { line: matches[next].line, offset: matches[next].start };
    paint();
    updateStatus();
    revealCurrent();
  }

  function replaceCurrent() {
    if (isPreview() || current === -1) return;
    const match = matches[current];
    const text = replaceInput.value;
    window.Editor.replaceRanges([match], text);
    cursor = { line: match.line, offset: match.start + text.length };
    notice = '';
    refresh(false);
    revealCurrent();
  }

  function replaceAll() {
    if (isPreview() || !matches.length) return;
    const count = matches.length;
    window.Editor.replaceRanges(matches, replaceInput.value);
    notice = count === 1 ? 'Replaced 1' : `Replaced ${count}`;
    refresh(false);
  }

  function selectionInEditor() {
    const sel = window.getSelection();
    return !!(sel && sel.rangeCount && editorEl.contains(sel.anchorNode));
  }

  function selectedSingleLineText() {
    if (!selectionInEditor()) return '';
    const sel = window.getSelection();
    if (sel.isCollapsed) return '';
    const text = sel.toString();
    if (!text || text.length > MAX_PREFILL || /[\r\n]/.test(text)) return '';
    return text;
  }

  function setToggle(button, value) {
    button.setAttribute('aria-pressed', value ? 'true' : 'false');
  }

  function open(withReplace) {
    const wasOpen = isOpen;
    isOpen = true;
    bar.classList.remove('hidden');
    if (withReplace) replaceRow.classList.remove('hidden');
    else if (!wasOpen) replaceRow.classList.add('hidden');

    const selected = selectedSingleLineText();
    if (selected) findInput.value = selected;
    if (!wasOpen || selected) {
      const caret = selectionInEditor() ? window.Editor.getCaret() : { line: 0, offset: 0 };
      cursor = { line: caret.line, offset: caret.offset };
      if (!wasOpen) savedCaret = { line: caret.line, offset: caret.offset };
    }
    if (!wasOpen) observer.observe(editorEl, { childList: true, subtree: true, characterData: true });

    notice = '';
    refresh(false);
    revealCurrent();
    if (withReplace && findInput.value && !replaceInput.disabled) {
      replaceInput.focus();
      replaceInput.select();
    } else {
      findInput.focus();
      findInput.select();
    }
  }

  function close() {
    if (!isOpen) return;
    const match = matches[current];
    isOpen = false;
    observer.disconnect();
    bar.classList.add('hidden');
    clearHighlights();
    if (isPreview()) return;
    if (match) window.Editor.selectRange(match.line, match.start, match.end);
    else window.Editor.restoreFocus(savedCaret);
  }

  findInput.addEventListener('input', () => {
    refresh(true);
    revealCurrent();
  });
  findInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    step(event.shiftKey ? -1 : 1);
  });
  replaceInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    replaceCurrent();
  });

  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  caseBtn.addEventListener('click', () => {
    matchCase = !matchCase;
    setToggle(caseBtn, matchCase);
    refresh(true);
    revealCurrent();
  });
  wrapBtn.addEventListener('click', () => {
    wrapAround = !wrapAround;
    setToggle(wrapBtn, wrapAround);
    refresh(true);
    revealCurrent();
  });
  replaceBtn.addEventListener('click', replaceCurrent);
  replaceAllBtn.addEventListener('click', replaceAll);
  closeBtn.addEventListener('click', close);

  bar.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) event.preventDefault();
  });
  bar.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  });

  document.addEventListener('selectionchange', () => {
    if (!isOpen || bar.contains(document.activeElement) || !selectionInEditor()) return;
    const caret = window.Editor.getCaret();
    cursor = { line: caret.line, offset: caret.offset };
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen && !event.defaultPrevented) {
      const dialog = document.getElementById('confirmOverlay');
      if (!dialog || dialog.classList.contains('hidden')) {
        event.preventDefault();
        close();
      }
      return;
    }
    const isMod = event.ctrlKey || event.metaKey;
    if (!isMod || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'f' && key !== 'h') return;
    const overlay = document.getElementById('confirmOverlay');
    if (overlay && !overlay.classList.contains('hidden')) return;
    event.preventDefault();
    open(key === 'h');
  });

  setToggle(caseBtn, matchCase);
  setToggle(wrapBtn, wrapAround);

  window.Find = { open, close };
})();
