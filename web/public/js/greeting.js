// web/public/js/greeting.js

// Convert stored format (with {random: ... ~ ... }) into an array of lines for display
function formatForDisplay(storedMessage) {
    if (!storedMessage) return '';
    // Match content inside {random: ... }
    const match = storedMessage.match(/\{random:\s*([\s\S]*?)\s*\}$/);
    if (!match) return storedMessage; // fallback
    let content = match[1];
    // Split by ~ (the separator) and trim each line
    const lines = content.split('~').map(line => line.trim()).filter(line => line.length > 0);
    return lines.join('\n');
}

// Convert user-friendly lines back to the stored format
function formatForStorage(linesText) {
    if (!linesText.trim()) return '';
    const lines = linesText.split('\n').filter(line => line.trim().length > 0);
    if (lines.length === 0) return '';
    const joined = lines.join('\n~\n');
    return `{random:\n${joined}\n}`;
}

// Load settings from server and display in textarea (one per line)
async function loadSettings() {
    try {
        const res = await fetch('/api/get-settings');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const s = await res.json();
        if (s.welcome_channel_id) {
            const welcomeSelect = document.getElementById('welcome_channel_id');
            if (welcomeSelect) welcomeSelect.value = s.welcome_channel_id;
        }
        if (s.welcome_message) {
            const welcomeTextarea = document.getElementById('welcome_message');
            if (welcomeTextarea) {
                // Convert stored format to simple lines for editing
                welcomeTextarea.value = formatForDisplay(s.welcome_message);
            }
        }
    } catch(e) {
        console.error('Error loading settings:', e);
        const statusDiv = document.getElementById('greetings-status');
        if (statusDiv) statusDiv.innerText = '❌ Error loading settings.';
    }
}

// Save settings – convert lines to stored format before sending
async function saveGreetings() {
    const channel = document.getElementById('welcome_channel_id').value;
    const rawLines = document.getElementById('welcome_message').value;
    const storedMessage = formatForStorage(rawLines);
    const res = await fetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ welcome_channel_id: channel, welcome_message: storedMessage })
    });
    if (res.ok) {
        if (typeof showToast === 'function') showToast('Success!', 'Settings applied');
        await loadSettings(); // refresh display
    } else {
        if (typeof showToast === 'function') showToast('Error!', 'Failed to save', 'error');
    }
}

// Make functions globally available
window.loadSettings = loadSettings;
window.saveGreetings = saveGreetings;
