// web/public/js/monitoring.js

let currentMonitoringData = [];
let monitoringSortColumn = null;
let monitoringSortDirection = 'asc';
let monitoringRefreshTimeout = null;

// Helper (escapeHtml is already defined in index.html, but we redefine here to be safe)
function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function sortMonitoringData(column) {
    if (monitoringSortColumn === column) {
        monitoringSortDirection = monitoringSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        monitoringSortColumn = column;
        monitoringSortDirection = 'asc';
    }
    const sorted = [...currentMonitoringData].sort((a, b) => {
        let aVal = a[column];
        let bVal = b[column];
        
        if (aVal === null || aVal === undefined) {
            aVal = column === 'voteCharacter' ? '' : (column === 'accountAge' || column === 'daysSinceJoin' ? Infinity : '');
        }
        if (bVal === null || bVal === undefined) {
            bVal = column === 'voteCharacter' ? '' : (column === 'accountAge' || column === 'daysSinceJoin' ? Infinity : '');
        }
        
        if (column === 'accountAge' || column === 'daysSinceJoin') {
            aVal = aVal === Infinity ? 999999 : Number(aVal);
            bVal = bVal === Infinity ? 999999 : Number(bVal);
            if (monitoringSortDirection === 'asc') return aVal - bVal;
            else return bVal - aVal;
        }
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
        if (monitoringSortDirection === 'asc') return aVal.localeCompare(bVal);
        else return bVal.localeCompare(aVal);
    });
    renderMonitoringTable(sorted);
}

function renderMonitoringTable(data) {
    const tbody = document.getElementById('monitoring-table-body');
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">No members found</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(m => {
        let voteDisplay = 'None';
        if (m.voted) {
            if (m.voteCharacter) voteDisplay = escapeHtml(m.voteCharacter);
            else if (m.voteOptionId) voteDisplay = `Option ${m.voteOptionId}`;
            else voteDisplay = 'Yes (unknown)';
        }
        return `
            <tr data-user-id="${m.userId}">
                <td style="padding: 8px;"><input type="checkbox" class="monitor-user-checkbox" data-id="${m.userId}"></td>
                <td style="padding: 8px;">${escapeHtml(m.userId)}</td>
                <td style="padding: 8px;">${escapeHtml(m.username)}</td>
                <td style="padding: 8px;">${m.accountCreatedAt ? new Date(m.accountCreatedAt).toLocaleString() : 'Unknown'}</td>
                <td style="padding: 8px;">${m.accountAge !== null ? m.accountAge : '?'}</td>
                <td style="padding: 8px;">${m.joinedAt ? new Date(m.joinedAt).toLocaleString() : 'Unknown'}</td>
                <td style="padding: 8px;">${m.daysSinceJoin !== null ? m.daysSinceJoin : '?'}</td>
                <td style="padding: 8px;">${voteDisplay}</td>
                <td style="padding: 8px;"><button class="kick-single" data-id="${m.userId}" style="background:#ef4444; padding:4px 12px;">Kick</button></td>
             <\/tr>
        `;
    }).join('');
    
    document.querySelectorAll('.kick-single').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const userId = btn.dataset.id;
            kickMember(userId);
        });
    });
    
    const selectAll = document.getElementById('monitor-select-all');
    if (selectAll) {
        selectAll.onclick = (e) => {
            document.querySelectorAll('.monitor-user-checkbox').forEach(cb => cb.checked = e.target.checked);
        };
    }
}

async function loadMonitoringData() {
    const btn = document.querySelector('#monitoring button[onclick="loadMonitoringData()"]');
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;

    const days = document.getElementById('monitor-days').value;
    const tbody = document.getElementById('monitoring-table-body');
    const statusDiv = document.getElementById('monitoring-status');

    if (!tbody) {
        if (statusDiv) statusDiv.innerHTML = 'Table body missing';
        if (btn) btn.disabled = false;
        return;
    }

    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Loading members...</td></tr>';
    if (statusDiv) statusDiv.innerHTML = '';

    try {
        const res = await fetch(`/api/monitoring/members?days=${days}`);
        if (!res.ok) throw new Error('Failed to fetch');
        currentMonitoringData = await res.json();
        monitoringSortColumn = null;
        renderMonitoringTable(currentMonitoringData);
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#f87171;">Error loading data</td></tr>';
        if (statusDiv) statusDiv.innerHTML = 'Error: ' + err.message;
    } finally {
        if (monitoringRefreshTimeout) clearTimeout(monitoringRefreshTimeout);
        monitoringRefreshTimeout = setTimeout(() => {
            if (btn) btn.disabled = false;
        }, 10000);
    }
}

async function kickMember(userId) {
    const statusDiv = document.getElementById('monitoring-status');
    try {
        const res = await fetch('/api/monitoring/kick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Kick failed');
        statusDiv.innerHTML = `<span style="color:#4ade80;">✅ ${data.message}</span>`;
        const row = document.querySelector(`tr[data-user-id="${userId}"]`);
        if (row) row.remove();
        currentMonitoringData = currentMonitoringData.filter(m => m.userId !== userId);
        if (typeof showSnackbar === 'function') showSnackbar(data.message, false);
        else alert(data.message);
    } catch (err) {
        statusDiv.innerHTML = `<span style="color:#f87171;">❌ ${err.message}</span>`;
        if (typeof showSnackbar === 'function') showSnackbar(err.message, true);
        else alert(err.message);
    }
}

async function kickAllSelected() {
    const checkboxes = document.querySelectorAll('.monitor-user-checkbox:checked');
    const userIds = Array.from(checkboxes).map(cb => cb.dataset.id);
    if (userIds.length === 0) {
        alert('No members selected');
        return;
    }
    if (!confirm(`Are you sure you want to kick ${userIds.length} member(s)?`)) return;

    const statusDiv = document.getElementById('monitoring-status');
    let success = 0;
    let failed = 0;

    for (const userId of userIds) {
        try {
            const res = await fetch('/api/monitoring/kick', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });
            if (res.ok) {
                success++;
                const row = document.querySelector(`tr[data-user-id="${userId}"]`);
                if (row) row.remove();
                currentMonitoringData = currentMonitoringData.filter(m => m.userId !== userId);
            } else {
                failed++;
            }
        } catch {
            failed++;
        }
        await new Promise(r => setTimeout(r, 500));
    }
    statusDiv.innerHTML = `<span style="color:#4ade80;">✅ Kicked ${success} members, Failed ${failed}</span>`;
    if (typeof showSnackbar === 'function') showSnackbar(`Kicked ${success} members`, false);
}
