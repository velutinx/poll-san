// web/public/js/queue.js – reorder fix
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

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.className = 'queue-checkbox';
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      togglePremium(originalIndex);
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
    li.appendChild(slashBtn);
    ul.appendChild(li);
  });
  container.appendChild(ul);

  if (sortableInstance) sortableInstance.destroy();
  sortableInstance = new Sortable(document.getElementById('queueDragList'), {
    handle: '.drag-handle',
    animation: 150,
    onEnd: function() {
      // Build visible order from the sorted list
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

// ─── Premium toggle ──────────────────────────────────────────
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

// ─── Slash toggle ──────────────────────────────────────────
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

// ─── Add ─────────────────────────────────────────────────────
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

// ─── Reorder ─────────────────────────────────────────────────
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
