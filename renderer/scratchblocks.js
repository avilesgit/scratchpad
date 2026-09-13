import scratchblocks from '../node_modules/scratchblocks/browser.js';
window.scratchblocks = scratchblocks;
window.dispatchEvent(new Event('scratchblocks:ready'));
