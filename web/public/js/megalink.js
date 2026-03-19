// megalink.js – with recovery and manual reload trigger

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

    // Try to get the file from multiple sources
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

    if (!fileToUpload) {
        // No file found – ask user to select one now
        console.warn('No file found, prompting user to select a ZIP');
        showToast('Info', 'Please select a ZIP file to upload', 'info');
        // Trigger the file picker
        const fileInput = document.getElementById('test-file-input');
        if (fileInput) {
            fileInput.once = true; // hack to run upload after selection
            fileInput.click();
            // Wait for file selection and then retry upload
            fileInput.addEventListener('change', function onFileChange(e) {
                if (e.target.files.length > 0) {
                    fileInput.removeEventListener('change', onFileChange);
                    // Manually set the file and trigger upload again
                    handleTestFile(e.target.files[0]);
                    uploadTestZip().then(() => {
                        // Now that the file is loaded, call uploadToMega again
                        uploadToMega();
                    });
                }
            }, { once: true });
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
