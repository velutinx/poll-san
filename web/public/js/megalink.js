// this is poll-san/web/public/js/megalink.js

function initMega() {
    const previewSelect = document.getElementById('supporterPostSelect');
    if (previewSelect) {
        previewSelect.addEventListener('change', generateFilenameFromPost);
        if (previewSelect.value) {
            setTimeout(generateFilenameFromPost, 500);
        }
    }
 //   console.log('Mega module initialized');
}

function generateFilenameFromPost() {
    const select = document.getElementById('supporterPostSelect');
    if (!select) return;

    const postId = select.value;
    if (!postId) {
        document.getElementById('mega-filename').value = '';
        return;
    }

    const posts = window.globalForumPosts;
    if (!posts || posts.length === 0) {
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
        console.log(`Generated filename: ${filename}`);
    } else {
        document.getElementById('mega-filename').value = title + '.zip';
        console.log(`Fallback filename: ${title}.zip`);
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
        console.error('No ZIP file loaded');
        return;
    }

    let finalFileName = filenameInput.value.trim();
    if (!finalFileName) {
        if (typeof showToast === 'function') showToast('Error', 'Please enter a filename', 'error');
        console.error('No filename provided');
        return;
    }

    const currentMonth = getCurrentMonth();
    console.log(`Uploading file: ${finalFileName}, month folder: ${currentMonth}`);

    btn.disabled = true;
    status.innerText = '⏳ Uploading...';
    progressBar.style.display = 'block';
    progressBar.value = 0;

    const formData = new FormData();
    const renamedFile = new File([fileToUpload], finalFileName, { type: fileToUpload.type });
    formData.append('file', renamedFile);
    formData.append('month', currentMonth);
    formData.append('downloadAfterUpload', 'true'); // Always request local download

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload-to-mega', true);

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            progressBar.value = (e.loaded / e.total) * 100;
            console.log(`Upload progress: ${Math.round(progressBar.value)}%`);
        }
    };

xhr.onload = () => {
    if (xhr.status === 200) {
        try {
            const data = JSON.parse(xhr.responseText);
            document.getElementById('supDownload').value = data.link || '';
            
            // Trigger download of the local copy
            if (data.localPath) {
                // Extract just the filename from the path
                const filename = data.localPath.split('/').pop();
                // Use the download endpoint
                const downloadUrl = `/api/download-file?filename=${encodeURIComponent(filename)}`;
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = filename; // optional, but helps
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                console.log(`Download triggered: ${downloadUrl}`);
            }
            
            if (typeof showToast === 'function') showToast('Upload Complete', 'File uploaded to MEGA');
            status.innerText = '';
        } catch (e) {
                console.error('Error parsing response:', e);
                if (typeof showToast === 'function') showToast('Error', 'Invalid server response', 'error');
                status.innerText = '';
            }
        } else {
            console.error(`Upload failed with status ${xhr.status}: ${xhr.responseText}`);
            if (typeof showToast === 'function') showToast('Error', `Upload failed: ${xhr.status}`, 'error');
            status.innerText = '';
        }
        btn.disabled = false;
        progressBar.style.display = 'none';
    };

    xhr.onerror = () => {
        console.error('Network error during upload');
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
