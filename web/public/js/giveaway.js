// Giveaway tab functions
let currentGiveawayData = null;
let giveawaySortColumn = null;
let giveawaySortDirection = 'asc';

async function loadGiveawayData() {
    const infoDiv = document.getElementById('giveaway-info');
    const tbody = document.getElementById('giveaway-table-body');
    const statusDiv = document.getElementById('giveaway-status');
    tbody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
    statusDiv.innerHTML = '';

    try {
        const res = await fetch('/api/giveaway/active');
        const data = await res.json();
        if (!data.active) {
            infoDiv.innerHTML = '<p>No active giveaway at this time.</p>';
            tbody.innerHTML = '<tr><td colspan="6">No active giveaway</td></tr>';
            return;
        }
        const endTime = new Date(data.endTime);
        const now = new Date();
        const timeLeft = Math.max(0, endTime - now);
        const hours = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (3600000)) / 60000);
        const seconds = Math.floor((timeLeft % 60000) / 1000);
        infoDiv.innerHTML = `
            <strong>Prize:</strong> ${escapeHtml(data.prize)} &nbsp;|&nbsp;
            <strong>Winners:</strong> ${data.winnersCount} &nbsp;|&nbsp;
            <strong>Time left:</strong> ${hours}h ${minutes}m ${seconds}s &nbsp;|&nbsp;
            <strong>Entrants:</strong> ${data.entrants.length}
        `;
        currentGiveawayData = data.entrants;
        // Update timer every second
        if (window.giveawayTimer) clearInterval(window.giveawayTimer);
        window.giveawayTimer = setInterval(() => {
            const remaining = endTime - Date.now();
            if (remaining <= 0) {
                clearInterval(window.giveawayTimer);
                loadGiveawayData(); // refresh to show ended
                return;
            }
            const hrs = Math.floor(remaining / 3600000);
            const mins = Math.floor((remaining % 3600000) / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            infoDiv.innerHTML = infoDiv.innerHTML.replace(/Time left:.*?&nbsp;\|/, `Time left: ${hrs}h ${mins}m ${secs}s &nbsp;|`);
        }, 1000);
        renderGiveawayTable(currentGiveawayData);
    } catch (err) {
        console.error(err);
        infoDiv.innerHTML = '<p style="color:#f87171;">Error loading giveaway</p>';
        tbody.innerHTML = '<tr><td colspan="6">Error loading data</td></tr>';
        statusDiv.innerHTML = 'Error: ' + err.message;
    }
}

function renderGiveawayTable(entrants) {
    const tbody = document.getElementById('giveaway-table-body');
    if (!entrants.length) {
        tbody.innerHTML = '<tr><td colspan="6">No entrants yet.</td></tr>';
        return;
    }
    // Sort (same as before)
    let sorted = [...entrants];
    if (giveawaySortColumn) {
        sorted.sort((a,b) => {
            let aVal = a[giveawaySortColumn];
            let bVal = b[giveawaySortColumn];
            if (giveawaySortColumn === 'accountAge') {
                aVal = aVal ?? Infinity;
                bVal = bVal ?? Infinity;
                if (giveawaySortDirection === 'asc') return aVal - bVal;
                else return bVal - aVal;
            }
            aVal = String(aVal ?? '').toLowerCase();
            bVal = String(bVal ?? '').toLowerCase();
            if (giveawaySortDirection === 'asc') return aVal.localeCompare(bVal);
            else return bVal.localeCompare(aVal);
        });
    }
    tbody.innerHTML = sorted.map(e => {
        const voteDisplay = e.voted ? (e.voteCharacter || `Option ${e.voteOptionId || '?'}`) : 'None';
        // Determine row style: purple for supporter, gray for left server, normal otherwise
        let rowStyle = '';
        if (e.isSupporter) {
            rowStyle = 'style="background-color: #4a0e4e;"';
        } else if (e.leftServer) {
            rowStyle = 'style="background-color: #3a3a3a; opacity:0.7;"';
        }
        // For left server, show a disabled-looking button or keep it active (you can still remove them)
        const removeButton = e.leftServer
            ? `<button class="giveaway-remove" data-id="${e.userId}" style="background:#ef4444; padding:4px 12px; opacity:0.6;">✕ Remove (Left)</button>`
            : `<button class="giveaway-remove" data-id="${e.userId}" style="background:#ef4444; padding:4px 12px;">✕ Remove</button>`;
        return `<tr ${rowStyle}>
            <td style="padding:8px;">${escapeHtml(e.nickname)}</td>
            <td style="padding:8px;">${escapeHtml(e.username)}</td>
            <td style="padding:8px;">${escapeHtml(e.userId)}</td>
            <td style="padding:8px;">${e.accountAge !== null ? e.accountAge : '?'}</td>
            <td style="padding:8px;">${escapeHtml(voteDisplay)}</td>
            <td style="padding:8px;">${removeButton}</td>
        </td>`;
    }).join('');
    // Re-attach event listeners for remove buttons
    document.querySelectorAll('.giveaway-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const userId = btn.dataset.id;
            if (confirm(`Remove user ${userId} from giveaway? This will also delete their poll votes.`)) {
                await removeFromGiveaway(userId);
            }
        });
    });
}

function sortGiveawayTable(column) {
    if (giveawaySortColumn === column) {
        giveawaySortDirection = giveawaySortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        giveawaySortColumn = column;
        giveawaySortDirection = 'asc';
    }
    renderGiveawayTable(currentGiveawayData || []);
}

async function removeFromGiveaway(userId) {
    const statusDiv = document.getElementById('giveaway-status');
    try {
        const res = await fetch('/api/giveaway/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Remove failed');
        statusDiv.innerHTML = `<span style="color:#4ade80;">✅ ${data.message}</span>`;
        // Refresh data
        await loadGiveawayData();
        if (typeof showSnackbar === 'function') showSnackbar(data.message, false);
        else alert(data.message);
    } catch (err) {
        statusDiv.innerHTML = `<span style="color:#f87171;">❌ ${err.message}</span>`;
        if (typeof showSnackbar === 'function') showSnackbar(err.message, true);
        else alert(err.message);
    }
}

// When switching to giveaway tab, load data and set up timer
// Modify switchTab function to include giveaway
// In the existing switchTab function, add:
if (tabId === 'giveaway-mgmt') {
    loadGiveawayData();
}
