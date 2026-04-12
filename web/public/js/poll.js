// this is poll-san/web/public/js/poll.js

// ======================================================
// POLL FUNCTIONS
// ======================================================

async function loadActivePoll() {
    const listArea = document.getElementById('winner-list');
    if (!listArea) return;
    try {
        const res = await fetch('/api/poll-results-data');
        const data = await res.json();

        // Handle the case where the API might return { results: [], pollId: ... } 
        // or just a flat array. Adjusting for both.
        const pollData = Array.isArray(data) ? data : (data.results || []);
        
        // Use current date as a fallback cache-buster if no specific ID/Time is found
        const cacheBuster = data.pollId || new Date().toISOString().split('T')[0].replace(/-/g, '');

        if (!pollData || pollData.length === 0) {
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

        pollData.forEach((item, index) => {
            const container = document.createElement('div');
            container.className = 'winner-item-container'; // Optional styling class
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.marginBottom = '10px';

            // 1. Create the Image Preview (Cache-Busted)
            const img = document.createElement('img');
            const imgNum = index + 1;
            img.src = `https://www.velutinx.com/images/poll/${imgNum}.jpg?v=${cacheBuster}`;
            img.style.width = '60px';
            img.style.height = 'auto';
            img.style.marginRight = '15px';
            img.style.borderRadius = '4px';
            img.alt = item.character_name;

            // 2. Create the Button
            const btn = document.createElement('button');
            const score = parseFloat(item.score);
            const hasWinner = !!item.selected_at;
            
            btn.className = 'winner-btn' + (hasWinner ? ' selected' : '');
            btn.innerText = `${item.character_name} (${score.toFixed(1)})`;
            btn.onclick = hasWinner ? null : () => markWinner(item.character_name);
            btn.setAttribute('data-score', score);
            
            // Assembly
            container.appendChild(img);
            container.appendChild(btn);
            listArea.appendChild(container);
            
            buttons.push(btn);

            if (!hasWinner && score > highestScore) {
                highestScore = score;
            }
        });

        // Apply 'highest-score' class to top contenders
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
        // Small delay to let DB catch up before reload
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

// Expose functions globally
window.loadActivePoll = loadActivePoll;
window.triggerPoll = triggerPoll;
window.stopPoll = stopPoll;
window.markWinner = markWinner;

// Auto-load on page ready
document.addEventListener('DOMContentLoaded', loadActivePoll);
