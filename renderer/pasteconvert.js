(function () {
  function convertChildren(node, mode) {
    return Array.from(node.childNodes).map((child) => convertNode(child, mode)).join('');
  }

  function convertNode(node, mode) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\u00a0/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    const inner = convertChildren(node, mode);

    if (mode === 'bbcode') {
      switch (tag) {
        case 'b': case 'strong': return `[b]${inner}[/b]`;
        case 'i': case 'em': return `[i]${inner}[/i]`;
        case 'u': return `[u]${inner}[/u]`;
        case 's': case 'strike': case 'del': return `[s]${inner}[/s]`;
        case 'a': {
          const href = node.getAttribute('href') || '';
          return href ? `[url=${href}]${inner}[/url]` : inner;
        }
        case 'code': return `[code]${inner}[/code]`;
        case 'pre': return `[code]${node.textContent}[/code]\n`;
        case 'blockquote': return `[quote]${inner}[/quote]\n`;
        case 'li': return `[*]${inner}\n`;
        case 'ul': case 'ol': return `${inner}\n`;
        case 'br': return '\n';
        case 'p': case 'div': return `${inner}\n\n`;
        default: return inner;
      }
    }

    switch (tag) {
      case 'b': case 'strong': return `**${inner}**`;
      case 'i': case 'em': return `*${inner}*`;
      case 'u': return `_${inner}_`;
      case 's': case 'strike': case 'del': return `~~${inner}~~`;
      case 'a': {
        const href = node.getAttribute('href') || '';
        return href ? `[${inner}](${href})` : inner;
      }
      case 'code': return `\`${inner}\``;
      case 'pre': return `\`\`\`\n${node.textContent}\n\`\`\`\n`;
      case 'blockquote': return `> ${inner}\n`;
      case 'li': return `- ${inner}\n`;
      case 'h1': return `# ${inner}\n`;
      case 'h2': return `## ${inner}\n`;
      case 'h3': return `### ${inner}\n`;
      case 'h4': return `#### ${inner}\n`;
      case 'h5': return `##### ${inner}\n`;
      case 'h6': return `###### ${inner}\n`;
      case 'br': return '\n';
      case 'ul': case 'ol': return `${inner}\n`;
      case 'p': case 'div': return `${inner}\n\n`;
      default: return inner;
    }
  }

  function convert(html, mode) {
    if (!html || (mode !== 'markdown' && mode !== 'bbcode')) return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const result = convertChildren(doc.body, mode);
    const cleaned = result
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return cleaned || null;
  }

  window.PasteConvert = { convert };
})();
