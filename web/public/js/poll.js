// ======================================================
//     poll-san/web/public/js/poll.js
// ======================================================

let pollEndTime = null;          // timestamp in ms
let pollTimerInterval = null;

// ------- Countdown helpers -------
function updatePollTimerDisplay() {
    const el = document.getElementById('poll-timer');
    if (!el) return;

    if (!pollEndTime) {
        el.textContent = '';
        return;
    }

    const diff = pollEndTime - Date.now();
    if (diff <= 0) {
        el.textContent = '⏰ Poll ended';
        stopPollTimer();
        return;
    }

    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent = `⏳ Time left: ${d}d ${h}h ${m}m ${s}s`;
}

function startPollTimer(endTimeISO) {
    stopPollTimer();
    if (!endTimeISO) return;

    pollEndTime = new Date(endTimeISO).getTime();
    updatePollTimerDisplay();
    pollTimerInterval = setInterval(updatePollTimerDisplay, 1000);
}

function stopPollTimer() {
    if (pollTimerInterval) {
        clearInterval(pollTimerInterval);
        pollTimerInterval = null;
    }
    pollEndTime = null;
    const el = document.getElementById('poll-timer');
    if (el) el.textContent = '';
}

// ------- Main poll data loader -------
async function loadActivePoll() {
    const listArea = document.getElementById('winner-list');
    if (!listArea) return;

    try {
        const res = await fetch('/api/poll-results-data');
        const data = await res.json();

        let resultsArray, endTime;
        if (Array.isArray(data)) {
            resultsArray = data;
            endTime = null;
        } else {
            resultsArray = data.results || [];
            endTime = data.endTime || null;
        }

        if (endTime) {
            startPollTimer(endTime);
        } else {
            stopPollTimer();
        }

        if (!resultsArray || resultsArray.length === 0) {
            listArea.innerHTML = '<p>No active poll.</p>';
            document.getElementById('launch-btn').disabled = false;
            document.getElementById('stop-btn').disabled = true;
            return;
        }

        document.getElementById('launch-btn').disabled = true;
        document.getElementById('stop-btn').disabled = false;
        listArea.innerHTML = '';

        const buttons = [];
        let highestScore = -Infinity;

        resultsArray.forEach((item) => {
            const btn = document.createElement('button');
            const score = parseFloat(item.score);
            const hasWinner = !!item.selected_at;

            btn.className = 'winner-btn' + (hasWinner ? ' selected' : '');
            btn.innerText = `${item.character_name} (${score.toFixed(1)})`;
            btn.onclick = hasWinner ? null : () => markWinner(item.character_name);
            btn.setAttribute('data-score', score);

            listArea.appendChild(btn);
            buttons.push(btn);

            if (!hasWinner && score > highestScore) {
                highestScore = score;
            }
        });

        if (highestScore > -Infinity) {
            buttons.forEach(btn => {
                if (!btn.classList.contains('selected') && parseFloat(btn.getAttribute('data-score')) === highestScore) {
                    btn.classList.add('highest-score');
                }
            });
        }
    } catch (e) {
        console.error(e);
        listArea.innerHTML = 'Error loading characters.';
    }
}

// ------- Control actions -------
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
        setTimeout(loadActivePoll, 1000);
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

// ------- Adjust poll time (add/subtract hours) -------
async function adjustPollTime() {
    const hoursInput = document.getElementById('poll-adjust-hours');
    let hours = parseInt(hoursInput.value, 10);
    if (isNaN(hours)) hours = 0;

    const statusDiv = document.getElementById('poll-status');
    statusDiv.innerHTML = 'Updating...';
    try {
        const res = await fetch('/api/poll/adjust-time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hours })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Adjustment failed');
        statusDiv.innerHTML = `<span style="color:#4ade80;">✅ Poll end time updated by ${hours} hour(s).</span>`;
        if (data.newEndTime) {
            startPollTimer(data.newEndTime);
        }
        loadActivePoll(); // refresh winner list & timer
    } catch (err) {
        statusDiv.innerHTML = `<span style="color:#f87171;">❌ ${err.message}</span>`;
        console.error(err);
    }
}

// Expose functions globally
window.loadActivePoll = loadActivePoll;
window.triggerPoll = triggerPoll;
window.stopPoll = stopPoll;
window.markWinner = markWinner;
window.adjustPollTime = adjustPollTime;

// Auto-load on page ready
document.addEventListener('DOMContentLoaded', loadActivePoll);
