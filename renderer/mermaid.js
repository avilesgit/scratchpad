if (window.mermaid) {
  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'default',
    look: 'classic',
    layout: 'dagre'
  });

  window.MermaidTiny = {
    render: (id, source) => window.mermaid.render(id, source)
  };
  window.dispatchEvent(new Event('mermaid:ready'));
}
