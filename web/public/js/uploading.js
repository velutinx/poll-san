// uploading.js – final with fixed click delegation

let testSelectedFile = null;
let currentImages = [];
let selectedIndices = new Set();
let supporterUploadedFiles = [];
let isUploading = false;

window.currentZipFile = null;
window.totalImagesCount = 0;
window.supporterUploadedFiles = supporterUploadedFiles;

window.reloadZip = function() {
    document.getElementById('test-file-input')?.click();
};

function initUploadTest() {
    const dropZone = document.getElementById('test-drop-zone');
    const fileInput = document.getElementById('test-file-input');
    const dropText = document.getElementById('test-drop-text');
    const previewContainer = document.getElementById('test-preview-container');

    if (!dropZone) return;

    dropZone.addEventListener('click', () => fileInput?.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--blue)';
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = '#475569';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#475569';
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleTestFile(files[0]);
            uploadTestZip();
        }
    });

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleTestFile(e.target.files[0]);
                uploadTestZip();
            }
        });
    }

    // Event delegation for image grid clicks – one listener for all current and future images
    const imageGrid = document.getElementById('test-image-grid');
    if (imageGrid) {
        // Remove any existing listener to avoid duplicates
        imageGrid.removeEventListener('click', handleGridClick);
        imageGrid.addEventListener('click', handleGridClick);
    }
}

// Separate handler function for clarity
function handleGridClick(e) {
    const container = e.target.closest('div[data-index]');
    if (container) {
        const index = parseInt(container.dataset.index);
        if (!isNaN(index)) {
            console.log('Grid image clicked, index:', index); // temporary – remove after testing
            toggleSelectImage(index);
        }
    }
}

function handleTestFile(file) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
        alert('Please select a ZIP file.');
        return;
    }
    testSelectedFile = file;
    window.currentZipFile = file;

    const previewContainer = document.getElementById('test-preview-container');
    const dropText = document.getElementById('test-drop-text');
    previewContainer.innerHTML = '';
    const span = document.createElement('span');
    span.style.color = '#e2e8f0';
    span.textContent = `📦 ${file.name}`;
    previewContainer.appendChild(span);
    dropText.style.display = 'none';
}

async function uploadTestZip() {
    if (isUploading) return;
    isUploading = true;

    const imageGrid = document.getElementById('test-image-grid');
    if (!testSelectedFile) {
        isUploading = false;
        return;
    }
    imageGrid.innerHTML = '';
    selectedIndices.clear();

    const formData = new FormData();
    formData.append('zipfile', testSelectedFile);

    try {
        const res = await fetch('/api/test-zip', { method: 'POST', body: formData });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        currentImages = data.images.sort((a, b) => {
            const aNum = (a.name.match(/\d+/) || [0])[0];
            const bNum = (b.name.match(/\d+/) || [0])[0];
            return parseInt(aNum, 10) - parseInt(bNum, 10);
        });

        const sizeInput = document.getElementById('supSize');
        if (sizeInput) sizeInput.value = data.total;

        currentImages.forEach((img, index) => {
            const container = document.createElement('div');
            container.style.position = 'relative';
            container.style.width = '100%';
            container.style.aspectRatio = '1/1';
            container.dataset.index = index;

            const imgEl = document.createElement('img');
            imgEl.src = img.data;
            imgEl.title = img.name;
            imgEl.style.width = '100%';
            imgEl.style.height = '100%';
            imgEl.style.objectFit = 'cover';
            imgEl.style.borderRadius = '6px';
            imgEl.style.border = '2px solid #334155';
            imgEl.style.cursor = 'pointer';
            container.appendChild(imgEl);

            const overlay = document.createElement('div');
            overlay.style.position = 'absolute';
            overlay.style.inset = '0';
            overlay.style.backgroundColor = 'rgba(128, 128, 128, 0.5)';
            overlay.style.borderRadius = '6px';
            overlay.style.pointerEvents = 'none';
            overlay.style.display = 'none';
            overlay.className = 'selected-overlay';
            container.appendChild(overlay);

            imageGrid.appendChild(container);
        });
    } catch (err) {
        console.error('uploadTestZip error:', err);
        alert(err.message);
    } finally {
        document.getElementById('test-file-input').value = '';
        isUploading = false;
    }
}

function toggleSelectImage(index) {
    if (selectedIndices.has(index)) {
        removeFromSupporter(index);
        selectedIndices.delete(index);
    } else {
        if (selectedIndices.size >= 4) {
            alert('Maximum 4 images can be selected.');
            return;
        }
        addToSupporter(index);
        selectedIndices.add(index);
    }
    updateMainGridOverlay();
}

function addToSupporter(index) {
    if (selectedIndices.size >= 4) {
        alert('Maximum 4 images can be selected.');
        return;
    }

    const imgData = currentImages[index];
    if (!imgData) return;

    // Prevent duplicate addition
    if (Array.from(document.querySelectorAll('#sup-preview-container > div')).some(div => div.dataset.index == index)) {
        return;
    }

    const byteString = atob(imgData.data.split(',')[1]);
    const mimeString = imgData.data.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeString });
    const file = new File([blob], imgData.name, { type: mimeString });

    supporterUploadedFiles.push(file);

    const container = document.getElementById('sup-preview-container');
    const imgContainer = document.createElement('div');
    imgContainer.style.position = 'relative';
    imgContainer.style.width = '100%';
    imgContainer.style.aspectRatio = '1/1';
    imgContainer.dataset.index = index;

    const imgEl = document.createElement('img');
    imgEl.src = imgData.data;
    imgEl.className = "preview-img";
    imgEl.style.width = '100%';
    imgEl.style.height = '100%';
    imgEl.style.objectFit = 'cover';
    imgEl.style.borderRadius = '6px';
    imgEl.style.border = '2px solid #334155';
    imgEl.style.cursor = 'pointer';
    imgEl.addEventListener('click', () => removeFromSupporter(index));

    imgContainer.appendChild(imgEl);
    container.appendChild(imgContainer);

    // Optional: re-init Sortable (kept as is)
    if (typeof Sortable !== 'undefined') {
        new Sortable(container, {
            animation: 150,
            handle: '.preview-img',
            onEnd: function(evt) {
                const items = Array.from(container.children);
                const newOrder = [];
                items.forEach(child => {
                    const idx = child.dataset.index;
                    if (idx !== undefined) {
                        const imgData = currentImages[parseInt(idx)];
                        if (imgData) {
                            const byteString = atob(imgData.data.split(',')[1]);
                            const mime = imgData.data.split(',')[0].split(':')[1].split(';')[0];
                            const ab = new ArrayBuffer(byteString.length);
                            const ia = new Uint8Array(ab);
                            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                            const blob = new Blob([ab], { type: mime });
                            newOrder.push(new File([blob], imgData.name, { type: mime }));
                        }
                    }
                });
                supporterUploadedFiles = newOrder;
            }
        });
    }

    selectedIndices.add(index);
    updateMainGridOverlay();
}

function removeFromSupporter(index) {
    selectedIndices.delete(index);
    rebuildSupporterPreview();
    updateMainGridOverlay();
}

function rebuildSupporterPreview() {
    const container = document.getElementById('sup-preview-container');
    container.innerHTML = '';
    supporterUploadedFiles = [];

    const indices = Array.from(selectedIndices).sort((a, b) => a - b);
    indices.forEach(index => {
        const imgData = currentImages[index];
        if (!imgData) return;

        const byteString = atob(imgData.data.split(',')[1]);
        const mimeString = imgData.data.split(',')[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([ab], { type: mimeString });
        const file = new File([blob], imgData.name, { type: mimeString });

        supporterUploadedFiles.push(file);

        const imgContainer = document.createElement('div');
        imgContainer.style.position = 'relative';
        imgContainer.style.width = '100%';
        imgContainer.style.aspectRatio = '1/1';
        imgContainer.dataset.index = index;

        const imgEl = document.createElement('img');
        imgEl.src = imgData.data;
        imgEl.className = "preview-img";
        imgEl.style.width = '100%';
        imgEl.style.height = '100%';
        imgEl.style.objectFit = 'cover';
        imgEl.style.borderRadius = '6px';
        imgEl.style.border = '2px solid #334155';
        imgEl.style.cursor = 'pointer';
        imgEl.addEventListener('click', () => removeFromSupporter(index));

        imgContainer.appendChild(imgEl);
        container.appendChild(imgContainer);
    });

    if (typeof Sortable !== 'undefined' && container.children.length > 0) {
        new Sortable(container, {
            animation: 150,
            handle: '.preview-img',
            onEnd: function(evt) {
                const items = Array.from(container.children);
                const newOrder = [];
                items.forEach(child => {
                    const idx = child.dataset.index;
                    if (idx !== undefined) {
                        const imgData = currentImages[parseInt(idx)];
                        if (imgData) {
                            const byteString = atob(imgData.data.split(',')[1]);
                            const mime = imgData.data.split(',')[0].split(':')[1].split(';')[0];
                            const ab = new ArrayBuffer(byteString.length);
                            const ia = new Uint8Array(ab);
                            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                            const blob = new Blob([ab], { type: mime });
                            newOrder.push(new File([blob], imgData.name, { type: mime }));
                        }
                    }
                });
                supporterUploadedFiles = newOrder;
            }
        });
    }
}

function updateMainGridOverlay() {
    const containers = document.querySelectorAll('#test-image-grid > div');
    containers.forEach(container => {
        const index = parseInt(container.dataset.index);
        const overlay = container.querySelector('.selected-overlay');
        if (overlay) {
            overlay.style.display = selectedIndices.has(index) ? 'block' : 'none';
        }
    });
}

window.clearSelection = function(clearFile = false) {
    selectedIndices.clear();
    rebuildSupporterPreview();
    updateMainGridOverlay();
    if (clearFile) {
        window.currentZipFile = null;
        testSelectedFile = null;
        document.getElementById('test-preview-container').innerHTML = '';
        document.getElementById('test-drop-text').style.display = 'block';
        document.getElementById('test-image-grid').innerHTML = '';
    }
};

window.uploadTestZip = uploadTestZip;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUploadTest);
} else {
    initUploadTest();
}
