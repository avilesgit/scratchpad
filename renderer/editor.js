(function () {
  const state = {
    mode: 'text', // text, markdown, bbcode
    view: 'edit', // edit, live, preview
    lines: [''],
    dirty: false
  };

  const AUTO_PAIRS = { '*': '*', '"': '"', '(': ')', '[': ']', '{': '}' };
  const CLOSERS = new Set(Object.values(AUTO_PAIRS));
  const UNDO_GROUP_MS = 700;
  const MAX_HISTORY = 300;

  const SHORTCODE_TRIGGER_CHARS = new Set([' ', '\t', '.', ',', '!', '?', ';', ':', ')', ']', '}', '"', "'"]);
  const SHORTCODE_KEY_RE = /[A-Za-z0-9_-]+$/;

  let editorEl = null;
  let isComposing = false;
  let dragSource = null;
  let forcePlainPaste = false;

  let undoStack = [];
  let redoStack = [];
  let lastGroupTime = 0;
  let previewGeneration = 0;
  let previewRenderScheduled = false;

  function setDirty(value) {
    if (state.dirty === value) return;
    state.dirty = value;
    window.dispatchEvent(new CustomEvent('editor:dirty-change', { detail: { dirty: value } }));
  }

  function getRenderer() {
    if (state.mode === 'markdown' && window.MarkdownRenderer) return window.MarkdownRenderer.renderLine;
    if (state.mode === 'bbcode' && window.BBCodeRenderer) return window.BBCodeRenderer.renderLine;
    return null;
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function mark(raw) {
    return `<span class="syntax-mark">${escapeHtml(raw)}</span>`;
  }
  function codeSpan(raw) {
    return `<span class="bb-scratchblocks" spellcheck="false">${escapeHtml(raw)}</span>`;
  }

  function markdownFenceStateBefore(index) {
    if (state.mode !== 'markdown') return { inFence: false, lang: null };
    let inFence = false;
    let lang = null;
    for (let i = 0; i < index; i += 1) {
      const fenceOpen = state.lines[i].match(/^\s*```\s*([^\s`]*)/);
      if (fenceOpen) {
        inFence = !inFence;
        lang = inFence ? (fenceOpen[1] || '').toLowerCase() || null : null;
      }
    }
    return { inFence, lang };
  }

  function isMarkdownFenceOpenBefore(index) {
    return markdownFenceStateBefore(index).inFence;
  }

  function isInsideMarkdownCode(lineIndex, offset) {
    if (state.mode !== 'markdown') return false;
    if (isMarkdownFenceOpenBefore(lineIndex)) return true;
    const beforeCaret = (state.lines[lineIndex] || '').slice(0, offset);
    return (beforeCaret.match(/(?<!\\)`/g) || []).length % 2 === 1;
  }

  function autoPairFor(key, lineIndex, offset) {
    if (Object.prototype.hasOwnProperty.call(AUTO_PAIRS, key)) return AUTO_PAIRS[key];
    if (state.mode !== 'markdown') return null;
    const inCode = isInsideMarkdownCode(lineIndex, offset);
    if (key === "'" && inCode) return "'";
    if (key === '_' && !inCode) return '_';
    return null;
  }

  function getMarkdownListMatch(text) {
    if (state.mode !== 'markdown') return null;
    const bullet = text.match(/^(\s*)([-*+])(\s+)(.*)$/);
    if (bullet) {
      const [, indent, marker, spacing, rest] = bullet;
      return { indent, marker, spacing, rest, ordered: false };
    }
    const ordered = text.match(/^(\s*)(\d+(?:\.\d+)*)(\.)(\s+)(.*)$/);
    if (ordered) {
      const [, indent, num, dot, spacing, rest] = ordered;
      return { indent, marker: num + dot, spacing, rest, ordered: true, num, dot };
    }
    return null;
  }

  function incrementListNumber(num) {
    const segments = num.split('.');
    segments[segments.length - 1] = String(Number(segments[segments.length - 1]) + 1);
    return segments.join('.');
  }

  function getClosestLine(node) {
    while (node && node !== editorEl) {
      if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('line')) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function getSelectedLine() {
    const sel = window.getSelection();
    return sel && sel.rangeCount ? getClosestLine(sel.getRangeAt(0).startContainer) : null;
  }

  const LIVE_PREVIEW_HOLDER_SELECTOR = '.scratchblocks-live-preview, .mermaid-live-preview, .katex-live-preview';
  const MATH_INLINE_SELECTOR = '.md-math-inline';
  const CANONICALIZE_SELECTOR = `${LIVE_PREVIEW_HOLDER_SELECTOR}, ${MATH_INLINE_SELECTOR}`;

  function canonicalizeFragment(root) {
    root.querySelectorAll(LIVE_PREVIEW_HOLDER_SELECTOR).forEach((el) => el.remove());
    root.querySelectorAll(MATH_INLINE_SELECTOR).forEach((el) => {
      let raw = '';
      try {
        raw = decodeURIComponent(el.getAttribute('data-raw') || '');
      } catch (_err) {
        raw = '';
      }
      el.replaceWith(document.createTextNode(raw));
    });
    return root.textContent || '';
  }

  function readLineText(lineEl) {
    let text = lineEl.textContent || '';
    if (lineEl.querySelector(CANONICALIZE_SELECTOR)) {
      const clone = lineEl.cloneNode(true);
      text = canonicalizeFragment(clone);
    }
    if (/^\u00a0+$/.test(text)) return '';
    return text.replace(/\u00a0/g, ' ');
  }

  function getCaretOffsetInLine(lineEl) {
    const sel = window.getSelection();
    const maxLen = readLineText(lineEl).length;
    if (!sel.rangeCount) return maxLen;
    const range = sel.getRangeAt(0);
    if (!lineEl.contains(range.startContainer)) return maxLen;
    const preRange = document.createRange();
    preRange.selectNodeContents(lineEl);
    preRange.setEnd(range.startContainer, range.startOffset);
    const fragment = preRange.cloneContents();
    const text = canonicalizeFragment(fragment).replace(/\u00a0/g, ' ');
    return Math.min(text.length, maxLen);
  }

  function getOffsetAtBoundary(lineEl, container, offset) {
    const range = document.createRange();
    range.selectNodeContents(lineEl);
    range.setEnd(container, offset);
    const fragment = range.cloneContents();
    const text = canonicalizeFragment(fragment).replace(/\u00a0/g, ' ');
    return Math.min(text.length, readLineText(lineEl).length);
  }

  function deleteSelectedLines(range) {
    const startLine = getClosestLine(range.startContainer);
    const endLine = getClosestLine(range.endContainer);
    if (!startLine || !endLine) return false;
    const start = Number(startLine.dataset.index);
    const end = Number(endLine.dataset.index);
    const startOffset = getOffsetAtBoundary(startLine, range.startContainer, range.startOffset);
    const endOffset = getOffsetAtBoundary(endLine, range.endContainer, range.endOffset);
    const replacement = state.lines[start].slice(0, startOffset) + state.lines[end].slice(endOffset);
    state.lines.splice(start, end - start + 1, replacement);
    rebuildEditor();
    setCaret(start, startOffset);
    return true;
  }

  function replaceSelection(range, replacement) {
    const startLine = getClosestLine(range.startContainer);
    const endLine = getClosestLine(range.endContainer);
    if (!startLine || !endLine) return false;
    const start = Number(startLine.dataset.index);
    const end = Number(endLine.dataset.index);
    const startOffset = getOffsetAtBoundary(startLine, range.startContainer, range.startOffset);
    const endOffset = getOffsetAtBoundary(endLine, range.endContainer, range.endOffset);
    const pieces = String(replacement).replace(/\r\n|\r/g, '\n').split('\n');
    const prefix = state.lines[start].slice(0, startOffset);
    const suffix = state.lines[end].slice(endOffset);
    pieces[0] = prefix + pieces[0];
    pieces[pieces.length - 1] += suffix;
    state.lines.splice(start, end - start + 1, ...pieces);
    rebuildEditor();
    setCaret(start + pieces.length - 1, pieces[pieces.length - 1].length - suffix.length);
    return true;
  }

  function findTextPosition(container, offset) {
    let remaining = Math.max(0, offset);
    let result = null;
    let endPosition = null;

    function indexOfChild(el) {
      return Array.prototype.indexOf.call(el.parentNode.childNodes, el);
    }
    function boundaryBefore(el) {
      return { node: el.parentNode, offset: indexOfChild(el) };
    }
    function boundaryAfter(el) {
      return { node: el.parentNode, offset: indexOfChild(el) + 1 };
    }

    function walk(node) {
      if (result) return;
      if (node.nodeType === Node.ELEMENT_NODE && node.matches && node.matches(CANONICALIZE_SELECTOR)) {
        if (node.matches(MATH_INLINE_SELECTOR)) {
          let raw = '';
          try {
            raw = decodeURIComponent(node.getAttribute('data-raw') || '');
          } catch (_err) {
            raw = '';
          }
          const len = raw.length;
          if (remaining <= 0) {
            result = boundaryBefore(node);
            return;
          }
          if (remaining < len) {
            result = boundaryAfter(node);
            return;
          }
          remaining -= len;
          endPosition = boundaryAfter(node);
        }
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        const len = node.textContent.length;
        if (remaining <= len) {
          result = { node, offset: remaining };
          return;
        }
        remaining -= len;
        endPosition = { node, offset: len };
        return;
      }
      Array.from(node.childNodes).forEach(walk);
    }

    walk(container);
    if (result) return result;
    if (endPosition) return endPosition;

    const textNode = document.createTextNode('');
    container.appendChild(textNode);
    return { node: textNode, offset: 0 };
  }

  function setCaret(lineIndex, offset) {
    const lineEl = editorEl.children[lineIndex];
    if (!lineEl) return;
    const pos = findTextPosition(lineEl, offset);
    const range = document.createRange();
    const maxOffset = pos.node.nodeType === Node.TEXT_NODE ? pos.node.textContent.length : pos.node.childNodes.length;
    const safeOffset = Math.min(Math.max(0, pos.offset), maxOffset);

    range.setStart(pos.node, safeOffset);
    range.collapse(true);

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    lineEl.focus({ preventScroll: true });
  }

  function applyLineContent(div, index) {
    const raw = state.lines[index] ?? '';
    const renderer = getRenderer();
    const isPreview = state.view === 'preview';
    div.className = 'line';
    div.dataset.index = String(index);
    div.hidden = false;
    div.contentEditable = 'inherit';
    div.innerHTML = '';
    div.removeAttribute('spellcheck');

    if (isPreview) {
      const scratchSpan = findScratchblocksSpanContaining(index);
      if (scratchSpan) {
        if (scratchSpan.start !== index) {
          div.hidden = true;
          div.contentEditable = 'false';
          return;
        }
        const pre = document.createElement('pre');
        pre.className = 'scratchblocks-source';
        pre.dataset.scratchStyle = scratchSpan.style.replace(/[^a-z0-9-]/gi, '') || 'scratch3';
        pre.textContent = scratchSpan.source;
        div.appendChild(pre);
        div.classList.add('scratchblocks-preview-line');
        div.contentEditable = 'false';
        return;
      }

      const mdScratchFence = findMarkdownScratchFenceContaining(index);
      if (mdScratchFence) {
        if (mdScratchFence.start !== index) {
          div.hidden = true;
          div.contentEditable = 'false';
          return;
        }
        const pre = document.createElement('pre');
        pre.className = 'scratchblocks-source';
        pre.dataset.scratchStyle = mdScratchFence.style;
        pre.textContent = mdScratchFence.source;
        div.appendChild(pre);
        div.classList.add('scratchblocks-preview-line');
        div.contentEditable = 'false';
        return;
      }

      const mermaidFence = findMarkdownMermaidFenceContaining(index);
      if (mermaidFence) {
        if (mermaidFence.start !== index) {
          div.hidden = true;
          div.contentEditable = 'false';
          return;
        }
        const pre = document.createElement('pre');
        pre.className = 'mermaid-source';
        pre.textContent = mermaidFence.source;
        div.appendChild(pre);
        div.classList.add('mermaid-preview-line');
        div.contentEditable = 'false';
        return;
      }

      const mathFence = findMarkdownMathFenceContaining(index);
      if (mathFence) {
        if (mathFence.start !== index) {
          div.hidden = true;
          div.contentEditable = 'false';
          return;
        }
        const pre = document.createElement('pre');
        pre.className = 'katex-source';
        pre.textContent = mathFence.source;
        div.appendChild(pre);
        div.classList.add('katex-preview-line');
        div.contentEditable = 'false';
        return;
      }
    }

    let multiLineSpan = null;
    if (!isPreview && state.mode === 'bbcode') {
      const span = findScratchblocksSpanContaining(index);
      if (span && span.start !== span.end) multiLineSpan = span;
    }

    if (multiLineSpan && index === multiLineSpan.start) {
      const m = raw.match(/^(\s*\[scratchblocks(?:=|\s+)?[^\]]*\])(.*)$/i);
      const tagPart = m ? m[1] : raw;
      const restPart = m ? m[2] : '';
      div.innerHTML = mark(tagPart) + (restPart ? codeSpan(restPart) : '');
      if (restPart) div.setAttribute('spellcheck', 'false');
    } else if (multiLineSpan && index === multiLineSpan.end) {
      const closeMatch = raw.match(/\[\/scratchblocks\]/i);
      const closeIdx = closeMatch ? closeMatch.index : raw.length;
      const bodyPart = raw.slice(0, closeIdx);
      const tagPart = closeMatch ? closeMatch[0] : '';
      const afterPart = closeMatch ? raw.slice(closeIdx + tagPart.length) : '';
      div.innerHTML = (bodyPart ? codeSpan(bodyPart) : '') + mark(tagPart) + escapeHtml(afterPart);
      if (bodyPart) div.setAttribute('spellcheck', 'false');
    } else if (multiLineSpan) {
      div.innerHTML = raw === '' ? '<br>' : codeSpan(raw);
      div.setAttribute('spellcheck', 'false');
    } else if (renderer) {
      const fenceState = state.mode === 'markdown' ? markdownFenceStateBefore(index) : { inFence: false, lang: null };
      const { html, blockClass } = renderer(raw, { keepMarkers: !isPreview, inFence: fenceState.inFence, lang: fenceState.lang, live: state.view === 'live' });
      div.innerHTML = html || '<br>';
      if (blockClass) {
        blockClass.split(' ').filter(Boolean).forEach((c) => div.classList.add(c));
        if (blockClass.includes('md-code-line') || blockClass.includes('md-code-fence-line')) {
          div.setAttribute('spellcheck', 'false');
        }
      }
    } else {
      div.textContent = raw;
      if (raw === '') div.innerHTML = '<br>';
    }

    if (state.mode === 'bbcode' && state.view === 'live') {
      const liveSpan = findScratchblocksSpanContaining(index);
      if (liveSpan && liveSpan.end === index) {
        const holder = document.createElement('div');
        holder.className = 'scratchblocks-live-preview';
        holder.contentEditable = 'false';
        const pre = document.createElement('pre');
        pre.className = 'scratchblocks-source';
        pre.dataset.scratchStyle = liveSpan.style.replace(/[^a-z0-9-]/gi, '') || 'scratch3';
        pre.textContent = liveSpan.source;
        holder.appendChild(pre);
        div.appendChild(holder);
      }
    }

    if (state.mode === 'markdown' && state.view === 'live') {
      const liveFence = findMarkdownScratchFenceContaining(index);
      if (liveFence && liveFence.end === index) {
        const holder = document.createElement('div');
        holder.className = 'scratchblocks-live-preview';
        holder.contentEditable = 'false';
        const pre = document.createElement('pre');
        pre.className = 'scratchblocks-source';
        pre.dataset.scratchStyle = liveFence.style;
        pre.textContent = liveFence.source;
        holder.appendChild(pre);
        div.appendChild(holder);
      }

      const liveMermaid = findMarkdownMermaidFenceContaining(index);
      if (liveMermaid && liveMermaid.end === index) {
        const holder = document.createElement('div');
        holder.className = 'mermaid-live-preview';
        holder.contentEditable = 'false';
        const pre = document.createElement('pre');
        pre.className = 'mermaid-source';
        pre.textContent = liveMermaid.source;
        holder.appendChild(pre);
        div.appendChild(holder);
      }

      const liveMath = findMarkdownMathFenceContaining(index);
      if (liveMath && liveMath.end === index) {
        const holder = document.createElement('div');
        holder.className = 'katex-live-preview';
        holder.contentEditable = 'false';
        const pre = document.createElement('pre');
        pre.className = 'katex-source';
        pre.textContent = liveMath.source;
        holder.appendChild(pre);
        div.appendChild(holder);
      }
    }
  }

  function parseScratchFenceOpen(raw) {
    const m = (raw || '').match(/^\s*```\s*(scratchblocks|scratch)(?:[:\s]+([a-z0-9-]+))?\s*$/i);
    if (!m) return null;
    return { style: (m[2] || 'scratch3').toLowerCase() };
  }

  function isMermaidFenceOpen(raw) {
    return /^\s*```\s*mermaid\s*$/i.test(raw || '');
  }

  function getMarkdownMermaidFence(openIndex) {
    if (state.mode !== 'markdown' || !isMermaidFenceOpen(state.lines[openIndex])) return null;
    for (let end = openIndex + 1; end < state.lines.length; end += 1) {
      if (/^\s*```/.test(state.lines[end])) {
        return { start: openIndex, end, source: state.lines.slice(openIndex + 1, end).join('\n') };
      }
    }
    return null;
  }

  function findMarkdownMermaidFenceContaining(index) {
    if (state.mode !== 'markdown') return null;
    for (let start = 0; start <= index; start += 1) {
      const fence = getMarkdownMermaidFence(start);
      if (fence && fence.end >= index && index >= fence.start) return fence;
    }
    return null;
  }

  const MATH_FENCE_BACKTICK_RE = /^\s*```\s*math\s*$/i;
  const MATH_FENCE_DOLLAR_RE = /^\s*\$\$\$\s*$/;

  function isMathFenceOpen(raw) {
    return MATH_FENCE_BACKTICK_RE.test(raw || '') || MATH_FENCE_DOLLAR_RE.test(raw || '');
  }

  function getMarkdownMathFence(openIndex) {
    const openLine = state.lines[openIndex];
    if (state.mode !== 'markdown' || !isMathFenceOpen(openLine)) return null;
    const usesDollarFence = MATH_FENCE_DOLLAR_RE.test(openLine || '');
    const closeRe = usesDollarFence ? MATH_FENCE_DOLLAR_RE : /^\s*```/;
    for (let end = openIndex + 1; end < state.lines.length; end += 1) {
      if (closeRe.test(state.lines[end])) {
        return { start: openIndex, end, source: state.lines.slice(openIndex + 1, end).join('\n') };
      }
    }
    return null;
  }

  function findMarkdownMathFenceContaining(index) {
    if (state.mode !== 'markdown') return null;
    for (let start = 0; start <= index; start += 1) {
      const fence = getMarkdownMathFence(start);
      if (fence && fence.end >= index && index >= fence.start) return fence;
    }
    return null;
  }

  function getMarkdownScratchFence(openIndex) {
    if (state.mode !== 'markdown') return null;
    const open = parseScratchFenceOpen(state.lines[openIndex]);
    if (!open) return null;
    for (let end = openIndex + 1; end < state.lines.length; end += 1) {
      if (/^\s*```/.test(state.lines[end])) {
        const source = state.lines.slice(openIndex + 1, end).join('\n');
        return { start: openIndex, end, source, style: open.style };
      }
    }
    return null;
  }

  function findMarkdownScratchFenceContaining(index) {
    if (state.mode !== 'markdown') return null;
    for (let start = 0; start <= index; start += 1) {
      if (!/^\s*```/.test(state.lines[start] || '')) continue;
      const fence = getMarkdownScratchFence(start);
      if (fence && fence.end >= index && index >= fence.start) return fence;
    }
    return null;
  }

  function getScratchblocksSpan(index) {
    if (state.mode !== 'bbcode') return null;
    const open = state.lines[index].match(/^\s*\[scratchblocks(?:=|\s+)?([^\]]*)\](.*)$/i);
    if (!open) return null;
    const [, requestedStyle, afterOpen] = open;
    const source = [];
    let fragment = afterOpen;
    for (let end = index; end < state.lines.length; end += 1) {
      const closeAt = fragment.search(/\[\/scratchblocks\]/i);
      if (closeAt !== -1) {
        source.push(fragment.slice(0, closeAt));
        if (source[0] === '') source.shift();
        if (source[source.length - 1] === '') source.pop();
        return { start: index, end, source: source.join('\n'), style: requestedStyle.trim() || 'scratch3' };
      }
      source.push(fragment);
      fragment = state.lines[end + 1] ?? '';
    }
    return null;
  }

  function findScratchblocksSpanContaining(index) {
    for (let start = 0; start <= index; start += 1) {
      const span = getScratchblocksSpan(start);
      if (span && span.end >= index) return span;
    }
    return null;
  }

  function renderScratchblocksPreviews(generation) {
    const modeHasScratchblocks = state.mode === 'bbcode' || state.mode === 'markdown';
    if (!modeHasScratchblocks || state.view === 'edit' || !window.scratchblocks) return;
    document.querySelectorAll('#editor pre.scratchblocks-source').forEach((pre) => {
      try {
        if (generation !== previewGeneration || !pre.isConnected) return;
        const style = /^scratch(?:2|3(?:-[a-z-]+)?)$/i.test(pre.dataset.scratchStyle || '')
          ? pre.dataset.scratchStyle
          : 'scratch3';
        const options = { style, languages: ['en'], scale: 1 };
        const doc = window.scratchblocks.parse(pre.textContent, options);
        const svg = window.scratchblocks.render(doc, options);
        if (generation === previewGeneration && pre.isConnected) window.scratchblocks.replace(pre, svg, doc, options);
      } catch (err) {
        console.warn('Scratchblocks preview could not be rendered.', err);
      }
      });
  }

  async function renderMermaidPreviews(generation) {
    if (state.mode !== 'markdown' || state.view === 'edit' || !window.MermaidTiny) return;
    const sources = Array.from(document.querySelectorAll('#editor pre.mermaid-source'));
    for (let index = 0; index < sources.length; index += 1) {
      const pre = sources[index];
      if (generation !== previewGeneration || !pre.isConnected) return;
      const renderId = `scratchpad-mermaid-${generation}-${index}`;
      try {
        const result = await window.MermaidTiny.render(renderId, pre.textContent);
        if (generation !== previewGeneration || !pre.isConnected) return;
        const diagram = document.createElement('div');
        diagram.className = 'mermaid-diagram';
        diagram.innerHTML = result.svg;
        pre.replaceWith(diagram);
        if (typeof result.bindFunctions === 'function') result.bindFunctions(diagram);
      } catch (err) {
        document.getElementById(`d${renderId}`)?.remove();
        if (generation !== previewGeneration || !pre.isConnected) return;
        const message = document.createElement('div');
        message.className = 'mermaid-error';
        message.textContent = `Mermaid diagram error: ${err.message || 'Invalid diagram'}`;
        pre.replaceWith(message);
      }
    }
  }

  function renderMathPreviews(generation) {
    if (state.mode !== 'markdown' || state.view === 'edit' || !window.MathRenderer || !window.MathRenderer.isAvailable()) return;
    document.querySelectorAll('#editor pre.katex-source').forEach((pre) => {
      if (generation !== previewGeneration || !pre.isConnected) return;
      const rendered = window.MathRenderer.renderBlock(pre.textContent);
      if (!rendered) return;
      const diagram = document.createElement('div');
      diagram.className = 'katex-diagram';
      diagram.innerHTML = rendered;
      pre.replaceWith(diagram);
    });
  }

  function schedulePreviewRender() {
    previewGeneration += 1;
    if (previewRenderScheduled) return;
    previewRenderScheduled = true;
    requestAnimationFrame(() => {
      previewRenderScheduled = false;
      const generation = previewGeneration;
      renderScratchblocksPreviews(generation);
      renderMermaidPreviews(generation);
      renderMathPreviews(generation);
    });
  }

  function buildLineDiv(index) {
    const div = document.createElement('div');
    applyLineContent(div, index);
    return div;
  }

  function lineIsInteractable(lineEl) {
    return !!lineEl && !lineEl.hidden && lineEl.contentEditable !== 'false';
  }

  function nearestEditableIndex(idx) {
    if (!editorEl) return -1;
    const total = editorEl.children.length;
    for (let i = idx; i < total; i += 1) {
      if (lineIsInteractable(editorEl.children[i])) return i;
    }
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (lineIsInteractable(editorEl.children[i])) return i;
    }
    return -1;
  }

  function redecorateLine(lineEl, idx) {
    const offset = getCaretOffsetInLine(lineEl);

    const mightAffectScratchblocks = state.mode === 'bbcode' && state.view !== 'edit' &&
      state.lines.some((line) => /\[\/?scratchblocks/i.test(line));

    const mightAffectMarkdownFence = state.mode === 'markdown' && state.view !== 'edit' &&
      state.lines.some((line) => /^\s*```/.test(line) || MATH_FENCE_DOLLAR_RE.test(line));

    if (mightAffectScratchblocks || mightAffectMarkdownFence) {
      refreshAllLines();
      const target = nearestEditableIndex(idx);
      if (target !== -1) {
        const targetOffset = target === idx ? offset : (target > idx ? 0 : (state.lines[target] || '').length);
        setCaret(target, targetOffset);
      }
      return;
    }

    applyLineContent(lineEl, idx);
    setCaret(idx, offset);
  }

  function maybeExpandShortcode(event, lineEl, idx) {
    if (!window.Shortcodes || !window.Shortcodes.hasAny()) return false;
    if (event.inputType !== 'insertText' || !event.data || event.data.length !== 1) return false;
    if (!SHORTCODE_TRIGGER_CHARS.has(event.data)) return false;

    const caretOffset = getCaretOffsetInLine(lineEl);
    const line = state.lines[idx] || '';
    if (caretOffset < 1 || line.slice(caretOffset - 1, caretOffset) !== event.data) return false;

    const before = line.slice(0, caretOffset - 1);
    const match = before.match(SHORTCODE_KEY_RE);
    if (!match) return false;
    const key = match[0];
    const expansion = window.Shortcodes.lookup(key);
    if (expansion == null) return false;

    pushUndoSnapshot(true);
    const start = before.length - key.length;
    const delimiter = event.data;
    const after = line.slice(caretOffset);
    const pieces = expansion.replace(/\r\n|\r/g, '\n').split('\n');
    pieces[0] = line.slice(0, start) + pieces[0];
    const lastIdx = pieces.length - 1;
    pieces[lastIdx] = pieces[lastIdx] + delimiter + after;
    const caretOffsetInLast = pieces[lastIdx].length - after.length;

    state.lines.splice(idx, 1, ...pieces);
    rebuildEditor();
    setCaret(idx + lastIdx, caretOffsetInLast);
    return true;
  }

  function syncActiveLineFromDOM() {
    if (!editorEl) return;
    if (state.view === 'preview') return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !editorEl.contains(sel.anchorNode)) return;
    const lineEl = getClosestLine(sel.anchorNode);
    if (!lineEl) return;
    if (lineEl.classList.contains('scratchblocks-preview-line')) return;
    const idx = Number(lineEl.dataset.index);
    if (Number.isInteger(idx) && state.lines[idx] !== undefined) {
      state.lines[idx] = readLineText(lineEl);
    }
  }

  function refreshAllLines() {
    if (!editorEl) return;
    const isPreview = state.view === 'preview';
    editorEl.contentEditable = isPreview ? 'false' : 'true';
    editorEl.classList.toggle('preview-mode', isPreview);
    editorEl.classList.toggle('edit-mode', state.view === 'edit');
    editorEl.classList.toggle('live-mode', state.view === 'live');

    Array.from(editorEl.children).forEach((lineEl, i) => {
      if (lineEl.classList.contains('line')) {
        applyLineContent(lineEl, i);
      }
    });
    updateCounts();
    schedulePreviewRender();
  }

  function rebuildEditor() {
    if (!editorEl) return;
    const isPreview = state.view === 'preview';
    editorEl.contentEditable = isPreview ? 'false' : 'true';
    editorEl.classList.toggle('preview-mode', isPreview);
    editorEl.classList.toggle('edit-mode', state.view === 'edit');
    editorEl.classList.toggle('live-mode', state.view === 'live');

    editorEl.innerHTML = '';
    if (state.lines.length === 0) state.lines = [''];
    state.lines.forEach((_raw, i) => {
      editorEl.appendChild(buildLineDiv(i));
    });
    updateCounts();
    schedulePreviewRender();
  }

  function countText(text) {
    const trimmed = text.trim();
    const words = trimmed.length ? trimmed.split(/\s+/).length : 0;
    const chars = text.replace(/\r\n|\r|\n/g, '').length;
    return { words, chars };
  }

  function currentEditorSelectionText() {
    if (!editorEl) return null;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!editorEl.contains(range.commonAncestorContainer)) return null;
    const text = selection.toString();
    return text ? text : null;
  }

  function updateCounts() {
    const countsEl = document.getElementById('counts');
    if (!countsEl) return;
    const total = countText(state.lines.join('\n'));
    let label = `${total.words} word${total.words === 1 ? '' : 's'} \u00b7 ${total.chars} character${total.chars === 1 ? '' : 's'}`;
    const selectedText = currentEditorSelectionText();
    if (selectedText) {
      const selected = countText(selectedText);
      label += ` (${selected.words} word${selected.words === 1 ? '' : 's'}, ${selected.chars} character${selected.chars === 1 ? '' : 's'} selected)`;
    }
    countsEl.textContent = label;
  }

  function currentCaret() {
    if (editorEl) {
      const sel = window.getSelection();
      if (sel.rangeCount && editorEl.contains(sel.anchorNode)) {
        const lineEl = getClosestLine(sel.anchorNode);
        if (lineEl) {
          return { line: Number(lineEl.dataset.index), offset: getCaretOffsetInLine(lineEl) };
        }
      }
    }
    const lastLine = state.lines.length - 1;
    return { line: lastLine, offset: (state.lines[lastLine] || '').length };
  }

  function pushUndoSnapshot(forceNewGroup) {
    syncActiveLineFromDOM();
    setDirty(true);
    window.dispatchEvent(new Event('editor:edited'));
    const now = Date.now();
    if (!forceNewGroup && undoStack.length && now - lastGroupTime < UNDO_GROUP_MS) {
      lastGroupTime = now;
      return;
    }
    const caret = currentCaret();
    undoStack.push({ lines: state.lines.slice(), line: caret.line, offset: caret.offset });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    lastGroupTime = now;
  }

  function restoreSnapshot(snapshot) {
    state.lines = snapshot.lines.slice();
    rebuildEditor();
    requestAnimationFrame(() => setCaret(snapshot.line, snapshot.offset));
  }

  function doUndo() {
    if (!undoStack.length) return;
    const caret = currentCaret();
    const snapshot = undoStack.pop();
    redoStack.push({ lines: state.lines.slice(), line: caret.line, offset: caret.offset });
    lastGroupTime = 0;
    setDirty(true);
    window.dispatchEvent(new Event('editor:edited'));
    restoreSnapshot(snapshot);
  }

  function doRedo() {
    if (!redoStack.length) return;
    const caret = currentCaret();
    const snapshot = redoStack.pop();
    undoStack.push({ lines: state.lines.slice(), line: caret.line, offset: caret.offset });
    lastGroupTime = 0;
    setDirty(true);
    window.dispatchEvent(new Event('editor:edited'));
    restoreSnapshot(snapshot);
  }

  function stripMarkdownInline(text) {
    const saved = [];
    const keep = (value) => {
      saved.push(value);
      return `\u0000K${saved.length - 1}\u0000`;
    };
    let out = text;
    out = out.replace(/\$\$([^$]+)\$\$/g, keep);
    out = out.replace(/\$([^\s$][^$]*?)\$/g, keep);
    out = out.replace(/`([^`]+)`/g, (_m, code) => keep(code));
    out = out.replace(/\\([\\`*_{}[\]()#.!+\-~=])/g, keep);
    out = out.replace(/(!?\[[^\]]*\]\()([^)\s]+(?:\s+["'][^"']*["'])?\))/g, (_m, head, tail) => head + keep(tail));
    out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
    out = out.replace(/__([^_]+)__/g, '$1');
    out = out.replace(/==([^=]+)==/g, '$1');
    out = out.replace(/\*([^*]+)\*/g, '$1');
    out = out.replace(/_([^_]+)_/g, '$1');
    for (let pass = 0; pass < 4 && out.includes('\u0000K'); pass += 1) {
      out = out.replace(/\u0000K(\d+)\u0000/g, (_m, i) => saved[Number(i)]);
    }
    return out;
  }

  function formattingClearedLine(index) {
    const raw = state.lines[index];
    if (state.mode === 'markdown') {
      if (window.MarkdownRenderer && window.MarkdownRenderer.isFenceLine(raw)) return raw;
      if (markdownFenceStateBefore(index).inFence || findMarkdownMathFenceContaining(index)) return raw;
      let text = raw;
      let prefixed = false;
      let match = null;
      while ((match = text.match(/^>\s?(.*)$/))) {
        text = match[1];
        prefixed = true;
      }
      match = text.match(/^#{1,6}\s+(.*)$/);
      if (match) {
        text = match[1];
        prefixed = true;
      }
      if (prefixed) return stripMarkdownInline(text);
      match = text.match(/^(\s*)([-*+])(\s+)(.*)$/) || text.match(/^(\s*)(\d+(?:\.\d+)*\.)(\s+)(.*)$/);
      if (match) return match[1] + match[2] + match[3] + stripMarkdownInline(match[4]);
      return stripMarkdownInline(text);
    }
    if (state.mode === 'bbcode') {
      if (/\[\/?scratchblocks/i.test(raw) || findScratchblocksSpanContaining(index)) return raw;
      return raw.replace(/\[\/?(?:b|i|u|s|strike|code|color|size|quote|center)(?:=[^\]]*)?\]/gi, '');
    }
    return raw;
  }

  function clearFormatting() {
    if (!editorEl || state.view === 'preview' || state.mode === 'text') return false;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editorEl.contains(sel.anchorNode)) return false;
    syncActiveLineFromDOM();
    const range = sel.getRangeAt(0);
    const boundaryLine = (container, offset, isEnd) => {
      if (container === editorEl) {
        const index = isEnd ? offset - 1 : offset;
        return Math.min(Math.max(index, 0), state.lines.length - 1);
      }
      const lineEl = getClosestLine(container);
      return lineEl ? Number(lineEl.dataset.index) : null;
    };
    const first = boundaryLine(range.startContainer, range.startOffset, false);
    let last = boundaryLine(range.endContainer, range.endOffset, true);
    if (first === null || last === null) return false;
    const endLineEl = getClosestLine(range.endContainer);
    if (endLineEl && last > first && getOffsetAtBoundary(endLineEl, range.endContainer, range.endOffset) === 0) last -= 1;
    const changes = [];
    for (let i = first; i <= last; i += 1) {
      const next = formattingClearedLine(i);
      if (next !== state.lines[i]) changes.push([i, next]);
    }
    if (!changes.length) return false;
    const caret = currentCaret();
    pushUndoSnapshot(true);
    changes.forEach(([i, text]) => { state.lines[i] = text; });
    rebuildEditor();
    setCaret(caret.line, Math.min(caret.offset, state.lines[caret.line].length));
    return true;
  }

  function rangeInLine(line, start, end) {
    const lineEl = editorEl && editorEl.children[line];
    if (!lineEl) return null;
    const from = findTextPosition(lineEl, start);
    const to = findTextPosition(lineEl, end);
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  }

  function replaceRanges(edits, replacement) {
    if (!editorEl || state.view === 'preview' || !edits || !edits.length) return 0;
    syncActiveLineFromDOM();
    pushUndoSnapshot(true);
    const text = String(replacement).replace(/\r\n|\r|\n/g, ' ');
    for (let i = edits.length - 1; i >= 0; i -= 1) {
      const edit = edits[i];
      const current = state.lines[edit.line];
      if (current === undefined) continue;
      state.lines[edit.line] = current.slice(0, edit.start) + text + current.slice(edit.end);
    }
    rebuildEditor();
    return edits.length;
  }

  function selectRange(line, start, end) {
    if (!editorEl || state.view === 'preview') return;
    const range = rangeInLine(line, start, end);
    const lineEl = editorEl.children[line];
    if (!range || !lineEl) return;
    lineEl.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function domRangeAcrossLines(startLine, startOffset, endLine, endOffset) {
    const startLineEl = editorEl.children[startLine];
    const endLineEl = editorEl.children[endLine];
    if (!startLineEl || !endLineEl) return null;
    const from = findTextPosition(startLineEl, startOffset);
    const to = findTextPosition(endLineEl, endOffset);
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  }

  function adjustPointAfterDeletion(point, delStart, delEnd) {
    if (point.line < delStart.line || (point.line === delStart.line && point.offset <= delStart.offset)) {
      return point;
    }
    if (point.line > delEnd.line || (point.line === delEnd.line && point.offset >= delEnd.offset)) {
      if (point.line === delEnd.line) {
        return { line: delStart.line, offset: delStart.offset + (point.offset - delEnd.offset) };
      }
      return { line: point.line - (delEnd.line - delStart.line), offset: point.offset };
    }
    return null;
  }

  let dropCursorEl = null;

  function ensureDropCursor() {
    if (dropCursorEl) return dropCursorEl;
    dropCursorEl = document.createElement('div');
    dropCursorEl.id = 'dropCursor';
    document.body.appendChild(dropCursorEl);
    return dropCursorEl;
  }

  function getClientRectForPoint(point) {
    const lineEl = editorEl.children[point.line];
    if (!lineEl) return null;
    const pos = findTextPosition(lineEl, point.offset);
    const range = document.createRange();
    const maxOffset = pos.node.nodeType === Node.TEXT_NODE ? pos.node.textContent.length : pos.node.childNodes.length;
    const safeOffset = Math.min(Math.max(0, pos.offset), maxOffset);
    range.setStart(pos.node, safeOffset);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (rect && rect.height) return rect;
    return lineEl.getBoundingClientRect();
  }

  function showDropCursorAt(clientX, clientY) {
    if (state.view === 'preview') { hideDropCursor(); return; }
    const point = pointFromClient(clientX, clientY);
    if (!point) { hideDropCursor(); return; }
    const rect = getClientRectForPoint(point);
    if (!rect) { hideDropCursor(); return; }
    const el = ensureDropCursor();
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.height = `${rect.height || parseFloat(getComputedStyle(editorEl).lineHeight) || 20}px`;
    el.style.display = 'block';
  }

  function hideDropCursor() {
    if (dropCursorEl) dropCursorEl.style.display = 'none';
  }

  function lineElFromClientY(clientY) {
    const children = editorEl.children;
    for (let i = 0; i < children.length; i += 1) {
      if (clientY < children[i].getBoundingClientRect().bottom) return children[i];
    }
    return children[children.length - 1] || null;
  }

  function pointFromClient(clientX, clientY) {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(clientX, clientY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(clientX, clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    const lineEl = range ? getClosestLine(range.startContainer) : null;
    if (lineEl) {
      return { line: Number(lineEl.dataset.index), offset: getOffsetAtBoundary(lineEl, range.startContainer, range.startOffset) };
    }
    const fallbackLineEl = lineElFromClientY(clientY);
    if (!fallbackLineEl) return null;
    return { line: Number(fallbackLineEl.dataset.index), offset: readLineText(fallbackLineEl).length };
  }

  // Ctrl+' (acute), Ctrl+` (grave), Ctrl+; (macron): press the shortcut, release, then type a letter.
  const ACCENT_TRIGGERS = [
    { shift: false, keys: ["'"], codes: ['Quote'], mark: '\u0301', map: { d: '\u00f0', D: '\u00d0' } },
    { shift: false, keys: ['`'], codes: ['Backquote'], mark: '\u0300' },
    { shift: false, keys: [';'], codes: ['Semicolon'], mark: '\u0308' },
    { shift: true, keys: [':'], codes: ['Semicolon'], mark: '\u0308' },
    { shift: true, keys: ['^'], codes: ['Digit6'], mark: '\u0302' },
    { shift: true, keys: ['~'], codes: ['Backquote'], mark: '\u0303' },
    { shift: true, keys: ['@'], codes: ['Digit2'], map: { a: '\u00e5', A: '\u00c5' } },
    { shift: false, keys: [','], codes: ['Comma'], map: { c: '\u00e7', C: '\u00c7' } },
    { shift: false, keys: ['/'], codes: ['Slash'], map: { o: '\u00f8', O: '\u00d8' } },
    { shift: true, keys: ['&'], codes: ['Digit7'], map: { o: '\u0153', O: '\u0152', a: '\u00e6', A: '\u00c6', s: '\u00df' } }
  ];
  const ACCENT_IGNORED_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'Dead'];
  let pendingAccent = null;

  function accentForEvent(event) {
    return ACCENT_TRIGGERS.find((a) => a.shift === event.shiftKey && (a.keys.includes(event.key) || a.codes.includes(event.code))) || null;
  }

  function init() {
    editorEl = document.getElementById('editor');
    if (!editorEl) return;

    rebuildEditor();

    editorEl.addEventListener('focusout', () => {
      pendingAccent = null;
      syncActiveLineFromDOM();
      updateCounts();
    });

    editorEl.addEventListener('mousedown', () => {
      pendingAccent = null;
      syncActiveLineFromDOM();
      updateCounts();
    }, true);

    editorEl.addEventListener('beforeinput', (event) => {
      if (state.view === 'preview' || isComposing) return;
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') return;
      pushUndoSnapshot(false);
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      const startLine = getClosestLine(range.startContainer);
      const endLine = getClosestLine(range.endContainer);
      if (!startLine || !endLine || startLine === endLine || event.inputType === 'insertFromPaste') return;
      const replacement = event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak'
        ? '\n'
        : event.inputType.startsWith('delete') ? '' : (event.data || '');
      event.preventDefault();
      replaceSelection(range, replacement);
    });

    editorEl.addEventListener('compositionstart', () => {
      if (state.view !== 'preview') pushUndoSnapshot(false);
      isComposing = true;
    });

    editorEl.addEventListener('compositionend', (event) => {
      isComposing = false;
      const lineEl = getClosestLine(event.target) || getSelectedLine();
      if (!lineEl) return;
      const idx = Number(lineEl.dataset.index);
      state.lines[idx] = readLineText(lineEl);
      updateCounts();
      const renderer = getRenderer();
      if (renderer && state.view !== 'preview') redecorateLine(lineEl, idx);
    });

    editorEl.addEventListener('input', (event) => {
      if (state.view === 'preview') return;
      const lineEl = getClosestLine(event.target) || getSelectedLine();
      if (!lineEl) return;
      const idx = Number(lineEl.dataset.index);

      state.lines[idx] = readLineText(lineEl);
      updateCounts();

      if (!isComposing && maybeExpandShortcode(event, lineEl, idx)) return;

      const renderer = getRenderer();
      if (renderer && state.view !== 'preview' && !isComposing) {
        redecorateLine(lineEl, idx);
      }
    });

    editorEl.addEventListener('keydown', (event) => {
      const isMod = event.ctrlKey || event.metaKey;

      if (isMod && !event.altKey && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        doUndo();
        return;
      }
      if (isMod && !event.altKey && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
        event.preventDefault();
        doRedo();
        return;
      }

      if (isMod && event.shiftKey && event.key.toLowerCase() === 'v') {
        forcePlainPaste = true;
        return;
      }

      if (state.view === 'preview') {
        event.preventDefault();
        return;
      }

      if (isMod && event.altKey) {
        pendingAccent = null;
        if (event.shiftKey && (event.key === '?' || event.code === 'Slash')) {
          event.preventDefault();
          document.execCommand('insertText', false, '\u00bf');
          return;
        }
        if (event.shiftKey && (event.key === '!' || event.code === 'Digit1')) {
          event.preventDefault();
          document.execCommand('insertText', false, '\u00a1');
          return;
        }
        if (!event.shiftKey && event.key.toLowerCase() === 'e') {
          event.preventDefault();
          document.execCommand('insertText', false, '\u20ac');
          return;
        }
      }

      if (!isComposing && !event.isComposing) {
        if (pendingAccent) {
          const accent = pendingAccent;
          if (ACCENT_IGNORED_KEYS.includes(event.key)) return;
          pendingAccent = null;
          if (!isMod && !event.altKey) {
            let composed = null;
            if (accent.map && Object.prototype.hasOwnProperty.call(accent.map, event.key)) {
              composed = accent.map[event.key];
            } else if (accent.mark && event.key.length === 1) {
              const candidate = (event.key + accent.mark).normalize('NFC');
              if (candidate.length === 1) composed = candidate;
            }
            if (composed) {
              event.preventDefault();
              document.execCommand('insertText', false, composed);
              return;
            }
          }
        }
        if (isMod && !event.altKey) {
          const accent = accentForEvent(event);
          if (accent) {
            event.preventDefault();
            pendingAccent = accent;
            return;
          }
        }
      }

      if (isMod && event.key === 'Tab') {
        event.preventDefault();
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
        setTimeout(() => {
          syncActiveLineFromDOM();
        }, 0);
      }

      if (!isMod && !event.altKey && !event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const rawSel = window.getSelection();
        if (rawSel && rawSel.rangeCount && !rawSel.isCollapsed) {
          const range = rawSel.getRangeAt(0);
          const startLineEl = getClosestLine(range.startContainer);
          const endLineEl = getClosestLine(range.endContainer);
          if (startLineEl && endLineEl) {
            event.preventDefault();
            const startPoint = { line: Number(startLineEl.dataset.index), offset: getOffsetAtBoundary(startLineEl, range.startContainer, range.startOffset) };
            const endPoint = { line: Number(endLineEl.dataset.index), offset: getOffsetAtBoundary(endLineEl, range.endContainer, range.endOffset) };
            const target = event.key === 'ArrowLeft' ? startPoint : endPoint;
            setCaret(target.line, target.offset);
            syncActiveLineFromDOM();
            return;
          }
        }
      }

      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const lineEl = getClosestLine(sel.anchorNode);
      if (!lineEl) return;
      const idx = Number(lineEl.dataset.index);
      const offset = getCaretOffsetInLine(lineEl);
      const currentText = readLineText(lineEl);

      if (sel.isCollapsed && event.altKey && !isMod && event.key.toLowerCase() === 'x') {
        if (event.shiftKey) {
          const chars = Array.from(currentText.slice(0, offset));
          const lastChar = chars[chars.length - 1];
          if (lastChar) {
            event.preventDefault();
            pushUndoSnapshot(true);
            const hex = lastChar.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
            state.lines[idx] = currentText.slice(0, offset - lastChar.length) + hex + currentText.slice(offset);
            redecorateLine(lineEl, idx);
            setCaret(idx, offset - lastChar.length + hex.length);
          }
          return;
        }
        const match = currentText.slice(0, offset).match(/[0-9a-fA-F]{1,6}$/);
        const codePoint = match ? parseInt(match[0], 16) : NaN;
        if (match && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          event.preventDefault();
          pushUndoSnapshot(true);
          const char = String.fromCodePoint(codePoint);
          state.lines[idx] = currentText.slice(0, offset - match[0].length) + char + currentText.slice(offset);
          redecorateLine(lineEl, idx);
          setCaret(idx, offset - match[0].length + char.length);
          return;
        }
      }

      if (!sel.isCollapsed && (event.key === 'Backspace' || event.key === 'Delete')) {
        event.preventDefault();
        pushUndoSnapshot(true);
        deleteSelectedLines(sel.getRangeAt(0));
        return;
      }

      if (!sel.isCollapsed && event.key === 'Enter') {
        event.preventDefault();
        pushUndoSnapshot(true);
        replaceSelection(sel.getRangeAt(0), '\n');
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        pushUndoSnapshot(true);

        const listMatch = getMarkdownListMatch(currentText);
        if (listMatch) {
          let newIndent;
          let delta;
          if (event.shiftKey) {
            if (listMatch.indent.endsWith('\t')) {
              newIndent = listMatch.indent.slice(0, -1);
            } else {
              newIndent = listMatch.indent.replace(/ {1,4}$/, '');
            }
            delta = newIndent.length - listMatch.indent.length;
          } else {
            newIndent = listMatch.indent + '\t';
            delta = 1;
          }
          state.lines[idx] = newIndent + currentText.slice(listMatch.indent.length);
          redecorateLine(lineEl, idx);
          setCaret(idx, Math.max(0, offset + delta));
          return;
        }

        const range = sel.getRangeAt(0);
        const selectionStaysOnLine = sel.isCollapsed || (
          getClosestLine(range.startContainer) === lineEl &&
          getClosestLine(range.endContainer) === lineEl
        );
        const endOffset = selectionStaysOnLine && !sel.isCollapsed
          ? (() => {
              const endRange = document.createRange();
              endRange.selectNodeContents(lineEl);
              endRange.setEnd(range.endContainer, range.endOffset);
              return endRange.toString().length;
            })()
          : offset;
        state.lines[idx] = currentText.slice(0, offset) + '\t' + currentText.slice(endOffset);
        redecorateLine(lineEl, idx);
        setCaret(idx, offset + 1);
        return;
      }

      const canAutoPair = (state.mode === 'markdown' || state.mode === 'bbcode') && !isMod && !event.altKey;
      const dynamicPair = autoPairFor(event.key, idx, offset);

      if (canAutoPair && sel.isCollapsed && (CLOSERS.has(event.key) || dynamicPair === event.key) && currentText.charAt(offset) === event.key) {
        event.preventDefault();
        setCaret(idx, offset + 1);
        return;
      }

      const isSymmetricPair = dynamicPair === event.key;
      const continuesSymbolRun = isSymmetricPair && sel.isCollapsed && currentText.charAt(offset - 1) === event.key;

      if (canAutoPair && dynamicPair && !continuesSymbolRun) {
        event.preventDefault();
        pushUndoSnapshot(true);
        const open = event.key;
        const close = dynamicPair;

        if (!sel.isCollapsed) {
          const selected = sel.toString();
          const leadingMatch = selected.match(/^ +/);
          const leading = leadingMatch ? leadingMatch[0] : '';
          const withoutLeading = selected.slice(leading.length);
          const trailingMatch = withoutLeading.match(/ +$/);
          const trailing = trailingMatch ? trailingMatch[0] : '';
          const core = withoutLeading.slice(0, withoutLeading.length - trailing.length);
          const nextText = currentText.slice(0, offset) + leading + open + core + close + trailing + currentText.slice(offset + selected.length);
          state.lines[idx] = nextText;
          redecorateLine(lineEl, idx);
          setCaret(idx, offset + leading.length + open.length + core.length + close.length + trailing.length);
        } else {
          const nextText = currentText.slice(0, offset) + open + close + currentText.slice(offset);
          state.lines[idx] = nextText;
          redecorateLine(lineEl, idx);
          setCaret(idx, offset + 1);
        }
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        pushUndoSnapshot(true);

        if (!event.shiftKey) {
          const listMatch = getMarkdownListMatch(currentText);
          if (listMatch && listMatch.rest.trim() === '') {
            state.lines[idx] = listMatch.indent;
            redecorateLine(lineEl, idx);
            setCaret(idx, listMatch.indent.length);
            return;
          }
          if (listMatch) {
            const prefixLen = listMatch.indent.length + listMatch.marker.length + listMatch.spacing.length;
            if (offset >= prefixLen) {
              const before = currentText.slice(0, offset);
              const after = currentText.slice(offset);
              const continuationMarker = listMatch.ordered
                ? `${incrementListNumber(listMatch.num)}${listMatch.dot}`
                : listMatch.marker;
              const newLine = listMatch.indent + continuationMarker + listMatch.spacing + after;
              state.lines[idx] = before;
              state.lines.splice(idx + 1, 0, newLine);
              rebuildEditor();
              setCaret(idx + 1, listMatch.indent.length + continuationMarker.length + listMatch.spacing.length);
              return;
            }
          }
        }

        const before = currentText.slice(0, offset);
        const after = currentText.slice(offset);
        state.lines[idx] = before;
        state.lines.splice(idx + 1, 0, after);
        rebuildEditor();
        setCaret(idx + 1, 0);
      } else if (event.key === 'Backspace' && offset === 0 && idx > 0 && sel.isCollapsed) {
        event.preventDefault();
        pushUndoSnapshot(true);
        const prevLen = state.lines[idx - 1].length;
        state.lines[idx - 1] = state.lines[idx - 1] + currentText;
        state.lines.splice(idx, 1);
        rebuildEditor();
        setCaret(idx - 1, prevLen);
      } else if (event.key === 'Delete' && offset === currentText.length && idx < state.lines.length - 1 && sel.isCollapsed) {
        event.preventDefault();
        pushUndoSnapshot(true);
        state.lines[idx] = currentText + state.lines[idx + 1];
        state.lines.splice(idx + 1, 1);
        rebuildEditor();
        setCaret(idx, offset);
      } else if (event.key === 'Backspace' && sel.isCollapsed && offset === 0 && idx === 0) {
        event.preventDefault();
      } else if (event.key === 'Delete' && sel.isCollapsed && offset === currentText.length && idx === state.lines.length - 1) {
        event.preventDefault();
      }
    });

    editorEl.addEventListener('dragstart', (event) => {
      dragSource = null;
      if (state.view === 'preview') return;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const startLineEl = getClosestLine(range.startContainer);
      const endLineEl = getClosestLine(range.endContainer);
      if (!startLineEl || !endLineEl) return;
      let start = { line: Number(startLineEl.dataset.index), offset: getOffsetAtBoundary(startLineEl, range.startContainer, range.startOffset) };
      let end = { line: Number(endLineEl.dataset.index), offset: getOffsetAtBoundary(endLineEl, range.endContainer, range.endOffset) };
      if (start.line > end.line || (start.line === end.line && start.offset > end.offset)) {
        const swap = start;
        start = end;
        end = swap;
      }
      dragSource = { start, end };
      try {
        event.dataTransfer.setData('text/plain', sel.toString());
      } catch (_err) { /* clipboard access unavailable */ }
      event.dataTransfer.effectAllowed = 'copyMove';
    });

    editorEl.addEventListener('dragover', (event) => {
      const types = event.dataTransfer ? Array.from(event.dataTransfer.types) : [];
      if (types.includes('Files')) { hideDropCursor(); return; }
      if (!types.includes('text/plain') && !dragSource) { hideDropCursor(); return; }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : (dragSource ? 'move' : 'copy');
      }
      showDropCursorAt(event.clientX, event.clientY);
    });

    editorEl.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget || !editorEl.contains(event.relatedTarget)) {
        hideDropCursor();
      }
    });

    editorEl.addEventListener('drop', (event) => {
      hideDropCursor();
      const dt = event.dataTransfer;
      const types = dt ? Array.from(dt.types) : [];
      if (types.includes('Files')) return;
      if (state.view === 'preview') return;
      const text = dt ? dt.getData('text/plain') : '';
      if (!text) return;
      event.preventDefault();
      event.stopPropagation();

      const target = pointFromClient(event.clientX, event.clientY);
      if (!target) { dragSource = null; return; }

      syncActiveLineFromDOM();

      if (dragSource && !event.ctrlKey) {
        const adjusted = adjustPointAfterDeletion(target, dragSource.start, dragSource.end);
        if (!adjusted) { dragSource = null; return; }
        pushUndoSnapshot(true);
        const delRange = domRangeAcrossLines(dragSource.start.line, dragSource.start.offset, dragSource.end.line, dragSource.end.offset);
        if (delRange) deleteSelectedLines(delRange);
        const insertRange = domRangeAcrossLines(adjusted.line, adjusted.offset, adjusted.line, adjusted.offset);
        if (insertRange) replaceSelection(insertRange, text);
      } else {
        pushUndoSnapshot(true);
        const insertRange = domRangeAcrossLines(target.line, target.offset, target.line, target.offset);
        if (insertRange) replaceSelection(insertRange, text);
      }
      dragSource = null;
    });

    editorEl.addEventListener('dragend', () => {
      dragSource = null;
      hideDropCursor();
    });

    editorEl.addEventListener('paste', (event) => {
      if (state.view === 'preview') return;
      event.preventDefault();
      pushUndoSnapshot(true);
      const clipboard = event.clipboardData || window.clipboardData;
      const plainText = clipboard.getData('text/plain');
      const html = clipboard.getData('text/html');
      const usePlain = forcePlainPaste || !html || !window.PasteConvert;
      forcePlainPaste = false;
      const converted = usePlain ? null : window.PasteConvert.convert(html, state.mode);
      const text = converted != null ? converted : plainText;
      const sel = window.getSelection();
      const lineEl = getClosestLine(sel.anchorNode);
      if (!lineEl) return;
      const range = sel.getRangeAt(0);
      if (!sel.isCollapsed) {
        replaceSelection(range, text);
        return;
      }
      const idx = Number(lineEl.dataset.index);
      const offset = getCaretOffsetInLine(lineEl);
      const insertion = document.createRange();
      const textNode = findTextPosition(lineEl, offset);
      insertion.setStart(textNode.node, textNode.offset);
      insertion.collapse(true);
      replaceSelection(insertion, text);
    });

    document.addEventListener('selectionchange', updateCounts);
  }

  window.Editor = {
    init,
    getState: () => state,
    rebuild: rebuildEditor,
    refreshAllLines,
    updateCounts,
    setContent(text) {
      state.lines = text.length ? text.split(/\r\n|\r|\n/) : [''];
      setDirty(false);
      undoStack = [];
      redoStack = [];
      rebuildEditor();
    },
    getContent() {
      syncActiveLineFromDOM();
      return state.lines.join('\n');
    },
    isDirty: () => state.dirty,
    markSaved() { setDirty(false); },
    forceDirty() { setDirty(true); },
    setMode(mode) {
      if (state.view !== 'preview') syncActiveLineFromDOM();
      const caret = currentCaret();
      state.mode = mode;
      refreshAllLines();
      if (state.view !== 'preview') setCaret(caret.line, caret.offset);
    },
    setView(view) {
      if (state.view !== 'preview') syncActiveLineFromDOM();
      const caret = currentCaret();
      state.view = view;
      refreshAllLines();
      if (state.view !== 'preview') setCaret(caret.line, caret.offset);
    },
    undo: doUndo,
    redo: doRedo,
    clearFormatting,
    getLines() {
      syncActiveLineFromDOM();
      return state.lines.slice();
    },
    rangeInLine,
    replaceRanges,
    selectRange,
    getCaret: currentCaret,
    restoreFocus(caret) {
      if (!editorEl) return;
      if (state.view === 'preview') {
        editorEl.focus({ preventScroll: true });
        return;
      }
      const target = caret || currentCaret();
      const lastLine = state.lines.length - 1;
      const line = Math.min(Math.max(target.line, 0), lastLine);
      const offset = Math.min(Math.max(target.offset, 0), (state.lines[line] || '').length);
      setCaret(line, offset);
    }
  };

  window.addEventListener('scratchblocks:ready', schedulePreviewRender);
  window.addEventListener('mermaid:ready', schedulePreviewRender);
  window.addEventListener('katex:ready', schedulePreviewRender);
})();
