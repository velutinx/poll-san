// web/public/js/queue.js – with edit functionality
let queueItems = [];
let sortableInstance = null;

async function loadQueue() {
  const container = document.getElementById('queue-list');
  container.innerHTML = '<div class="status">Loading queue...</div>';
  try {
    const res = await fetch('/api/queue');
    const data = await res.json();
    queueItems = data.queue || [];
    renderQueue();
  } catch (err) {
    container.innerHTML = '<div class="status error">Failed to load queue.</div>';
    console.error(err);
  }
}

function renderQueue() {
  const container = document.getElementById('queue-list');
  container.innerHTML = '';

  const visibleItems = queueItems.filter(item => !item.slashed);

  if (visibleItems.length === 0) {
    container.innerHTML = '<div class="status">Queue is empty.</div>';
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'queue-drag-list';
  ul.id = 'queueDragList';

  visibleItems.forEach((item, displayIndex) => {
    const originalIndex = queueItems.indexOf(item);
    const text = item.text || item;
    const checked = item.checked || false;

    const li = document.createElement('li');
    li.className = 'queue-item';
    li.dataset.index = originalIndex;

    // --- Checkbox ---
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.className = 'queue-checkbox';
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      togglePremium(originalIndex);
    });

    // --- Drag handle ---
    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.textContent = '⠿';

    // --- Text container (editable) ---
    const textSpan = document.createElement('span');
    textSpan.className = 'queue-text';
    textSpan.textContent = text;
    if (checked) {
      textSpan.style.fontWeight = 'bold';
      textSpan.style.color = '#f1c40f';
    }

    // --- Edit button ---
    const editBtn = document.createElement('button');
    editBtn.className = 'queue-edit';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit item';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startEdit(originalIndex);
    });

    // --- Slash (remove) button ---
    const slashBtn = document.createElement('button');
    slashBtn.className = 'queue-remove';
    slashBtn.textContent = '✕';
    slashBtn.title = 'Finish (removed from dashboard, stays in DB for 7 days)';
    slashBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSlash(originalIndex);
    });

    li.appendChild(checkbox);
    li.appendChild(dragHandle);
    li.appendChild(textSpan);
    li.appendChild(editBtn);
    li.appendChild(slashBtn);
    ul.appendChild(li);
  });

  container.appendChild(ul);

  if (sortableInstance) sortableInstance.destroy();
  sortableInstance = new Sortable(document.getElementById('queueDragList'), {
    handle: '.drag-handle',
    animation: 150,
    onEnd: function() {
      const visibleOrder = [];
      document.querySelectorAll('#queueDragList .queue-item').forEach(li => {
        const idx = parseInt(li.dataset.index);
        const originalItem = queueItems[idx];
        if (originalItem && !originalItem.slashed) {
          visibleOrder.push(originalItem);
        }
      });
      saveReorder(visibleOrder);
    }
  });
}

// ─── Edit functions ──────────────────────────────────────────
function startEdit(index) {
  const li = document.querySelector(`.queue-item[data-index="${index}"]`);
  if (!li) return;
  const textSpan = li.querySelector('.queue-text');
  const editBtn = li.querySelector('.queue-edit');
  const currentText = textSpan.textContent;

  // Replace text with input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'queue-edit-input';
  input.value = currentText;
  input.style.flex = '1';
  input.style.background = '#0f172a';
  input.style.border = '1px solid #475569';
  input.style.borderRadius = '4px';
  input.style.color = 'white';
  input.style.padding = '4px 8px';
  input.style.marginRight = '8px';

  textSpan.replaceWith(input);
  input.focus();
  input.select();

  // Change edit button to save button
  editBtn.textContent = '✔️';
  editBtn.title = 'Save changes';
  editBtn.className = 'queue-save';

  // Save on Enter
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit(index, input.value);
    }
    if (e.key === 'Escape') {
      cancelEdit(index);
    }
  });

  // Save on blur (optional – we'll keep it to save on click only)
  // But we'll allow blur to cancel? Better to require explicit save.
  // We'll keep it as is.

  // Replace the save button's click handler
  editBtn.onclick = (e) => {
    e.stopPropagation();
    saveEdit(index, input.value);
  };
}

function cancelEdit(index) {
  // Re-render the whole queue to discard changes
  renderQueue();
}

async function saveEdit(index, newText) {
  newText = newText.trim();
  if (!newText) {
    showToast('Item text cannot be empty.', 'error');
    cancelEdit(index);
    return;
  }
  try {
    const res = await fetch('/api/queue/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index, newText })
    });
    const data = await res.json();
    if (data.success) {
      queueItems = data.queue;
      renderQueue();
      showToast('Item updated.', 'success');
    } else {
      showToast(data.error || 'Failed to update.', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Network error.', 'error');
  }
}

// ─── Existing functions (togglePremium, toggleSlash, addQueueItem, saveReorder) ───
async function togglePremium(index) {
  try {
    const res = await fetch('/api/queue/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index })
    });
    const data = await res.json();
    if (data.success) {
      queueItems = data.queue;
      renderQueue();
      showToast('Premium toggled', 'success');
    } else {
      showToast(data.error || 'Failed.', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Network error.', 'error');
  }
}

async function toggleSlash(index) {
  try {
    const res = await fetch('/api/queue/slash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index })
    });
    const data = await res.json();
    if (data.success) {
      queueItems = data.queue;
      renderQueue();
      showToast('Item finished – removed from dashboard, will auto‑delete after 7 days.', 'info');
    } else {
      showToast(data.error || 'Failed.', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Network error.', 'error');
  }
}

async function addQueueItem() {
  const toggle = document.getElementById('queue-toggle');
  const input = document.getElementById('queue-input');
  const gender = toggle.checked ? '♀️' : '♂️';
  const name = input.value.trim();
  if (!name) {
    showToast('Please enter a name.', 'error');
    return;
  }
  const entry = `${gender} ${name}`;
  try {
    const res = await fetch('/api/queue/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry })
    });
    const data = await res.json();
    if (data.success) {
      queueItems = data.queue;
      renderQueue();
      input.value = '';
      showToast('Added to queue!', 'success');
    } else {
      showToast(data.error || 'Failed to add.', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Network error.', 'error');
  }
}

async function saveReorder(visibleOrder) {
  try {
    const res = await fetch('/api/queue/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibleOrder })
    });
    const data = await res.json();
    if (data.success) {
      queueItems = data.queue;
      renderQueue();
    } else {
      showToast('Failed to save order.', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Network error.', 'error');
  }
}

// ─── Expose ──────────────────────────────────────────────────
window.loadQueue = loadQueue;
window.addQueueItem = addQueueItem;
window.togglePremium = togglePremium;
window.toggleSlash = toggleSlash;
