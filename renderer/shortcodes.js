(function () {
  const shortcodesBtn = document.getElementById('shortcodesBtn');
  const shortcodesPanel = document.getElementById('shortcodesPanel');
  const form = document.getElementById('shortcodeForm');
  const keyInput = document.getElementById('shortcodeKeyInput');
  const expansionInput = document.getElementById('shortcodeExpansionInput');
  const saveBtn = document.getElementById('shortcodeSaveBtn');
  const cancelBtn = document.getElementById('shortcodeCancelBtn');
  const errorEl = document.getElementById('shortcodeFormError');
  const listEl = document.getElementById('shortcodeList');

  if (!shortcodesBtn || !shortcodesPanel) return;

  let list = [];
  let byLowerKey = new Map();
  let editingKey = null;

  function rebuildIndex() {
    byLowerKey = new Map(list.map((item) => [item.key.toLowerCase(), item]));
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.toggle('hidden', !message);
  }

  function resetForm() {
    editingKey = null;
    keyInput.value = '';
    expansionInput.value = '';
    keyInput.disabled = false;
    saveBtn.textContent = 'Add';
    cancelBtn.classList.add('hidden');
    showError('');
  }

  function startEdit(item) {
    editingKey = item.key.toLowerCase();
    keyInput.value = item.key;
    expansionInput.value = item.expansion;
    saveBtn.textContent = 'Save';
    cancelBtn.classList.remove('hidden');
    showError('');
    keyInput.focus();
  }

  function renderList() {
    listEl.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'spell-note';
      empty.textContent = 'No shortcodes yet. Add one above.';
      listEl.appendChild(empty);
      return;
    }
    list.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'shortcode-row';

      const text = document.createElement('div');
      text.className = 'shortcode-row-text';
      const key = document.createElement('span');
      key.className = 'shortcode-key';
      key.textContent = item.key;
      const preview = document.createElement('span');
      preview.className = 'shortcode-preview';
      preview.textContent = item.expansion.replace(/\s+/g, ' ').trim();
      text.append(key, preview);

      const controls = document.createElement('div');
      controls.className = 'shortcode-row-controls';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'shortcode-edit';
      edit.title = `Edit ${item.key}`;
      edit.innerHTML = '&#9998;';
      edit.addEventListener('click', () => startEdit(item));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'dictionary-remove';
      remove.title = `Delete ${item.key}`;
      remove.innerHTML = '&#128465;';
      remove.addEventListener('click', () => deleteShortcode(item.key));
      controls.append(edit, remove);

      row.append(text, controls);
      listEl.appendChild(row);
    });
  }

  async function persist(nextList) {
    list = await window.api.setShortcodes(nextList);
    rebuildIndex();
    renderList();
  }

  async function deleteShortcode(key) {
    const lower = key.toLowerCase();
    if (editingKey === lower) resetForm();
    await persist(list.filter((item) => item.key.toLowerCase() !== lower));
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = keyInput.value.trim();
    const expansion = expansionInput.value;
    if (!key) { showError('Enter a shortcode.'); return; }
    if (!expansion) { showError('Enter what it should expand to.'); return; }
    if (/\s/.test(key)) { showError('Shortcodes can’t contain spaces.'); return; }

    const lower = key.toLowerCase();
    const clash = byLowerKey.get(lower);
    if (clash && lower !== editingKey) { showError(`"${key}" is already used.`); return; }

    const nextList = list.filter((item) => item.key.toLowerCase() !== editingKey && item.key.toLowerCase() !== lower);
    nextList.push({ key, expansion });
    await persist(nextList);
    resetForm();
  });

  cancelBtn?.addEventListener('click', () => resetForm());

  shortcodesBtn.addEventListener('click', () => {
    shortcodesPanel.classList.toggle('hidden');
    document.getElementById('spellPanel')?.classList.add('hidden');
  });

  document.addEventListener('click', (event) => {
    const path = event.composedPath();
    if (!path.includes(shortcodesPanel) && !path.includes(shortcodesBtn)) {
      shortcodesPanel.classList.add('hidden');
    }
  });

  async function init() {
    if (!window.api?.getShortcodes) return;
    list = await window.api.getShortcodes();
    rebuildIndex();
    renderList();
  }

  document.addEventListener('DOMContentLoaded', init);

  window.Shortcodes = {
    hasAny: () => byLowerKey.size > 0,
    lookup: (key) => {
      const item = byLowerKey.get(String(key || '').toLowerCase());
      return item ? item.expansion : null;
    },
    getAll: () => list.slice()
  };
})();
