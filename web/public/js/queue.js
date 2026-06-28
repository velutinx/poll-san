// web/public/js/queue.js – checkbox = premium, remove button = slash
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
  if (queueItems.length === 0) {
    container.innerHTML = '<div class="status">Queue is empty.</div>';
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'queue-drag-list';
  ul.id = 'queueDragList';
  queueItems.forEach((item, index) => {
    const text = item.text || item;
    const checked = item.checked || false;
    const slashed = item.slashed || false;
    const li = document.createElement('li');
    li.className = 'queue-item';
    li.dataset.index = index;

    // Checkbox (premium)
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.className = 'queue-checkbox';
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      togglePremium(index);
    });

    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.textContent = '⠿';

    const textSpan = document.createElement('span');
    textSpan.className = 'queue-text';
    textSpan.textContent = text;
    if (checked) {
      textSpan.style.fontWeight = 'bold';
      textSpan.style.color = '#f1c40f';
    }
    if (slashed) {
      textSpan.style.textDecoration = 'line-through';
      textSpan.style.opacity = '0.6';
    }

    // Remove button -> now toggles slash
    const slashBtn = document.createElement('button');
    slashBtn.className = 'queue-remove';
    slashBtn.textContent = '✕';
    slashBtn.title = 'Finish (strikethrough, disappears after 7 days)';
    slashBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSlash(index);
    });

    li.appendChild(checkbox);
    li.appendChild(dragHandle);
    li.appendChild(textSpan);
    li.appendChild(slashBtn);
    ul.appendChild(li);
  });
  container.appendChild(ul);

  if (sortableInstance) sortableInstance.destroy();
  sortableInstance = new Sortable(document.getElementById('queueDragList'), {
    handle: '.drag-handle',
    animation: 150,
    onEnd: function() {
      const newOrder = [];
      document.querySelectorAll('#queueDragList .queue-item').forEach(li => {
        const idx = parseInt(li.dataset.index);
        const originalItem = queueItems[idx];
        newOrder.push(originalItem);
      });
      queueItems = newOrder;
      saveReorder();
    }
  });
}

// ─── Premium toggle (checkbox) ─────────────────────────────
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

// ─── Slash toggle (remove button) ──────────────────────────
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
      const item = queueItems[index];
      const msg = item.slashed ? 'Item finished (slashed, will expire in 7 days)' : 'Un‑finished';
      showToast(msg, 'info');
    } else {
      showToast(data.error || 'Failed.', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Network error.', 'error');
  }
}

// ─── Add, reorder, remove (permanent) ──────────────────────
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

// Remove permanently (rare use) – we keep it but not bound to UI by default
async function removeQueueItem(index) {
  try {
    const res = await fetch('/api/queue/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index })
    });
    const data = await res.json();
    if (data.success) {
      queueItems = data.queue;
      renderQueue();
      showToast('Permanently removed.', 'info');
    } else {
      showToast(data.error || 'Failed.', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Network error.', 'error');
  }
}

async function saveReorder() {
  try {
    const res = await fetch('/api/queue/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queue: queueItems })
    });
    const data = await res.json();
    if (!data.success) {
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
window.removeQueueItem = removeQueueItem;   // still available but not used
window.togglePremium = togglePremium;
window.toggleSlash = toggleSlash;
