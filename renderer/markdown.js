(function () {
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function mark(raw) {
    return `<span class="syntax-mark">${escapeHtml(raw)}</span>`;
  }

  function sanitizeImageUrl(value) {
    const url = String(value || '').trim();
    if (/^(https?:|file:)/i.test(url)) return url;
    if (/^data:image\/(?:png|gif|jpe?g|webp|svg\+xml);/i.test(url)) return url;
    return null;
  }

  function imageTag(url, alt, title) {
    const src = sanitizeImageUrl(url);
    if (!src) return '';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img class="md-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr}>`;
  }

  const ESCAPABLE = /\\([\\`*_{}[\]()#.!+\-~=])/g;

  function mathTag(expr, displayMode) {
    if (window.MathRenderer && window.MathRenderer.isAvailable()) {
      const rendered = displayMode ? window.MathRenderer.renderBlock(expr) : window.MathRenderer.renderInline(expr);
      if (rendered) return rendered;
    }
    return `<code>${expr}</code>`;
  }

  function unescapeHtml(text) {
    return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  function wrapAtomicMath(rawSource, innerHtml) {
    const dataRaw = encodeURIComponent(rawSource);
    return `<span class="md-math-inline" contenteditable="false" data-raw="${dataRaw}">${innerHtml}</span>`;
  }

  function renderInline(raw, keepMarkers) {
    let text = escapeHtml(raw);

    const mathSpans = [];
    text = text.replace(/\$\$([^$]+)\$\$/g, (_m, expr) => {
      if (keepMarkers) {
        mathSpans.push(mark('$$') + `<code class="md-math-source" spellcheck="false">${expr}</code>` + mark('$$'));
        return `\u0000MATH${mathSpans.length - 1}\u0000`;
      }
      const rendered = mathTag(expr, true);
      const rawSource = `$$${unescapeHtml(expr)}$$`;
      mathSpans.push(wrapAtomicMath(rawSource, rendered));
      return `\u0000MATH${mathSpans.length - 1}\u0000`;
    });
    text = text.replace(/\$([^\s$][^$]*?)\$/g, (_m, expr) => {
      if (keepMarkers) {
        mathSpans.push(mark('$') + `<code class="md-math-source" spellcheck="false">${expr}</code>` + mark('$'));
        return `\u0000MATH${mathSpans.length - 1}\u0000`;
      }
      const rendered = mathTag(expr, false);
      const rawSource = `$${unescapeHtml(expr)}$`;
      mathSpans.push(wrapAtomicMath(rawSource, rendered));
      return `\u0000MATH${mathSpans.length - 1}\u0000`;
    });

    const codeSpans = [];
    text = text.replace(/`([^`]+)`/g, (_m, code) => {
      codeSpans.push(code);
      return `\u0000CODE${codeSpans.length - 1}\u0000`;
    });

    const escapes = [];
    text = text.replace(ESCAPABLE, (_m, ch) => {
      escapes.push(ch);
      return `\u0000ESC${escapes.length - 1}\u0000`;
    });

    text = text.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g, (_m, alt, url, title) => {
      const image = imageTag(url, alt, title);
      if (!image) return _m;
      return keepMarkers ? mark('![') + alt + mark('](') + mark(url) + (title ? mark(` "${title}"`) : '') + mark(')') + image : image;
    });

    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
      if (!keepMarkers) return `<a href="${url}">${label}</a>`;
      return mark('[') + label + mark('](') + mark(url) + mark(')');
    });

    const boldSpans = [];
    function protectBold(inner, markerChar) {
      const doubled = markerChar + markerChar;
      const rendered = keepMarkers
        ? mark(doubled) + `<strong>${inner}</strong>` + mark(doubled)
        : `<strong>${inner}</strong>`;
      boldSpans.push(rendered);
      return `\u0000BOLD${boldSpans.length - 1}\u0000`;
    }
    text = text.replace(/\*\*([^*]+)\*\*/g, (_m, inner) => protectBold(inner, '*'));
    text = text.replace(/__([^_]+)__/g, (_m, inner) => protectBold(inner, '_'));

    text = text.replace(/==([^=]+)==/g, (_m, inner) => {
      const rendered = keepMarkers
        ? mark('==') + `<mark>${inner}</mark>` + mark('==')
        : `<mark>${inner}</mark>`;
      boldSpans.push(rendered);
      return `\u0000BOLD${boldSpans.length - 1}\u0000`;
    });

    text = text.replace(/\*([^*]+)\*/g, (_m, inner) => (
      keepMarkers ? mark('*') + `<em>${inner}</em>` + mark('*') : `<em>${inner}</em>`
    ));
    text = text.replace(/_([^_]+)_/g, (_m, inner) => (
      keepMarkers ? mark('_') + `<em>${inner}</em>` + mark('_') : `<em>${inner}</em>`
    ));

    text = text.replace(/\u0000BOLD(\d+)\u0000/g, (_m, i) => boldSpans[Number(i)]);

    text = text.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => {
      const code = codeSpans[Number(i)];
      return keepMarkers ? mark('`') + `<code spellcheck="false">${code}</code>` + mark('`') : `<code spellcheck="false">${code}</code>`;
    });

    text = text.replace(/\u0000ESC(\d+)\u0000/g, (_m, i) => {
      const ch = escapes[Number(i)];
      return keepMarkers ? mark('\\') + ch : ch;
    });

    text = text.replace(/\u0000MATH(\d+)\u0000/g, (_m, i) => mathSpans[Number(i)]);

    return text;
  }

  const FENCE_RE = /^\s*```/;
  const MATH_FENCE_RE = /^\s*\$\$\$\s*$/;

  function isFenceLine(raw) {
    return FENCE_RE.test(raw) || MATH_FENCE_RE.test(raw);
  }

  function renderLine(raw, opts) {
    const keepMarkers = !opts || opts.keepMarkers !== false;
    const inFence = !!(opts && opts.inFence);
    const fenceLang = opts && opts.lang;

    if (isFenceLine(raw)) {
      return { html: keepMarkers ? mark(raw) : '', blockClass: 'md-code-fence-line' };
    }

    if (inFence) {
      const html = window.CodeHighlight && window.CodeHighlight.isSupported(fenceLang)
        ? window.CodeHighlight.highlight(raw, fenceLang)
        : escapeHtml(raw);
      return { html, blockClass: 'md-code-line' };
    }

    if (raw === '') return { html: '', blockClass: '' };

    const heading = raw.match(/^(#{1,6})(\s+)(.*)$/);
    if (heading) {
      const [, hashes, spacing, rest] = heading;
      const level = hashes.length;
      const inner = renderInline(rest, keepMarkers);
      const prefix = keepMarkers ? mark(hashes) + escapeHtml(spacing) : '';
      return {
        html: `<span class="md-heading md-h${level}">${prefix}${inner}</span>`,
        blockClass: 'md-heading-line'
      };
    }

    const quote = raw.match(/^(>\s?)(.*)$/);
    if (quote) {
      const [, prefix, rest] = quote;
      const inner = renderInline(rest, keepMarkers);
      return { html: (keepMarkers ? mark(prefix) : '') + inner, blockClass: 'md-quote-line' };
    }

    const unordered = raw.match(/^(\s*)([-*+])(\s+)(.*)$/);
    if (unordered) {
      const [, indent, bulletChar, spacing, rest] = unordered;
      const inner = renderInline(rest, keepMarkers);
      const bulletHtml = keepMarkers ? mark(bulletChar) : '<span class="md-bullet">&bull;</span>';
      return {
        html: `${escapeHtml(indent)}${bulletHtml}${keepMarkers ? escapeHtml(spacing) : ''}${inner}`,
        blockClass: 'md-list-line'
      };
    }

    const ordered = raw.match(/^(\s*)(\d+(?:\.\d+)*\.)(\s+)(.*)$/);
    if (ordered) {
      const [, indent, number, spacing, rest] = ordered;
      const inner = renderInline(rest, keepMarkers);
      const numberHtml = keepMarkers ? mark(number) : `<span class="md-bullet">${number}</span>`;
      return {
        html: `${escapeHtml(indent)}${numberHtml}${keepMarkers ? escapeHtml(spacing) : ''}${inner}`,
        blockClass: 'md-list-line'
      };
    }

    return { html: renderInline(raw, keepMarkers), blockClass: '' };
  }

  window.MarkdownRenderer = { renderLine, isFenceLine };
})();
