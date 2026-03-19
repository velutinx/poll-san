// megalink.js – with debug logs and recovery

function initMega() {
    console.log('initMega: setting up');
    const previewSelect = document.getElementById('supporterPostSelect');
    if (previewSelect) {
        previewSelect.addEventListener('change', generateFilenameFromPost);
        if (previewSelect.value) {
            generateFilenameFromPost();
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

    const post = window.globalForumPosts?.find(p => p.id === postId);
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

function getCurrentMonth() {
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const now = new Date();
    const month = months[now.getMonth()];
    const year = String(now.getFullYear()).slice(-2);
    return `${month}-${year}`;
}

async function uploadToMega() {
    console.log('uploadToMega called');
    const status = document.getElementById('mega-status');
    const btn = document.getElementById('mega-upload-btn');
    const filenameInput = document.getElementById('mega-filename');
    const progressBar = document.getElementById('mega-progress');

    // Try multiple sources for the file
    let fileToUpload = window.currentZipFile;

    if (!fileToUpload && typeof testSelectedFile !== 'undefined' && testSelectedFile) {
        console.log('Recovering file from testSelectedFile');
        fileToUpload = testSelectedFile;
        window.currentZipFile = fileToUpload;
    }

    if (!fileToUpload) {
        const fileInput = document.getElementById('test-file-input');
        if (fileInput && fileInput.files.length > 0) {
            console.log('Recovering file from file input element');
            fileToUpload = fileInput.files[0];
            window.currentZipFile = fileToUpload;
            testSelectedFile = fileToUpload;
        }
    }

    console.log('window.currentZipFile =', window.currentZipFile ? window.currentZipFile.name : null);
    console.log('testSelectedFile =', typeof testSelectedFile !== 'undefined' ? testSelectedFile?.name : 'undefined');

    if (!fileToUpload) {
        const previewContainer = document.getElementById('test-preview-container');
        if (previewContainer && previewContainer.children.length > 0) {
            console.error('File reference lost despite preview container having content');
            showToast('Error', 'File reference lost. Please drag the ZIP again.', 'error');
        } else {
            console.error('No file loaded at all');
            showToast('Error', 'No ZIP file loaded. Please drag a ZIP into the preview area first.', 'error');
        }
        return;
    }

    let finalFileName = filenameInput.value.trim();
    if (!finalFileName) {
        showToast('Error', 'Please enter a filename', 'error');
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
                showToast('Upload Complete', 'File uploaded to MEGA');
                status.innerText = '';
            } catch (e) {
                showToast('Error', 'Invalid server response', 'error');
                status.innerText = '';
            }
        } else {
            showToast('Error', `Upload failed: ${xhr.status}`, 'error');
            status.innerText = '';
        }
        btn.disabled = false;
        progressBar.style.display = 'none';
    };

    xhr.onerror = () => {
        showToast('Error', 'Network error', 'error');
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
