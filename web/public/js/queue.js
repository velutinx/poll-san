// queue.js
let queueItems = [];
let sortableInstance = null;
// Load queue data from backend and render
async function loadQueueData() {
    console.log("loadQueueData from queue.js called");
    const queueContainer = document.getElementById('draggable-queue');
    const status = document.getElementById('queue-status');
    if (!queueContainer) {
        console.error("queueContainer not found!");
        return;
    }
    try {
        status.innerText = '⏳ Loading queue...';
        const res = await fetch('/api/get-queue');
        if (!res.ok) throw new Error('Failed to fetch queue');
       
        const data = await res.json();
        console.log('Queue API response:', data);
        queueItems = Array.isArray(data.queue) ? data.queue : [];
        console.log('queueItems:', queueItems);
       
        renderQueue();  // Call directly—no setTimeout needed
        status.innerText = '';
    } catch (err) {
        console.error(err);
        if (status) status.innerText = '❌ Error loading queue.';
    }
}
// Render the queue list
function renderQueue() {
    console.log("renderQueue called, queueItems length:", queueItems.length);
    const queueContainer = document.getElementById('draggable-queue');
    if (!queueContainer) {
        console.error("renderQueue: queueContainer not found!");
        return;
    }
    if (queueItems.length === 0) {
        queueContainer.innerHTML = '<p style="color:#94a3b8; text-align:center;">Queue is empty</p>';
        return;
    }
    // Build HTML
    let html = '';
    queueItems.forEach((item, index) => {
        const safeItem = item.replace(/'/g, "\\'");
        html += `
            <div class="queue-item" data-index="${index}">
                <span class="drag-handle">☰</span>
                <span style="flex:1;">${index + 1}. ${item}</span>
                <span class="remove-btn" onclick="removeFromQueue('${safeItem}')">✖</span>
            </div>
        `;
    });
    queueContainer.innerHTML = html;
    console.log("HTML set, queueContainer innerHTML length:", html.length);
    // --- DEBUGGING: check if items are in DOM and visible ---
    const items = document.querySelectorAll('.queue-item');
    console.log(`Number of .queue-item in DOM: ${items.length}`);
    if (items.length > 0) {
        const firstItem = items[0];
        const style = window.getComputedStyle(firstItem);
        console.log('First item display:', style.display);
        console.log('First item visibility:', style.visibility);
        console.log('First item opacity:', style.opacity);
        console.log('First item computed height:', firstItem.getBoundingClientRect().height + 'px');  // Accurate pixel height
    }
    // Force reflow (sometimes helps)
// Force reflow (sometimes helps)
queueContainer.offsetHeight;
console.log('Container computed height:', queueContainer.getBoundingClientRect().height + 'px'); // NEW: Log container height

    // Initialize Sortable for drag-drop reordering
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
                alert('Failed to save new order');
                loadQueueData(); // revert
            }
        }
    });
    console.log("Sortable initialized");
}
// Add a character to the queue
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
        status.innerText = '✅ Added!';
        setTimeout(() => status.innerText = '', 2000);
    } catch (err) {
        console.error(err);
        status.innerText = '❌ Failed to add.';
    }
}
// Remove a character from the queue
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
        status.innerText = '🗑️ Removed!';
        setTimeout(() => status.innerText = '', 2000);
    } catch (err) {
        console.error(err);
        status.innerText = '❌ Failed to remove.';
    }
}
// ====== MAKE FUNCTIONS GLOBALLY AVAILABLE ======
window.loadQueueData = loadQueueData;
window.addToQueue = addToQueue;
window.removeFromQueue = removeFromQueue;