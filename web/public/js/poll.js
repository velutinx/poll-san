// poll.js

// ======================================================
// POLL FUNCTIONS
// ======================================================

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
    await fetch('/api/trigger-poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channel, days, character_list: list })
    });
    loadActivePoll();
}

async function stopPoll() {
    if (!confirm("Stop poll?")) return;
    await fetch('/api/stop-poll', { method: 'POST' });
    loadActivePoll();
}

async function markWinner(name) {
    await fetch('/api/mark-winner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner_name: name })
    });
    loadActivePoll();
}

// Expose functions globally for HTML onclick handlers
window.loadActivePoll = loadActivePoll;
window.triggerPoll = triggerPoll;
window.stopPoll = stopPoll;
window.markWinner = markWinner;