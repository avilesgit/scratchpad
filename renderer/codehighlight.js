(function () {
  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  const KEYWORDS = {
    python: ['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def',
      'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
      'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'self', 'match', 'case'],
    gdscript: ['if', 'elif', 'else', 'for', 'while', 'match', 'break', 'continue', 'pass', 'return', 'func', 'class',
      'class_name', 'extends', 'var', 'const', 'enum', 'signal', 'export', 'onready', 'static', 'tool', 'and', 'or',
      'not', 'in', 'is', 'as', 'self', 'true', 'false', 'null', 'void', 'preload', 'yield', 'await', 'assert',
      'setget', 'remote', 'master', 'puppet', 'sync', 'super'],
    cpp: ['alignas', 'alignof', 'and', 'asm', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'char8_t', 'char16_t',
      'char32_t', 'class', 'const', 'constexpr', 'const_cast', 'continue', 'decltype', 'default', 'delete', 'do',
      'double', 'dynamic_cast', 'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend',
      'goto', 'if', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept', 'nullptr', 'operator',
      'private', 'protected', 'public', 'register', 'reinterpret_cast', 'return', 'short', 'signed', 'sizeof',
      'static', 'static_assert', 'static_cast', 'struct', 'switch', 'template', 'this', 'thread_local', 'throw',
      'true', 'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile',
      'wchar_t', 'while', 'include', 'define', 'pragma', 'ifdef', 'ifndef', 'endif'],
    csharp: ['abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char', 'checked', 'class', 'const',
      'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else', 'enum', 'event', 'explicit', 'extern',
      'false', 'finally', 'fixed', 'float', 'for', 'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface',
      'internal', 'is', 'lock', 'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override',
      'params', 'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short',
      'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
      'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'var', 'virtual', 'void', 'volatile', 'while',
      'async', 'await', 'get', 'set', 'yield'],
    java: ['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue',
      'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if',
      'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private',
      'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this',
      'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null', 'var', 'record',
      'yield'],
    javascript: ['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
      'else', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let',
      'new', 'null', 'of', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined',
      'var', 'void', 'while', 'with', 'yield', 'async', 'await', 'static', 'get', 'set']
  };
  KEYWORDS.typescript = KEYWORDS.javascript.concat(['interface', 'type', 'enum', 'implements', 'private', 'public',
    'protected', 'readonly', 'namespace', 'declare', 'as', 'is', 'keyof', 'infer', 'never', 'unknown', 'any']);
  KEYWORDS.c = KEYWORDS.cpp;

  const ALIASES = {
    py: 'python', python: 'python', python3: 'python',
    gd: 'gdscript', gdscript: 'gdscript',
    cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', 'c++11': 'cpp', 'c++17': 'cpp', 'c++20': 'cpp',
    c: 'c',
    csharp: 'csharp', 'c#': 'csharp', cs: 'csharp',
    java: 'java',
    js: 'javascript', javascript: 'javascript', jsx: 'javascript', mjs: 'javascript', node: 'javascript',
    ts: 'typescript', typescript: 'typescript', tsx: 'typescript',
    html: 'html', htm: 'html', xml: 'html',
    css: 'css', scss: 'css', less: 'css',
    json: 'json',
    sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash'
  };

  const SLASH_COMMENT_LANGS = new Set(['cpp', 'c', 'csharp', 'java', 'javascript', 'typescript']);
  const HASH_COMMENT_LANGS = new Set(['python', 'gdscript', 'bash']);

  function resolveLang(lang) {
    if (!lang) return null;
    const key = String(lang).trim().toLowerCase();
    if (ALIASES[key]) return ALIASES[key];
    if (KEYWORDS[key] || key === 'html' || key === 'css' || key === 'json') return key;
    return null;
  }

  function tokenize(raw, re) {
    let result = '';
    let lastIndex = 0;
    re.lastIndex = 0;
    let match = re.exec(raw);
    while (match) {
      if (match.index > lastIndex) result += esc(raw.slice(lastIndex, match.index));
      const groups = match.groups || {};
      const type = Object.keys(groups).find((key) => groups[key] !== undefined);
      result += type ? `<span class="code-${type}">${esc(match[0])}</span>` : esc(match[0]);
      lastIndex = match.index + match[0].length;
      if (match[0].length === 0) re.lastIndex += 1;
      match = re.exec(raw);
    }
    result += esc(raw.slice(lastIndex));
    return result;
  }

  function highlightGeneric(raw, lang) {
    const keywords = KEYWORDS[lang];
    const parts = [];
    if (SLASH_COMMENT_LANGS.has(lang)) parts.push('(?<comment>//.*|/\\*[\\s\\S]*?\\*/)');
    if (HASH_COMMENT_LANGS.has(lang)) parts.push('(?<comment>#.*)');
    parts.push('(?<string>"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)');
    if (keywords && keywords.length) parts.push(`(?<keyword>\\b(?:${keywords.join('|')})\\b)`);
    parts.push('(?<number>\\b0[xX][0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?\\b)');
    return tokenize(raw, new RegExp(parts.join('|'), 'g'));
  }

  function highlightHtml(raw) {
    const re = /(?<comment><!--[\s\S]*?-->)|(?<tag><\/?[a-zA-Z][a-zA-Z0-9-]*)|(?<string>"[^"]*"|'[^']*')|(?<attr>\b[a-zA-Z-:]+(?=\s*=))|(?<bracket>\/?>)/g;
    return tokenize(raw, re);
  }

  function highlightCss(raw) {
    const re = /(?<comment>\/\*[\s\S]*?\*\/)|(?<string>"[^"]*"|'[^']*')|(?<value>#[0-9a-fA-F]{3,8}\b)|(?<property>[a-zA-Z-]+(?=\s*:))|(?<number>\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?\b)/g;
    return tokenize(raw, re);
  }

  function highlightJson(raw) {
    const re = /(?<key>"(?:\\.|[^"\\])*"(?=\s*:))|(?<string>"(?:\\.|[^"\\])*")|(?<keyword>\btrue\b|\bfalse\b|\bnull\b)|(?<number>-?\b\d+(?:\.\d+)?\b)/g;
    return tokenize(raw, re);
  }

  function highlight(raw, lang) {
    const resolved = resolveLang(lang);
    if (!resolved) return esc(raw);
    if (resolved === 'html') return highlightHtml(raw);
    if (resolved === 'css') return highlightCss(raw);
    if (resolved === 'json') return highlightJson(raw);
    return highlightGeneric(raw, resolved);
  }

  window.CodeHighlight = {
    highlight,
    isSupported(lang) { return !!resolveLang(lang); }
  };
})();
