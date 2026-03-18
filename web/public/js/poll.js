// poll.js

// ======================================================
// POLL FUNCTIONS
// ======================================================

// poll.js

async function loadActivePoll() {
    const listArea = document.getElementById('winner-list');
    if (!listArea) return;
    try {
        const res = await fetch('/api/poll-results-data');
        const data = await res.json();
        if (!data || data.length === 0) {
            listArea.innerHTML = '<p>No active poll.</p>';
            document.getElementById('launch-btn').disabled = false;
            document.getElementById('stop-btn').disabled = true;
            return;
        }
        document.getElementById('launch-btn').disabled = true;
        document.getElementById('stop-btn').disabled = false;
        listArea.innerHTML = '';
        data.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 'winner-btn' + (item.selected_at ? ' selected' : '');
            btn.innerText = `${item.character_name} (${parseFloat(item.score).toFixed(1)})`;
            btn.onclick = item.selected_at ? null : () => markWinner(item.character_name);
            listArea.appendChild(btn);
        });
    } catch (e) {
        listArea.innerHTML = 'Error loading characters.';
    }
}

async function triggerPoll() {
    const channel = document.getElementById('poll_channel').value;
    const days = document.getElementById('poll_days').value;
    const list = document.getElementById('poll_list').value;
    const res = await fetch('/api/trigger-poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channel, days, character_list: list })
    });
    if (res.ok) {
        showToast('Poll Started', 'New poll launched successfully');
        loadActivePoll();
    } else {
        showToast('Error', 'Failed to start poll', 'error');
    }
}

async function stopPoll() {
    if (!confirm("Stop poll?")) return;
    const res = await fetch('/api/stop-poll', { method: 'POST' });
    if (res.ok) {
        showToast('Poll Stopped', 'The poll has been stopped');
        loadActivePoll();
    } else {
        showToast('Error', 'Failed to stop poll', 'error');
    }
}

async function markWinner(name) {
    const res = await fetch('/api/mark-winner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner_name: name })
    });
    if (res.ok) {
        showToast('Winner Selected', `Character "${name}" marked as winner`);
        loadActivePoll();
    } else {
        showToast('Error', 'Failed to mark winner', 'error');
    }
}

// Expose functions globally
window.loadActivePoll = loadActivePoll;
window.triggerPoll = triggerPoll;
window.stopPoll = stopPoll;
window.markWinner = markWinner;
