(function () {
  function isAvailable() {
    return !!window.katex;
  }

  function renderInline(source) {
    if (!window.katex) return null;
    try {
      return window.katex.renderToString(source, { throwOnError: false, displayMode: false });
    } catch (_err) {
      return null;
    }
  }

  function renderBlock(source) {
    if (!window.katex) return null;
    try {
      return window.katex.renderToString(source, { throwOnError: false, displayMode: true });
    } catch (_err) {
      return null;
    }
  }

  window.MathRenderer = { isAvailable, renderInline, renderBlock };
  if (window.katex) window.dispatchEvent(new Event('katex:ready'));
})();
