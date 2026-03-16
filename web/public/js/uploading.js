// uploading.js

let testSelectedFile = null;
let currentImages = [];
let selectedIndices = new Set();

// Make the current zip file and total image count available globally
window.currentZipFile = null;
window.totalImagesCount = 0;  // <-- new global

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
    window.currentZipFile = file; // Store globally for mega upload

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

    const formData = new FormData();
    formData.append('zipfile', testSelectedFile);

    try {
        const res = await fetch('/api/test-zip', { method: 'POST', body: formData });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        // Sort images by filename (natural numeric order)
        currentImages = data.images.sort((a, b) => {
            const aNum = (a.name.match(/\d+/) || [0])[0];
            const bNum = (b.name.match(/\d+/) || [0])[0];
            return parseInt(aNum, 10) - parseInt(bNum, 10);
        });

        // ✅ AUTO-FILL SET SIZE FIELD
        const sizeInput = document.getElementById('supSize');
        if (sizeInput) sizeInput.value = data.total;

        // Render images in right grid
        currentImages.forEach((img, index) => {
            // ... (rest of rendering code unchanged)
        });
    } catch (err) {
        console.error(err);
        alert(err.message);
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

    const byteString = atob(imgData.data.split(',')[1]);
    const mimeString = imgData.data.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeString });
    const file = new File([blob], imgData.name, { type: mimeString });

    if (typeof supporterUploadedFiles !== 'undefined') {
        supporterUploadedFiles.push(file);
    }

    const container = document.getElementById('sup-preview-container');
    const reader = new FileReader();
    reader.onload = (e) => {
        const imgContainer = document.createElement('div');
        imgContainer.style.position = 'relative';
        imgContainer.style.width = '100%';
        imgContainer.style.aspectRatio = '1/1';
        imgContainer.dataset.index = index;

        const imgEl = document.createElement('img');
        imgEl.src = e.target.result;
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
                                const mimeString = imgData.data.split(',')[0].split(':')[1].split(';')[0];
                                const ab = new ArrayBuffer(byteString.length);
                                const ia = new Uint8Array(ab);
                                for (let i = 0; i < byteString.length; i++) {
                                    ia[i] = byteString.charCodeAt(i);
                                }
                                const blob = new Blob([ab], { type: mimeString });
                                const file = new File([blob], imgData.name, { type: mimeString });
                                newOrder.push(file);
                            }
                        }
                    });
                    supporterUploadedFiles = newOrder;
                }
            });
        }
    };
    reader.readAsDataURL(file);
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

        const reader = new FileReader();
        reader.onload = (e) => {
            const imgContainer = document.createElement('div');
            imgContainer.style.position = 'relative';
            imgContainer.style.width = '100%';
            imgContainer.style.aspectRatio = '1/1';
            imgContainer.dataset.index = index;

            const imgEl = document.createElement('img');
            imgEl.src = e.target.result;
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
                                    const mimeString = imgData.data.split(',')[0].split(':')[1].split(';')[0];
                                    const ab = new ArrayBuffer(byteString.length);
                                    const ia = new Uint8Array(ab);
                                    for (let i = 0; i < byteString.length; i++) {
                                        ia[i] = byteString.charCodeAt(i);
                                    }
                                    const blob = new Blob([ab], { type: mimeString });
                                    const file = new File([blob], imgData.name, { type: mimeString });
                                    newOrder.push(file);
                                }
                            }
                        });
                        supporterUploadedFiles = newOrder;
                    }
                });
            }
        };
        reader.readAsDataURL(file);
    });
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

// Clear selection
window.clearSelection = function() {
    selectedIndices.clear();
    rebuildSupporterPreview();
    updateMainGridOverlay();
    // Optionally clear the global zip file if you want to remove it from mega upload
    // window.currentZipFile = null;
    // testSelectedFile = null;
    // document.getElementById('test-preview-container').innerHTML = '';
    // document.getElementById('test-drop-text').style.display = 'block';
};

// Expose upload function globally
window.uploadTestZip = uploadTestZip;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUploadTest);
} else {
    initUploadTest();
}
