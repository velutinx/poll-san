// public/js/greetings.js – handles welcome channel and message settings

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
            if (welcomeTextarea) welcomeTextarea.value = s.welcome_message;
        }
    } catch(e) {
        console.error('Error loading settings:', e);
        const statusDiv = document.getElementById('greetings-status');
        if (statusDiv) statusDiv.innerText = '❌ Error loading settings.';
    }
}

async function saveGreetings() {
    const channel = document.getElementById('welcome_channel_id').value;
    const message = document.getElementById('welcome_message').value;
    const res = await fetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ welcome_channel_id: channel, welcome_message: message })
    });
    if (res.ok) {
        if (typeof showToast === 'function') showToast('Success!', 'Settings applied');
        await loadSettings(); // refresh the displayed values
    } else {
        if (typeof showToast === 'function') showToast('Error!', 'Failed to save', 'error');
    }
}

// Make functions globally available
window.loadSettings = loadSettings;
window.saveGreetings = saveGreetings;
