// [b] [i] [u] [s]/[strike] [code] [color=...] [size=...] [url]/[url=...] [img] [quote] [center] [*]

(function () {
  const TAG_NAMES = new Set(['b', 'i', 'u', 's', 'strike', 'code', 'color', 'size', 'url', 'img', 'quote', 'center', 'scratchblocks']);

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

  function sanitizeColor(value) {
    if (!value) return null;
    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
    if (/^[a-zA-Z]{2,20}$/.test(trimmed)) return trimmed;
    return null;
  }

  function sanitizeSize(value) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return null;
    return Math.max(8, Math.min(48, n));
  }

  function sanitizeUrl(value) {
    if (!value) return null;
    const trimmed = value.trim();
    if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
    return null;
  }

  function sanitizeImageUrl(value) {
    const url = String(value || '').trim();
    if (/^(https?:|file:)/i.test(url)) return url;
    if (/^data:image\/(?:png|gif|jpe?g|webp|svg\+xml);/i.test(url)) return url;
    return null;
  }

  function textFromHtml(html) {
    const box = document.createElement('textarea');
    box.innerHTML = html.replace(/<[^>]*>/g, '');
    return box.value;
  }

  function renderTag(name, param, innerHtml, keepMarkers, live) {
    switch (name) {
      case 'b': return `<strong>${innerHtml}</strong>`;
      case 'i': return `<em>${innerHtml}</em>`;
      case 'u': return `<span class="bb-u">${innerHtml}</span>`;
      case 's':
      case 'strike': return `<span class="bb-s">${innerHtml}</span>`;
      case 'code': return `<code spellcheck="false">${innerHtml}</code>`;
      case 'color': {
        const c = sanitizeColor(param);
        return c ? `<span style="color:${c}">${innerHtml}</span>` : innerHtml;
      }
      case 'size': {
        const s = sanitizeSize(param);
        return s ? `<span style="font-size:${s}px">${innerHtml}</span>` : innerHtml;
      }
      case 'url': {
        const plainText = innerHtml.replace(/<[^>]*>/g, '');
        const href = sanitizeUrl(param) || sanitizeUrl(plainText);
        return href ? `<a href="${escapeHtml(href)}">${innerHtml}</a>` : innerHtml;
      }
      case 'img': {
        const src = sanitizeImageUrl(textFromHtml(innerHtml));
        if (!keepMarkers) return src ? `<img class="bb-image" src="${escapeHtml(src)}" alt="BBCode image">` : innerHtml;
        const preview = live && src
          ? `<img class="bb-image bb-image-live-preview" src="${escapeHtml(src)}" alt="BBCode image" contenteditable="false">`
          : '';
        return `${innerHtml}${preview}`;
      }
      case 'quote': return `<span class="bb-quote">${innerHtml}</span>`;
      case 'center': return `<span class="bb-center">${innerHtml}</span>`;
      case 'scratchblocks': {
        const style = String(param || 'scratch3').replace(/[^a-z0-9-]/gi, '') || 'scratch3';
        return keepMarkers
          ? `<span class="bb-scratchblocks" spellcheck="false">${innerHtml}</span>`
          : `<pre class="scratchblocks-source" data-scratch-style="${style}">${innerHtml}</pre>`;
      }
      default: return innerHtml;
    }
  }

  function tokenize(raw) {
    const tokens = [];
    let i = 0;
    let textBuf = '';
    function flushText() {
      if (textBuf) {
        tokens.push({ type: 'text', value: textBuf });
        textBuf = '';
      }
    }
    while (i < raw.length) {
      if (raw[i] === '[') {
        const closeIdx = raw.indexOf(']', i + 1);
        if (closeIdx !== -1) {
          const inside = raw.slice(i + 1, closeIdx);
          const closeMatch = inside.match(/^\/([a-zA-Z]+)$/);
          const openMatch = inside.match(/^([a-zA-Z]+)(?:=([^\]]*))?$/);
          if (closeMatch && TAG_NAMES.has(closeMatch[1].toLowerCase())) {
            flushText();
            tokens.push({ type: 'close', name: closeMatch[1].toLowerCase(), raw: raw.slice(i, closeIdx + 1) });
            i = closeIdx + 1;
            continue;
          }
          if (openMatch && TAG_NAMES.has(openMatch[1].toLowerCase())) {
            flushText();
            tokens.push({ type: 'open', name: openMatch[1].toLowerCase(), param: openMatch[2], raw: raw.slice(i, closeIdx + 1) });
            i = closeIdx + 1;
            continue;
          }
          if (inside === '*') {
            flushText();
            tokens.push({ type: 'bullet', raw: raw.slice(i, closeIdx + 1) });
            i = closeIdx + 1;
            continue;
          }
        }
      }
      textBuf += raw[i];
      i += 1;
    }
    flushText();
    return tokens;
  }

  function parseTokens(tokens, keepMarkers, live) {
    let i = 0;

    function parseSeq(stopName) {
      let out = '';
      while (i < tokens.length) {
        const tok = tokens[i];

        if (tok.type === 'close' && tok.name === stopName) {
          return out;
        }
        if (tok.type === 'text') {
          out += escapeHtml(tok.value);
          i += 1;
          continue;
        }
        if (tok.type === 'bullet') {
          out += keepMarkers ? mark(tok.raw) : '';
          i += 1;
          continue;
        }
        if (tok.type === 'close') {
          out += escapeHtml(tok.raw);
          i += 1;
          continue;
        }

        const openTok = tok;
        const rollbackIndex = i + 1;
        i += 1;
        const innerHtml = parseSeq(openTok.name);
        if (tokens[i] && tokens[i].type === 'close' && tokens[i].name === openTok.name) {
          const closeTok = tokens[i];
          i += 1;
          const rendered = renderTag(openTok.name, openTok.param, innerHtml, keepMarkers, live);
          out += keepMarkers ? mark(openTok.raw) + rendered + mark(closeTok.raw) : rendered;
        } else {
          out += escapeHtml(openTok.raw);
          i = rollbackIndex;
        }
      }
      return out;
    }

    return parseSeq(null);
  }

  function renderInline(raw, keepMarkers, live) {
    return parseTokens(tokenize(raw), keepMarkers, live);
  }

  function renderLine(raw, opts) {
    const keepMarkers = !opts || opts.keepMarkers !== false;
    const live = !!(opts && opts.live);

    if (raw === '') return { html: '', blockClass: '' };

    const bulletLine = raw.match(/^(\s*)\[\*\](\s?)(.*)$/i);
    if (bulletLine) {
      const [, indent, spacing, rest] = bulletLine;
      const inner = renderInline(rest, keepMarkers, live);
      const bulletHtml = keepMarkers ? mark('[*]') : '<span class="md-bullet">&bull;</span>';
      return {
        html: `${escapeHtml(indent)}${bulletHtml}${keepMarkers ? escapeHtml(spacing) : ''}${inner}`,
        blockClass: 'md-list-line'
      };
    }

    return { html: renderInline(raw, keepMarkers, live), blockClass: '' };
  }

  window.BBCodeRenderer = { renderLine };
})();
