// megalink.js – fixed filename generation, waits for posts

function initMega() {
    const previewSelect = document.getElementById('supporterPostSelect');
    if (previewSelect) {
        // Generate when selection changes
        previewSelect.addEventListener('change', generateFilenameFromPost);
        // Also try to generate now if a post is already selected
        if (previewSelect.value) {
            // But posts may not be loaded yet – wait a bit
            setTimeout(generateFilenameFromPost, 500);
        }
    }
}

function generateFilenameFromPost() {
    const select = document.getElementById('supporterPostSelect');
    if (!select) return;

    const postId = select.value;
    if (!postId) {
        document.getElementById('mega-filename').value = '';
        return;
    }

    // Try to get posts from window.globalForumPosts (set by releases.js)
    const posts = window.globalForumPosts;
    if (!posts || posts.length === 0) {
        // Posts not loaded yet, retry after a short delay
        console.log('Posts not ready, retrying...');
        setTimeout(generateFilenameFromPost, 300);
        return;
    }

    const post = posts.find(p => p.id === postId);
    if (!post) {
        document.getElementById('mega-filename').value = '';
        return;
    }

    const title = post.name;
    const regex = /\[(.*?)\] (.*?) — (?:Pack #)?(\d+)/i;
    const match = title.match(regex);
    if (match) {
        const series = match[1].trim().toUpperCase();
        const name = match[2].replace(/♀️|♂️|:female_sign:|:male_sign:/g, '').trim();
        const pack = match[3];
        const filename = `[Pack ${pack}] ${name} - ${series}.zip`;
        document.getElementById('mega-filename').value = filename;
    } else {
        document.getElementById('mega-filename').value = title + '.zip';
    }
}

function getCurrentMonth() {
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const now = new Date();
    const month = months[now.getMonth()];
    const year = String(now.getFullYear()).slice(-2);
    return `${month}-${year}`;
}

async function uploadToMega() {
    const status = document.getElementById('mega-status');
    const btn = document.getElementById('mega-upload-btn');
    const filenameInput = document.getElementById('mega-filename');
    const progressBar = document.getElementById('mega-progress');

    let fileToUpload = window.currentZipFile;

    if (!fileToUpload) {
        if (typeof showToast === 'function') showToast('Error', 'Please load a ZIP file in the preview area first.', 'error');
        return;
    }

    let finalFileName = filenameInput.value.trim();
    if (!finalFileName) {
        if (typeof showToast === 'function') showToast('Error', 'Please enter a filename', 'error');
        return;
    }

    const currentMonth = getCurrentMonth();

    btn.disabled = true;
    status.innerText = '⏳ Uploading...';
    progressBar.style.display = 'block';
    progressBar.value = 0;

    const formData = new FormData();
    const renamedFile = new File([fileToUpload], finalFileName, { type: fileToUpload.type });
    formData.append('file', renamedFile);
    formData.append('month', currentMonth);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload-to-mega', true);

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) progressBar.value = (e.loaded / e.total) * 100;
    };

    xhr.onload = () => {
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                document.getElementById('supDownload').value = data.link || '';
                if (typeof showToast === 'function') showToast('Upload Complete', 'File uploaded to MEGA');
                status.innerText = '';
            } catch (e) {
                if (typeof showToast === 'function') showToast('Error', 'Invalid server response', 'error');
                status.innerText = '';
            }
        } else {
            if (typeof showToast === 'function') showToast('Error', `Upload failed: ${xhr.status}`, 'error');
            status.innerText = '';
        }
        btn.disabled = false;
        progressBar.style.display = 'none';
    };

    xhr.onerror = () => {
        if (typeof showToast === 'function') showToast('Error', 'Network error', 'error');
        btn.disabled = false;
        progressBar.style.display = 'none';
        status.innerText = '';
    };

    xhr.send(formData);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMega);
} else {
    initMega();
}
