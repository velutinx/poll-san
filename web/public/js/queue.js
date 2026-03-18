// queue.js

let queueItems = [];
let sortableInstance = null;

async function loadQueueData() {
    const queueContainer = document.getElementById('draggable-queue');
    const status = document.getElementById('queue-status');
    if (!queueContainer) return;
    try {
        status.innerText = '⏳ Loading queue...';
        const res = await fetch('/api/get-queue');
        if (!res.ok) throw new Error('Failed to fetch queue');
        const data = await res.json();
        queueItems = Array.isArray(data.queue) ? data.queue : [];
        renderQueue();
        status.innerText = '';
    } catch (err) {
        console.error(err);
        if (status) status.innerText = '❌ Error loading queue.';
    }
}

function renderQueue() {
    const queueContainer = document.getElementById('draggable-queue');
    if (!queueContainer) return;
    if (queueItems.length === 0) {
        queueContainer.innerHTML = '<p style="color:#94a3b8; text-align:center;">Queue is empty</p>';
        return;
    }
    queueContainer.innerHTML = queueItems.map((item, index) => `
        <div class="queue-item" data-index="${index}">
            <span class="drag-handle">☰</span>
            <span style="flex:1;">${index + 1}. ${item}</span>
            <span class="remove-btn" onclick="removeFromQueue('${item.replace(/'/g, "\\'")}')">✖</span>
        </div>
    `).join('');
    if (sortableInstance) sortableInstance.destroy();
    sortableInstance = new Sortable(queueContainer, {
        animation: 150,
        handle: '.drag-handle',
        ghostClass: 'queue-ghost',
        onEnd: async (evt) => {
            const oldIndex = evt.oldIndex;
            const newIndex = evt.newIndex;
            if (oldIndex === newIndex) return;
            const movedItem = queueItems.splice(oldIndex, 1)[0];
            queueItems.splice(newIndex, 0, movedItem);
            try {
                const res = await fetch('/api/queue-reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newQueue: queueItems })
                });
                if (!res.ok) throw new Error('Reorder failed');
                renderQueue();
            } catch (err) {
                console.error(err);
                showToast('Error', 'Failed to reorder queue', 'error');
                loadQueueData();
            }
        }
    });
}

async function addToQueue() {
    const input = document.getElementById('queue_input');
    const character = input.value.trim();
    if (!character) return;
    const status = document.getElementById('queue-status');
    status.innerText = '⏳ Adding...';
    try {
        const res = await fetch('/api/queue-add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ character })
        });
        if (!res.ok) throw new Error('Add failed');
        input.value = '';
        await loadQueueData();
        showToast('Added to Queue', `"${character}" has been added`);
        status.innerText = '';
    } catch (err) {
        console.error(err);
        showToast('Error', 'Failed to add to queue', 'error');
        status.innerText = '';
    }
}

async function removeFromQueue(character) {
    if (!confirm(`Remove "${character}" from queue?`)) return;
    const status = document.getElementById('queue-status');
    status.innerText = '⏳ Removing...';
    try {
        const res = await fetch('/api/queue-remove-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ character })
        });
        if (!res.ok) throw new Error('Remove failed');
        await loadQueueData();
        showToast('Removed from Queue', `"${character}" has been removed`);
        status.innerText = '';
    } catch (err) {
        console.error(err);
        showToast('Error', 'Failed to remove from queue', 'error');
        status.innerText = '';
    }
}

window.loadQueueData = loadQueueData;
window.addToQueue = addToQueue;
window.removeFromQueue = removeFromQueue;
