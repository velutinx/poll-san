// web/public/js/membership.js

const MEMBERSHIP_MAP = {
    "1": { name: "🥉 Bronze", color: "#cd7f32" },
    "2": { name: "✨ Copper", color: "#b87333" },
    "3": { name: "🥈 Silver", color: "#c0c0c0" },
    "4": { name: "🥇 Gold", color: "#ffd700" },
    "5": { name: "✨ Platinum", color: "#e5e4e2" }
};

let currentSort = { column: null, direction: 'asc' };
let membersData = [];

function sortMembers(col) {
    if (currentSort.column === col) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = col;
        currentSort.direction = 'asc';
    }
    renderMembersTable();
}

function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function renderMembersTable() {
    const tb = document.getElementById('membership-list-body');
    if (!tb) return;
    if (!membersData.length) {
        tb.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">No active subscribers found.</td></tr>';
        return;
    }

    const sorted = [...membersData].sort((a,b) => {
        let va = a[currentSort.column], vb = b[currentSort.column];
        if (['daysLeft','userId'].includes(currentSort.column)) {
            va = Number(va); vb = Number(vb);
        } else {
            va = String(va).toLowerCase();
            vb = String(vb).toLowerCase();
        }
        if (va < vb) return currentSort.direction === 'asc' ? -1 : 1;
        if (va > vb) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });

    document.querySelectorAll('thead th span').forEach(s => s.innerHTML = '');
    if (currentSort.column) {
        const arrow = currentSort.direction === 'asc' ? ' ▲' : ' ▼';
        const span = document.getElementById(`sort-${currentSort.column}`);
        if (span) span.innerHTML = arrow;
    }

    tb.innerHTML = sorted.map(m => {
        const r = MEMBERSHIP_MAP[m.rank] || { name: m.rank || 'Standard', color: '#94a3b8' };
        const days = m.daysLeft;
        const recurringIcon = m.recurring ? `<span style="display:inline-block; margin-left:8px; vertical-align:middle;" title="Recurring subscription">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #10b981;">
                <path d="M17 1L21 5L17 9"/>
                <path d="M21 5H9C6.79086 5 5 6.79086 5 9"/>
                <path d="M7 23L3 19L7 15"/>
                <path d="M3 19H15C17.2091 19 19 17.2091 19 15"/>
            </svg>
        </span>` : '';
        return `<tr style="border-bottom:1px solid #1e293b;">
            <td style="padding:12px;">${escapeHtml(m.nickname||'Unknown')}</td>
            <td style="padding:12px; color:#94a3b8;">${escapeHtml(m.discordTag||'Unknown')}</td>
            <td style="padding:12px; color:#94a3b8; font-family:monospace;">${escapeHtml(m.userId||'')}</td>
            <td style="padding:12px; color:${r.color}; font-weight:bold;">${escapeHtml(r.name)}</td>
            <td style="padding:12px; color:${days<5?'#f87171':'#10b981'};">
                ${days} Days${recurringIcon}
            </td>
        </tr>`;
    }).join('');
}

async function loadMembershipData() {
    const tb = document.getElementById('membership-list-body');
    if (tb) tb.innerHTML = '<tr><td colspan="5" style="padding:30px; text-align:center; color:#64748b;">Loading membership data...</td></tr>';
    try {
        const r = await fetch('/api/memberships');
        if (!r.ok) throw new Error('Failed');
        membersData = await r.json();
        renderMembersTable();
    } catch (e) {
        console.error(e);
        if (tb) tb.innerHTML = '<tr><td colspan="5" style="padding:30px; text-align:center; color:#f87171;">Error loading data.</td></tr>';
    }
}

// Make functions globally available
window.sortMembers = sortMembers;
window.loadMembershipData = loadMembershipData;
