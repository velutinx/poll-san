// uploading.js - fixed version

let testSelectedFile = null;
let currentImages = [];
let selectedIndices = new Set();
let supporterUploadedFiles = [];          // global array for files to upload

// Make some things available globally (used by other parts like mega upload)
window.currentZipFile = null;
window.totalImagesCount = 0;
window.supporterUploadedFiles = supporterUploadedFiles;  // expose if needed elsewhere

function initUploadTest() {
    const dropZone = document.getElementById('test-drop-zone');
    const fileInput = document.getElementById('test-file-input');
    const dropText = document.getElementById('test-drop-text');
    const previewContainer = document.getElementById('test-preview-container');

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
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleTestFile(files[0]);
            uploadTestZip();
        }
    };

    if (fileInput) {
        fileInput.onchange = (e) => {
            if (e.target.files.length > 0) {
                handleTestFile(e.target.files[0]);
                uploadTestZip();
            }
        };
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
    const imageGrid = document.getElementById('test-image-grid');
    if (!testSelectedFile) return;

    imageGrid.innerHTML = '';
    selectedIndices.clear();
    supporterUploadedFiles = [];   // reset when new zip is loaded

    const formData = new FormData();
    formData.append('zipfile', testSelectedFile);

    try {
        const res = await fetch('/api/test-zip', { method: 'POST', body: formData });
        if (!res.ok) throw new Error(await res.text());

        const data = await res.json();

        // Sort images by numeric part in filename
        currentImages = data.images.sort((a, b) => {
            const aNum = parseInt((a.name.match(/\d+/) || ['0'])[0], 10);
            const bNum = parseInt((b.name.match(/\d+/) || ['0'])[0], 10);
            return aNum - bNum;
        });

        // Auto-fill set size
        const sizeInput = document.getElementById('supSize');
        if (sizeInput) sizeInput.value = data.total;

        // Render preview grid (first 10 images)
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
            imgEl.style.transition = 'border 0.2s';
            imgEl.addEventListener('click', () => toggleSelectImage(index));

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
        console.error('Zip processing error:', err);
        alert(err.message || 'Failed to process ZIP');
    } finally {
        document.getElementById('test-file-input').value = '';
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
    const imgData = currentImages[index];
    if (!imgData) return;

    // Create File from base64 data
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

    // Add preview image immediately
    const container = document.getElementById('sup-preview-container');
    const imgContainer = document.createElement('div');
    imgContainer.style.position = 'relative';
    imgContainer.style.width = '100%';
    imgContainer.style.aspectRatio = '1/1';
    imgContainer.dataset.index = index;

    const imgEl = document.createElement('img');
    imgEl.src = imgData.data;   // reuse already-loaded data URL
    imgEl.className = 'preview-img';
    imgEl.style.width = '100%';
    imgEl.style.height = '100%';
    imgEl.style.objectFit = 'cover';
    imgEl.style.borderRadius = '6px';
    imgEl.style.border = '2px solid #334155';
    imgEl.style.cursor = 'pointer';
    imgEl.addEventListener('click', () => removeFromSupporter(index));

    imgContainer.appendChild(imgEl);
    container.appendChild(imgContainer);

    // Re-attach Sortable after adding
    initSortable();

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

    // Rebuild file array in current selected order
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

        // Add visual
        const imgContainer = document.createElement('div');
        imgContainer.style.position = 'relative';
        imgContainer.style.width = '100%';
        imgContainer.style.aspectRatio = '1/1';
        imgContainer.dataset.index = index;

        const imgEl = document.createElement('img');
        imgEl.src = imgData.data;
        imgEl.className = 'preview-img';
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

    // Re-attach Sortable once after full rebuild
    initSortable();
}

function initSortable() {
    const container = document.getElementById('sup-preview-container');
    if (typeof Sortable === 'undefined' || container.children.length === 0) return;

    // Remove any previous instance if exists (prevents multiple bindings)
    if (container.sortableInstance) {
        container.sortableInstance.destroy();
    }

    container.sortableInstance = Sortable.create(container, {
        animation: 150,
        handle: '.preview-img',
        onEnd: function (evt) {
            const items = Array.from(container.children);
            const newOrder = [];

            items.forEach(child => {
                const idx = parseInt(child.dataset.index);
                if (!isNaN(idx)) {
                    const imgData = currentImages[idx];
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
            // Optional: console.log('New order:', supporterUploadedFiles.map(f => f.name));
        }
    });
}

function updateMainGridOverlay() {
    document.querySelectorAll('#test-image-grid > div').forEach(container => {
        const index = parseInt(container.dataset.index);
        const overlay = container.querySelector('.selected-overlay');
        if (overlay) {
            overlay.style.display = selectedIndices.has(index) ? 'block' : 'none';
        }
    });
}

// Global clear function
window.clearSelection = function () {
    selectedIndices.clear();
    supporterUploadedFiles = [];
    rebuildSupporterPreview();
    updateMainGridOverlay();
    // Optional: reset zip preview too
    // document.getElementById('test-preview-container').innerHTML = '';
    // document.getElementById('test-drop-text').style.display = 'block';
    // window.currentZipFile = null;
    // testSelectedFile = null;
};

// Expose upload function
window.uploadTestZip = uploadTestZip;

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUploadTest);
} else {
    initUploadTest();
}
