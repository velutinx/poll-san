// web/public/js/giveaway.js

let currentGiveawayData = null;
let giveawaySortColumn = null;
let giveawaySortDirection = 'asc';
let giveawayRefreshTimeout = null;

// ─── Load blacklist ──────────────────────────────────────────────
async function loadBlacklist() {
    const container = document.getElementById('blacklist-list');
    if (!container) return;
    try {
        const res = await fetch('/api/giveaway/blacklist');
        const data = await res.json();
        if (!data.length) {
            container.innerHTML = '<p style="color:#94a3b8;">No users blacklisted.</p>';
            return;
        }
        container.innerHTML = data.map(user => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #2a2f38;">
                <span>${escapeHtml(user.discord_tag)} (${escapeHtml(user.user_id)})<br><small style="color:#64748b;">Added: ${new Date(user.added_at).toLocaleString()}</small></span>
                <button class="blacklist-remove" data-id="${user.user_id}" style="background:#ef4444; padding:4px 12px; border-radius:4px; border:none; color:white; cursor:pointer;">Remove</button>
            </div>
        `).join('');
        document.querySelectorAll('.blacklist-remove').forEach(btn => {
            btn.addEventListener('click', async () => {
                const userId = btn.dataset.id;
                await removeFromBlacklist(userId);
                loadBlacklist(); // refresh
                loadGiveawayData(); // refresh entrants to update flags
            });
        });
    } catch (err) {
        console.error(err);
        container.innerHTML = '<p style="color:#f87171;">Error loading blacklist</p>';
    }
}

// ─── Add to blacklist ────────────────────────────────────────────
async function addToBlacklist(userId, discordTag) {
    try {
        const res = await fetch('/api/giveaway/blacklist/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, discordTag })
        });
        if (!res.ok) throw new Error('Failed');
        loadBlacklist();
        loadGiveawayData(); // refresh entrants
        if (typeof showSnackbar === 'function') showSnackbar('User added to blacklist', false);
        else alert('User added to blacklist');
    } catch (err) {
        if (typeof showSnackbar === 'function') showSnackbar(err.message, true);
        else alert(err.message);
    }
}

// ─── Remove from blacklist ───────────────────────────────────────
async function removeFromBlacklist(userId) {
    try {
        const res = await fetch('/api/giveaway/blacklist/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!res.ok) throw new Error('Failed');
        loadBlacklist();
        loadGiveawayData(); // refresh entrants
        if (typeof showSnackbar === 'function') showSnackbar('User removed from blacklist', false);
        else alert('User removed from blacklist');
    } catch (err) {
        if (typeof showSnackbar === 'function') showSnackbar(err.message, true);
        else alert(err.message);
    }
}

// ─── Main load function ──────────────────────────────────────────
async function loadGiveawayData() {
    const infoDiv = document.getElementById('giveaway-info');
    const tbody = document.getElementById('giveaway-table-body');
    const statusDiv = document.getElementById('giveaway-status');
    tbody.innerHTML = '<tr><td colspan="6">Loading...<\/td><\/tr>';
    statusDiv.innerHTML = '';

    try {
        const res = await fetch('/api/giveaway/active');
        const data = await res.json();
        if (!data.active) {
            infoDiv.innerHTML = '<p>No active giveaway at this time.</p>';
            tbody.innerHTML = '<tr><td colspan="6">No active giveaway<\/td><\/tr>';
            return;
        }
        const endTime = new Date(data.endTime);
        const now = new Date();
        const timeLeft = Math.max(0, endTime - now);
        const hours = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (3600000)) / 60000);
        const seconds = Math.floor((timeLeft % 60000) / 1000);
        const day = endTime.getDate();
        const month = endTime.toLocaleString(undefined, { month: 'long' });
        const timeStr = endTime.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
        const endingStr = `${day} of ${month} at ${timeStr}`;

        infoDiv.innerHTML = `
            <strong>Prize:</strong> ${escapeHtml(data.prize)} &nbsp;|&nbsp;
            <strong>Winners:</strong> ${data.winnersCount} &nbsp;|&nbsp;
            <strong>Time left:</strong> ${hours}h ${minutes}m ${seconds}s &nbsp;|&nbsp;
            <strong>Entrants:</strong> ${data.entrants.length} &nbsp;|&nbsp;
            <strong>Ending at:</strong> ${endingStr}
            <div style="margin-top: 12px;">
                <label style="font-size:0.9rem;">Adjust time (hours): </label>
                <input type="number" id="adjust-hours" step="1" value="0" style="width:80px; background:#1e293b; border:1px solid #475569; color:white; border-radius:4px; padding:4px;">
                <button onclick="adjustGiveawayTime()" style="background:#10b981; padding:4px 12px;">Apply</button>
            </div>
        `;
        currentGiveawayData = data.entrants;
        if (window.giveawayTimer) clearInterval(window.giveawayTimer);
        window.giveawayTimer = setInterval(() => {
            const remaining = endTime - Date.now();
            if (remaining <= 0) {
                clearInterval(window.giveawayTimer);
                loadGiveawayData();
                return;
            }
            loadGiveawayData();
        }, 60000);
        renderGiveawayTable(currentGiveawayData);
    } catch (err) {
        console.error(err);
        infoDiv.innerHTML = '<p style="color:#f87171;">Error loading giveaway</p>';
        tbody.innerHTML = '<tr><td colspan="6">Error loading data<\/td><\/tr>';
        statusDiv.innerHTML = 'Error: ' + err.message;
    }
}

// ─── Render table ────────────────────────────────────────────────
function renderGiveawayTable(entrants) {
    const tbody = document.getElementById('giveaway-table-body');
    if (!tbody) return;
    if (!entrants.length) {
        tbody.innerHTML = '<tr><td colspan="6">No entrants yet.<\/td><\/tr>';
        return;
    }
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
        let rowStyle = '';
        if (e.isSupporter) {
            rowStyle = 'style="background-color: #4a0e4e;"';
        } else if (e.leftServer) {
            rowStyle = 'style="background-color: #3a3a3a; opacity:0.7;"';
        }
        const removeButton = e.leftServer
            ? `<button class="giveaway-remove" data-id="${e.userId}" style="background:#ef4444; padding:4px 12px; opacity:0.6;">✕ Remove (Left)</button>`
            : `<button class="giveaway-remove" data-id="${e.userId}" style="background:#ef4444; padding:4px 12px;">✕ Remove</button>`;

        // ─── Blacklist button ──────────────────────────────────────────
        let blacklistButton = '';
        if (!e.isBlacklisted && !e.leftServer) {
            blacklistButton = `<button class="giveaway-blacklist" data-id="${e.userId}" data-tag="${e.username}" style="background:#f59e0b; padding:4px 12px; border-radius:4px; border:none; color:white; cursor:pointer;">🚫 Blacklist</button>`;
        } else if (e.isBlacklisted) {
            blacklistButton = `<span style="color:#f87171;">🚫 Blacklisted</span>`;
        }

        return `<tr ${rowStyle}>
            <td style="padding:8px;">${escapeHtml(e.username)}<\/td>
            <td style="padding:8px;">${escapeHtml(e.userId)}<\/td>
            <td style="padding:8px;">${e.accountAge !== null ? e.accountAge : '?'}<\/td>
            <td style="padding:8px;">${escapeHtml(voteDisplay)}<\/td>
            <td style="padding:8px;">${removeButton} ${blacklistButton}<\/td>
         <\/tr>`;
    }).join('');

    // ─── Event listeners ─────────────────────────────────────────────
    document.querySelectorAll('.giveaway-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const userId = btn.dataset.id;
            await removeFromGiveaway(userId);
        });
    });
    document.querySelectorAll('.giveaway-blacklist').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const userId = btn.dataset.id;
            const discordTag = btn.dataset.tag;
            await addToBlacklist(userId, discordTag);
        });
    });
}

// ─── Sort ─────────────────────────────────────────────────────────
function sortGiveawayTable(column) {
    if (giveawaySortColumn === column) {
        giveawaySortDirection = giveawaySortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        giveawaySortColumn = column;
        giveawaySortDirection = 'asc';
    }
    renderGiveawayTable(currentGiveawayData || []);
}

// ─── Remove from giveaway ─────────────────────────────────────────
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
        await loadGiveawayData();
        if (typeof showSnackbar === 'function') showSnackbar(data.message, false);
        else alert(data.message);
    } catch (err) {
        statusDiv.innerHTML = `<span style="color:#f87171;">❌ ${err.message}</span>`;
        if (typeof showSnackbar === 'function') showSnackbar(err.message, true);
        else alert(err.message);
    }
}

// ─── Adjust time ──────────────────────────────────────────────────
async function adjustGiveawayTime() {
    const hoursInput = document.getElementById('adjust-hours');
    let hours = parseInt(hoursInput.value, 10);
    if (isNaN(hours)) hours = 0;

    const statusDiv = document.getElementById('giveaway-status');
    statusDiv.innerHTML = 'Updating...';
    try {
        const res = await fetch('/api/giveaway/adjust-time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hours })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Adjustment failed');
        statusDiv.innerHTML = `<span style="color:#4ade80;">✅ Giveaway end time updated by ${hours} hour(s).</span>`;
        loadGiveawayData();
    } catch (err) {
        statusDiv.innerHTML = `<span style="color:#f87171;">❌ ${err.message}</span>`;
        console.error(err);
    }
}

// ─── Helper ──────────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ─── Expose global functions ────────────────────────────────────
window.loadGiveawayData = loadGiveawayData;
window.loadBlacklist = loadBlacklist;
window.sortGiveawayTable = sortGiveawayTable;
window.removeFromGiveaway = removeFromGiveaway;
window.adjustGiveawayTime = adjustGiveawayTime;
window.addToBlacklist = addToBlacklist;
window.removeFromBlacklist = removeFromBlacklist;

// ─── Auto‑load on tab click ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    // Load blacklist immediately, and when the giveaway tab is shown
    loadBlacklist();
    // Also reload when switching to giveaway tab (handled in index.html's switchTab)
});
