// megalink.js

function initMega() {
    // Watch for changes on the existing preview dropdown (supporterPostSelect)
    const previewSelect = document.getElementById('supporterPostSelect');
    if (previewSelect) {
        previewSelect.addEventListener('change', generateFilenameFromPost);
        if (previewSelect.value) {
            generateFilenameFromPost();
        }
    }
}

// Generate filename from selected preview post (using supporterPostSelect)
function generateFilenameFromPost() {
    const select = document.getElementById('supporterPostSelect');
    if (!select) return;

    const postId = select.value;
    if (!postId) {
        document.getElementById('mega-filename').value = '';
        return;
    }

    const post = globalForumPosts.find(p => p.id === postId);
    if (!post) return;

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

// Helper to get current month in uppercase MMM-YY format
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

    // Use the global zip file from uploading.js
    const fileToUpload = window.currentZipFile;
    if (!fileToUpload) {
        status.innerText = '❌ No ZIP file loaded in ZIP Preview.';
        return;
    }

    let finalFileName = filenameInput.value.trim();
    if (!finalFileName) {
        status.innerText = '❌ No filename. Select a preview post first.';
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
        if (e.lengthComputable) {
            progressBar.value = (e.loaded / e.total) * 100;
        }
    };

    xhr.onload = () => {
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                document.getElementById('supDownload').value = data.link || '';
                // Also set the Set Size field if we have the total count
                if (window.totalImagesCount) {
                    document.getElementById('supSize').value = window.totalImagesCount;
                }
                status.innerText = '✅ Uploaded!';
            } catch (e) {
                status.innerText = '❌ Invalid server response.';
            }
        } else {
            status.innerText = `❌ Upload failed: ${xhr.responseText}`;
        }
        btn.disabled = false;
        progressBar.style.display = 'none';
    };

    xhr.onerror = () => {
        status.innerText = '❌ Network error.';
        btn.disabled = false;
        progressBar.style.display = 'none';
    };

    xhr.send(formData);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMega);
} else {
    initMega();
}