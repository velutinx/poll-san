// web/public/js/trivia.js
let triviaUploadedFiles = [];

async function initTrivia() {
    const dropZone = document.getElementById('trivia-drop-zone');
    const fileInput = document.getElementById('trivia-file-input');
    const previewContainer = document.getElementById('trivia-preview-container');
    const dropText = document.getElementById('trivia-drop-text');

    if (!dropZone) return;

    dropZone.onclick = () => fileInput?.click();

    dropZone.ondragover = (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--blue)';
    };

    dropZone.ondragleave = () => {
        dropZone.style.borderColor = '#475569';
    };

    dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#475569';
        handleTriviaFiles(e.dataTransfer.files);
    };

    fileInput.onchange = (e) => {
        if (e.target.files.length) {
            handleTriviaFiles(e.target.files);
            fileInput.value = '';
        }
    };

    // Load channels and set default to test channel
    await loadChannels('trivia-channel');
    const channelSelect = document.getElementById('trivia-channel');
    if (channelSelect) {
        channelSelect.value = '1521826626034340021';
    }

    loadTriviaGames();
    loadTriviaWinners();

    document.getElementById('trivia-launch-btn').onclick = launchTrivia;
}

function handleTriviaFiles(files) {
    const previewContainer = document.getElementById('trivia-preview-container');
    const dropText = document.getElementById('trivia-drop-text');

    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        triviaUploadedFiles = [file];

        const reader = new FileReader();
        reader.onload = (e) => {
            previewContainer.innerHTML = '';
            const img = document.createElement('img');
            img.src = e.target.result;
            img.style.width = '100%';
            img.style.maxHeight = '300px';
            img.style.objectFit = 'contain';
            img.style.borderRadius = '8px';
            img.style.border = '2px solid #475569';
            previewContainer.appendChild(img);
            dropText.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }
}

async function launchTrivia() {
    const answer = document.getElementById('trivia-answer').value.trim();
    const series = document.getElementById('trivia-series').value.trim();
    const hint = document.getElementById('trivia-hint').value.trim() || null;
    const interval = parseFloat(document.getElementById('trivia-interval').value);
    const channelId = document.getElementById('trivia-channel').value;

    if (!answer) {
        showToast('Error', 'Character name is required', 'error');
        return;
    }
    if (!series) {
        showToast('Error', 'Series name is required', 'error');
        return;
    }
    if (triviaUploadedFiles.length === 0) {
        showToast('Error', 'Please upload an image', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('answer', answer);
    formData.append('series', series);
    formData.append('hint', hint);
    formData.append('interval', interval);
    formData.append('channelId', channelId);
    formData.append('image', triviaUploadedFiles[0]);

    const status = document.getElementById('trivia-status');
    status.textContent = '⏳ Creating trivia game...';
    status.style.color = '#94a3b8';

    try {
        const res = await fetch('/api/trivia/create', {
            method: 'POST',
            body: formData,
        });
        const data = await res.json();

        if (res.ok) {
            showToast('Success', 'Trivia game created!', 'success');
            status.textContent = '✅ Trivia game launched!';
            status.style.color = '#4ade80';
            // Reset form
            document.getElementById('trivia-answer').value = '';
            document.getElementById('trivia-series').value = '';
            document.getElementById('trivia-hint').value = '';
            document.getElementById('trivia-preview-container').innerHTML = '';
            document.getElementById('trivia-drop-text').style.display = 'block';
            triviaUploadedFiles = [];
            loadTriviaGames();
        } else {
            showToast('Error', data.error || 'Failed to create trivia', 'error');
            status.textContent = '❌ ' + (data.error || 'Failed');
            status.style.color = '#f87171';
        }
    } catch (err) {
        console.error(err);
        showToast('Error', err.message, 'error');
        status.textContent = '❌ ' + err.message;
        status.style.color = '#f87171';
    }
}

async function loadTriviaGames() {
    const container = document.getElementById('trivia-active-list');
    try {
        const res = await fetch('/api/trivia/active');
        const data = await res.json();
        if (!data.games || data.games.length === 0) {
            container.innerHTML = '<p style="color:#94a3b8;">No active trivia games.</p>';
            return;
        }
        let html = '';
        for (const game of data.games) {
            const revealed = game.revealed_count || 1;
            const total = game.total_sections || 12;
            const progress = Math.round((revealed / total) * 100);
            const statusText = game.status === 'completed' ? '✅ Completed' : '🔄 Active';
            const nextReveal = game.next_reveal_at ? new Date(game.next_reveal_at).toLocaleString() : 'N/A';
            html += `
                <div style="background:#1e293b; border-radius:8px; padding:12px; margin-bottom:10px; border-left:4px solid ${game.status === 'completed' ? '#4ade80' : '#f59e0b'};">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong>${game.answer}</strong>
                        <span style="font-size:0.8rem; color:${game.status === 'completed' ? '#4ade80' : '#f59e0b'};">${statusText}</span>
                    </div>
                    <div style="font-size:0.85rem; color:#94a3b8; margin-top:4px;">
                        Series: ${game.series} • ${revealed}/${total} revealed (${progress}%)
                        ${game.status === 'active' ? `• Next: ${nextReveal}` : ''}
                    </div>
                    ${game.status === 'active' ? `
                        <div style="margin-top:8px; display:flex; gap:8px;">
                            <button onclick="revealNextSection(${game.id})" style="background:#3b82f6; border:none; color:white; padding:4px 12px; border-radius:4px; cursor:pointer;">⬆ Reveal Next</button>
                            <button onclick="endTriviaGame(${game.id})" style="background:#ef4444; border:none; color:white; padding:4px 12px; border-radius:4px; cursor:pointer;">⏹ End Game</button>
                        </div>
                    ` : ''}
                </div>
            `;
        }
        container.innerHTML = html;
    } catch (err) {
        console.error(err);
        container.innerHTML = '<p style="color:#f87171;">Failed to load active games.</p>';
    }
}

async function loadTriviaWinners() {
    const container = document.getElementById('trivia-winners-list');
    try {
        const res = await fetch('/api/trivia/winners');
        const data = await res.json();
        if (!data.winners || data.winners.length === 0) {
            container.innerHTML = '<p style="color:#94a3b8;">No winners yet.</p>';
            return;
        }
        let html = '<table style="width:100%; border-collapse:collapse;">';
        html += '<thead><tr style="border-bottom:1px solid #334155;"><th style="text-align:left; padding:4px 8px;">User</th><th style="text-align:left; padding:4px 8px;">Character</th><th style="text-align:left; padding:4px 8px;">Date</th></tr></thead><tbody>';
        for (const w of data.winners) {
            html += `<tr style="border-bottom:1px solid #1e293b;">
                <td style="padding:4px 8px;">${w.username}</td>
                <td style="padding:4px 8px;">${w.answer}</td>
                <td style="padding:4px 8px; font-size:0.8rem; color:#94a3b8;">${new Date(w.guessed_at).toLocaleDateString()}</td>
            </tr>`;
        }
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (err) {
        console.error(err);
        container.innerHTML = '<p style="color:#f87171;">Failed to load winners.</p>';
    }
}

async function revealNextSection(gameId) {
    try {
        const res = await fetch('/api/trivia/reveal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Success', 'Section revealed!', 'success');
            loadTriviaGames();
        } else {
            showToast('Error', data.error || 'Failed to reveal', 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Error', err.message, 'error');
    }
}

async function endTriviaGame(gameId) {
    if (!confirm('End this trivia game?')) return;
    try {
        const res = await fetch('/api/trivia/end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Success', 'Game ended!', 'success');
            loadTriviaGames();
        } else {
            showToast('Error', data.error || 'Failed to end game', 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Error', err.message, 'error');
    }
}

window.initTrivia = initTrivia;
window.loadTriviaGames = loadTriviaGames;
window.loadTriviaWinners = loadTriviaWinners;
window.revealNextSection = revealNextSection;
window.endTriviaGame = endTriviaGame;
