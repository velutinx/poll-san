// public/js/releases.js

// ----- Safely declare global variables (avoid redeclaration) -----
if (typeof window.uploadedFiles === 'undefined') {
    window.uploadedFiles = [];
}
if (typeof window.supporterUploadedFiles === 'undefined') {
    window.supporterUploadedFiles = [];
}
if (typeof window.globalForumPosts === 'undefined') {
    window.globalForumPosts = [];
}
if (typeof window.globalSupporterPosts === 'undefined') {
    window.globalSupporterPosts = [];
}

// Use local references for convenience (but they point to the globals)
let uploadedFiles = window.uploadedFiles;
let supporterUploadedFiles = window.supporterUploadedFiles;
let globalForumPosts = window.globalForumPosts;
let globalSupporterPosts = window.globalSupporterPosts;

// ────────────────────────────────────────────────────────────
// Fetch posts from the preview forum (for both edit and auto-fill)
// ────────────────────────────────────────────────────────────
async function fetchForumPosts() {
    const previewChannelId = '1465938599378812980';
    const previewDrop = document.getElementById('postDropdown');
    const supporterBaseDrop = document.getElementById('supporterPostSelect');

    if (previewDrop) previewDrop.innerHTML = '<option value="">Loading posts...</option>';
    if (supporterBaseDrop) supporterBaseDrop.innerHTML = '<option value="">Loading posts...</option>';

    try {
        const res = await fetch(`/api/forum-posts?channelId=${previewChannelId}`);
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);

        const data = await res.json();
        globalForumPosts.length = 0; // clear array
        globalForumPosts.push(...(Array.isArray(data) ? data : []));

        console.log(`Loaded ${globalForumPosts.length} preview posts`);

        if (previewDrop) {
            previewDrop.innerHTML = '<option value="">-- Select a post to edit --</option>';
        }
        if (supporterBaseDrop) {
            supporterBaseDrop.innerHTML = '<option value="">-- Select a post to base this on --</option>';
        }

        globalForumPosts.forEach(post => {
            if (previewDrop) {
                const option = document.createElement('option');
                option.value = post.id;
                option.textContent = post.name;
                previewDrop.appendChild(option);
            }
            if (supporterBaseDrop) {
                const option = document.createElement('option');
                option.value = post.id;
                option.textContent = post.name;
                supporterBaseDrop.appendChild(option);
            }
        });

        // Auto-fill Pack Number and Set Size in Create New Release
        const packNumbers = globalForumPosts
            .map(p => p.name.match(/Pack #(\d+)/i))
            .filter(match => match)
            .map(match => parseInt(match[1], 10));
        const maxPack = packNumbers.length ? Math.max(...packNumbers) : 0;
        const nextPack = maxPack + 1;
        document.getElementById('rel-pack').value = nextPack;
        document.getElementById('rel-size').value = 'xx';

    } catch (error) {
        console.error('Error fetching preview forum posts:', error);
        if (previewDrop) previewDrop.innerHTML = '<option value="">Error loading posts</option>';
        if (supporterBaseDrop) supporterBaseDrop.innerHTML = '<option value="">Error loading posts</option>';
        globalForumPosts = [];
    }
}

// ────────────────────────────────────────────────────────────
// Fetch posts from the supporter forum (for edit dropdown)
// ────────────────────────────────────────────────────────────
async function fetchSupporterPosts() {
    try {
        const res = await fetch('/api/forum-posts?channelId=1465937644394512516');
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        const data = await res.json();
        globalSupporterPosts.length = 0;
        globalSupporterPosts.push(...(Array.isArray(data) ? data : []));
        console.log('Loaded supporter posts:', globalSupporterPosts.length);

        const drop = document.getElementById('supporterEditDropdown');
        if (drop) {
            drop.innerHTML = '<option value="">-- Select a supporter post to edit --</option>';
            globalSupporterPosts.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                drop.appendChild(opt);
            });
        }
    } catch (e) {
        console.error("Error fetching supporter posts:", e);
        globalSupporterPosts = [];
        const drop = document.getElementById('supporterEditDropdown');
        if (drop) drop.innerHTML = '<option value="">Error loading posts</option>';
    }
}

// ────────────────────────────────────────────────────────────
// Load preview post data into the edit form (Preview tab)
// ────────────────────────────────────────────────────────────
async function loadPostData() {
    const drop = document.getElementById('postDropdown');
    const postId = drop.value;
    const post = globalForumPosts.find(p => p.id === postId);
    if (!post) {
        document.getElementById('editFields').style.display = 'none';
        return;
    }
    const title = post.name;
    const regex = /\[(.*?)\] (.*?) — (?:Pack #)?(\d+)(?:\s*—\s*(SOON))?/i;
    const match = title.match(regex);
    if (match) {
        document.getElementById('editSeries').value = match[1];
        let fullName = match[2];
        const appliedTags = post.applied_tags || [];
        console.log('Applied tags for post ' + postId + ':', appliedTags);
        const hasFemale = appliedTags.includes('1465939310720192637');
        const hasFemboy = appliedTags.includes('1465939329120469095');
        let genderValue = ":male_sign:";
        if (hasFemale) genderValue = ":female_sign:";
        else if (hasFemboy) genderValue = ":male_sign:";
        else if (fullName.includes("♀️")) genderValue = ":female_sign:";
        else if (fullName.includes("♂️")) genderValue = ":male_sign:";
        document.getElementById('editGender').value = genderValue;
        document.getElementById('editName').value = fullName.replace(/♀️|♂️|:female_sign:|:male_sign:/g, "").trim();
        document.getElementById('editPack').value = match[3];
        if (title.includes("Poll")) document.getElementById('editSuffix').value = "Poll";
        else if (title.includes("Request")) document.getElementById('editSuffix').value = "Request";
        else document.getElementById('editSuffix').value = "";
        if (match[4] && match[4].toUpperCase() === "SOON") {
            document.getElementById('editSize').value = "XX";
        } else {
            try {
                console.log('Fetching content for preview post ' + postId);
                const res = await fetch(`/api/get-post-content?id=${postId}`);
                if (!res.ok) throw new Error('Failed to fetch content: ' + res.status);
                const data = await res.json();
                console.log('Fetched content:', data.content);
                const content = data.content;
                const sizeMatch = content.match(/Set size: (\d+) images/);
                document.getElementById('editSize').value = sizeMatch ? sizeMatch[1] : "";
            } catch (e) {
                console.error("Error fetching preview post content", e);
                document.getElementById('editSize').value = "";
            }
        }
        document.getElementById('editFields').style.display = 'block';
    }
}

// ────────────────────────────────────────────────────────────
// Load supporter post data into the form (Supporters tab – edit)
// ────────────────────────────────────────────────────────────
async function loadSupporterEditData() {
    const drop = document.getElementById('supporterEditDropdown');
    const postId = drop.value;
    const post = globalSupporterPosts.find(p => p.id === postId);
    if (!post) return;

    console.log("Loading supporter post:", post.name, "ID:", postId);

    const title = post.name;
    const titleRegex = /\[(.*?)\] (.*?) — (?:Pack #)?(\d+)(?: — (.*))?$/i;
    const titleMatch = title.match(titleRegex);

    if (titleMatch) {
        document.getElementById('supSeries').value = titleMatch[1];
        let fullName = titleMatch[2];
        document.getElementById('supName').value = fullName.replace(/♀️|♂️|:female_sign:|:male_sign:/g, "").trim();
        document.getElementById('supPack').value = titleMatch[3];
        const suffix = titleMatch[4] || '';
        const suffixSelect = document.getElementById('supSuffix');
        const option = Array.from(suffixSelect.options).find(opt => opt.value === suffix);
        suffixSelect.value = option ? suffix : '';
    }

    const appliedTags = post.applied_tags || [];
    const genderSelect = document.getElementById('supGender');
    const FEMALE_TAG = '1465939610642415921';
    const MALE_TAG = '1465939591352680488';
    const FEMBOY_TAG = '1467020371428642957';

    if (appliedTags.includes(FEMALE_TAG)) {
        genderSelect.value = ':female_sign:';
    } else if (appliedTags.includes(MALE_TAG) || appliedTags.includes(FEMBOY_TAG)) {
        genderSelect.value = ':male_sign:';
    } else {
        if (title.includes('♀️')) genderSelect.value = ':female_sign:';
        else if (title.includes('♂️')) genderSelect.value = ':male_sign:';
        else genderSelect.value = ':male_sign:';
    }

    try {
        console.log('Fetching supporter post content:', postId);
        const res = await fetch(`/api/get-post-content?id=${postId}`);
        const data = await res.json();
        const content = data.content || "";
        console.log("DEBUG - Full Content Received:", content);

        const sizeMatch = content.match(/Set size:\s*(\d+)/i);
        if (sizeMatch) document.getElementById('supSize').value = sizeMatch[1];

        let megaUrl = data.megaLink || "";
        if (!megaUrl) {
            const downloadMatch = content.match(/📥\s*Download:\s*(https:\/\/mega\.nz\/[^\s>]+)/i);
            if (downloadMatch) {
                megaUrl = downloadMatch[1];
            } else {
                const urlMatch = content.match(/https:\/\/mega\.nz\/[^\s>]+/i);
                if (urlMatch) megaUrl = urlMatch[0];
            }
        }

        if (megaUrl) {
            document.getElementById('supDownload').value = megaUrl.replace(/[<>*]/g, '').trim();
        } else {
            document.getElementById('supDownload').value = "";
            console.warn("MEGA Link not found.");
        }

        const imageContainer = document.getElementById('supporter-existing-images');
        imageContainer.innerHTML = '';
        if (data.attachments && data.attachments.length > 0) {
            data.attachments.forEach(att => {
                const img = document.createElement('img');
                img.src = att.url;
                img.style.cssText = "width:140px; height:140px; object-fit:cover; border-radius:6px; margin:5px;";
                imageContainer.appendChild(img);
            });
        } else {
            imageContainer.innerHTML = '<p style="color:#94a3b8; width:100%; text-align:center;">No images in this post</p>';
        }
    } catch (e) {
        console.error("Error loading supporter post:", e);
    }
}

// ────────────────────────────────────────────────────────────
// Auto-fill supporter form from a selected preview post
// ────────────────────────────────────────────────────────────
async function loadSupporterPostData() {
    const drop = document.getElementById('supporterPostSelect');
    const postId = drop.value;
    const post = globalForumPosts.find(p => p.id === postId);
    if (!post) return;

    const title = post.name;
    const titleRegex = /\[(.*?)\] (.*?) — (?:Pack #)?(\d+)(?: — (.*))?$/i;
    const titleMatch = title.match(titleRegex);

    if (titleMatch) {
        document.getElementById('supSeries').value = titleMatch[1];
        let fullName = titleMatch[2];
        document.getElementById('supName').value = fullName.replace(/♀️|♂️|:female_sign:|:male_sign:/g, "").trim();
        document.getElementById('supPack').value = titleMatch[3];
        const suffix = titleMatch[4] || '';
        const suffixSelect = document.getElementById('supSuffix');
        const option = Array.from(suffixSelect.options).find(opt => opt.value === suffix);
        suffixSelect.value = option ? suffix : '';
    }

    const appliedTags = post.applied_tags || [];
    const genderSelect = document.getElementById('supGender');
    const PREVIEW_FEMALE = '1465939310720192637';
    const PREVIEW_MALE = '1465939329120469095';
    const PREVIEW_FEMBOY = '1467020233272328195';

    if (appliedTags.includes(PREVIEW_FEMALE)) {
        genderSelect.value = ':female_sign:';
    } else if (appliedTags.includes(PREVIEW_MALE) || appliedTags.includes(PREVIEW_FEMBOY)) {
        genderSelect.value = ':male_sign:';
    } else {
        if (title.includes('♀️')) genderSelect.value = ':female_sign:';
        else if (title.includes('♂️')) genderSelect.value = ':male_sign:';
        else genderSelect.value = ':male_sign:';
    }

    try {
        const res = await fetch(`/api/get-post-content?id=${postId}`);
        const data = await res.json();
        const content = data.content || "";
        const sizeMatch = content.match(/Set size:\s*(\d+)/i);
        if (sizeMatch) document.getElementById('supSize').value = sizeMatch[1];
    } catch (e) {
        console.error("Error fetching preview post content:", e);
    }
}

// ────────────────────────────────────────────────────────────
// Submit edit for a preview post (Preview tab)
// ────────────────────────────────────────────────────────────
async function submitEdit() {
    const status = document.getElementById('edit-status');
    const btn = document.getElementById('edit-submit-btn');
    const data = {
        threadId: document.getElementById('postDropdown').value,
        pack: document.getElementById('editPack').value,
        setSize: document.getElementById('editSize').value,
        series: document.getElementById('editSeries').value,
        input: `${document.getElementById('editGender').value} ${document.getElementById('editName').value}`.trim(),
        suffix: document.getElementById('editSuffix').value
    };
    btn.disabled = true;
    status.innerText = "⏳ Updating...";
    try {
        const res = await fetch('/api/edit-post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            showToast('Post Updated', 'Preview post edited successfully');
            setTimeout(fetchForumPosts, 1000);
            status.innerText = '';
        } else {
            showToast('Error', 'Failed to edit post', 'error');
            status.innerText = '';
        }
    } catch (e) {
        showToast('Error', e.message, 'error');
        status.innerText = '';
    } finally {
        btn.disabled = false;
    }
}

// ────────────────────────────────────────────────────────────
// Create a new preview release (Preview tab)
// ────────────────────────────────────────────────────────────
async function submitRelease() {
    const status = document.getElementById('release-status');
    const btn = document.getElementById('rel-submit-btn');
    
    const series = document.getElementById('rel-series').value;
    const name = document.getElementById('rel-name').value;
    if (!series || !name) {
        showToast('Error', 'Series and Name are required', 'error');
        return;
    }

    btn.disabled = true;
    if (status) status.innerText = "⏳ Posting...";

    const formData = new FormData();
    formData.append('pack', document.getElementById('rel-pack').value);
    formData.append('setSize', document.getElementById('rel-size').value);
    formData.append('series', series);
    formData.append('input', `${document.getElementById('rel-gender').value} ${name}`.trim());
    formData.append('suffix', document.getElementById('rel-suffix').value || '');

    uploadedFiles.forEach(file => {
        formData.append('images', file);
    });

    try {
        const res = await fetch('/api/release-preview', {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            showToast('Success', 'New release created successfully');
            clearImages();
            await fetchForumPosts();
            if (status) status.innerText = '';
        } else {
            const errData = await res.json();
            showToast('Error', errData.error || 'Failed to create release', 'error');
            if (status) status.innerText = '';
        }
    } catch (e) {
        console.error("Submission error:", e);
        showToast('Error', e.message, 'error');
        if (status) status.innerText = '';
    } finally {
        btn.disabled = false;
    }
}

// ────────────────────────────────────────────────────────────
// Submit Supporter Release (Post/Update to #supporter-releases)
// ────────────────────────────────────────────────────────────
async function submitSupporterRelease() {
    const status = document.getElementById('supporter-status');
    const btn = document.querySelector('button[onclick="submitSupporterRelease()"]');
    if (!btn) return;

    const series = document.getElementById('supSeries').value;
    const name = document.getElementById('supName').value;
    const pack = document.getElementById('supPack').value;
    const size = document.getElementById('supSize').value;
    const download = document.getElementById('supDownload').value;

    if (!series || !name || !pack || !size || !download) {
        showToast('Error', 'All fields except images are required', 'error');
        return;
    }

    btn.disabled = true;
    if (status) status.innerText = "⏳ Posting...";

    const formData = new FormData();
    formData.append('pack', pack);
    formData.append('setSize', size);
    formData.append('series', series);
    formData.append('input', `${document.getElementById('supGender').value} ${name}`.trim());
    formData.append('suffix', document.getElementById('supSuffix').value || '');
    formData.append('download', download);
    formData.append('editPreview', document.getElementById('edit-preview-toggle').checked ? 'true' : 'false');

    const supporterThreadId = document.getElementById('supporterEditDropdown').value;
    if (supporterThreadId) {
        formData.append('supporterThreadId', supporterThreadId);
    }

    const previewThreadId = document.getElementById('postDropdown').value;
    if (previewThreadId) {
        formData.append('previewThreadId', previewThreadId);
    }

    supporterUploadedFiles.forEach(file => {
        formData.append('images', file);
    });

    try {
        const res = await fetch('/api/supporter-release', {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            showToast('Success', 'Supporter release posted/updated');
            clearSupporterImages();
            await fetchSupporterPosts();
            if (status) status.innerText = '';
        } else {
            const errData = await res.json();
            showToast('Error', errData.error || 'Failed', 'error');
            if (status) status.innerText = '';
        }
    } catch (e) {
        console.error("Supporter submission error:", e);
        showToast('Error', e.message, 'error');
        if (status) status.innerText = '';
    } finally {
        btn.disabled = false;
    }
}

// ────────────────────────────────────────────────────────────
// Upload ZIP to MEGA (from Supporters tab)
// ────────────────────────────────────────────────────────────
async function uploadToMega() {
    const status = document.getElementById('mega-status');
    const btn = document.getElementById('mega-upload-btn');
    const fileInput = document.getElementById('test-file-input');
    const file = fileInput?.files[0];

    if (!file) {
        showToast('Error', 'No ZIP file selected', 'error');
        return;
    }

    const month = prompt("Enter month folder (e.g., MAR-26):");
    if (!month) return;

    const filenameInput = document.getElementById('mega-filename');
    const desiredName = filenameInput.value.trim() || file.name;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('month', month);
    formData.append('desiredName', desiredName);

    btn.disabled = true;
    status.innerText = "⏳ Uploading...";

    try {
        const res = await fetch('/api/upload-to-mega', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error(`Upload failed: ${res.status}`);

        const data = await res.json();
        if (data.link) {
            document.getElementById('supDownload').value = data.link;
            showToast('Success', 'Uploaded! Link added to Download field');
        } else {
            showToast('Error', 'No link returned', 'error');
        }
    } catch (e) {
        console.error("MEGA upload error:", e);
        showToast('Error', e.message, 'error');
    } finally {
        btn.disabled = false;
        status.innerText = '';
    }
}

// ────────────────────────────────────────────────────────────
// Drag & drop helpers for images and ZIP
// ────────────────────────────────────────────────────────────
function handleFiles(files) {
    for (let file of files) {
        uploadedFiles.push(file);
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.className = "preview-img";
            document.getElementById('preview-container').appendChild(img);
        };
        reader.readAsDataURL(file);
    }
    const dropText = document.getElementById('drop-text');
    if (dropText) dropText.style.display = 'none';
}

function clearImages() {
    uploadedFiles.length = 0;
    const previewContainer = document.getElementById('preview-container');
    previewContainer.innerHTML = '';
    const dropText = document.getElementById('drop-text');
    if (dropText) dropText.style.display = 'block';
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.value = '';
}

function handleSupporterFiles(files) {
    for (let file of files) {
        if (!file.type.startsWith('image/')) continue;
        supporterUploadedFiles.push(file);
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.className = "preview-img";
            document.getElementById('sup-preview-container').appendChild(img);
        };
        reader.readAsDataURL(file);
    }
    const supDropText = document.getElementById('sup-drop-text');
    if (supDropText && supporterUploadedFiles.length > 0) {
        supDropText.style.display = 'none';
    }
}

function clearSupporterImages() {
    supporterUploadedFiles.length = 0;
    const supPreviewContainer = document.getElementById('sup-preview-container');
    supPreviewContainer.innerHTML = '';
    const supDropText = document.getElementById('sup-drop-text');
    if (supDropText) supDropText.style.display = 'block';
    const supFileInput = document.getElementById('sup-file-input');
    if (supFileInput) supFileInput.value = '';
}

// ────────────────────────────────────────────────────────────
// Test ZIP – extract first 10 images and display
// ────────────────────────────────────────────────────────────
async function handleTestZip(file) {
    const formData = new FormData();
    formData.append('zipfile', file);

    try {
        const res = await fetch('/api/test-zip', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            const grid = document.getElementById('test-image-grid');
            grid.innerHTML = '';
            data.images.forEach(img => {
                const imgEl = document.createElement('img');
                imgEl.src = img.data;
                imgEl.style.width = '100px';
                imgEl.style.height = '100px';
                imgEl.style.objectFit = 'cover';
                imgEl.style.borderRadius = '4px';
                grid.appendChild(imgEl);
            });
            showToast('Success', `Loaded ${data.total} images (showing first 10)`);
        } else {
            showToast('Error', data.error || 'Failed to process ZIP', 'error');
        }
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
}

// ────────────────────────────────────────────────────────────
// Initialize all drag-and-drop listeners
// ────────────────────────────────────────────────────────────
function initReleases() {
    // Preview images drop zone
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    if (dropZone) {
        dropZone.onclick = () => fileInput?.click();
        dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = "var(--blue)"; };
        dropZone.ondragleave = () => { dropZone.style.borderColor = "#334155"; };
        dropZone.ondrop = (e) => {
            e.preventDefault();
            dropZone.style.borderColor = "#334155";
            handleFiles(e.dataTransfer.files);
        };
    }
    if (fileInput) fileInput.onchange = (e) => handleFiles(e.target.files);

    // Supporter images drop zone
    const supDropZone = document.getElementById('sup-drop-zone');
    const supFileInput = document.getElementById('sup-file-input');
    if (supDropZone) {
        supDropZone.onclick = () => supFileInput?.click();
        supDropZone.ondragover = (e) => { e.preventDefault(); supDropZone.style.borderColor = "var(--blue)"; };
        supDropZone.ondragleave = () => { supDropZone.style.borderColor = "#475569"; };
        supDropZone.ondrop = (e) => {
            e.preventDefault();
            supDropZone.style.borderColor = "#475569";
            handleSupporterFiles(e.dataTransfer.files);
        };
    }
    if (supFileInput) supFileInput.onchange = (e) => handleSupporterFiles(e.target.files);

    // Test ZIP drop zone
    const testDropZone = document.getElementById('test-drop-zone');
    const testFileInput = document.getElementById('test-file-input');
    if (testDropZone) {
        testDropZone.onclick = () => testFileInput?.click();
        testDropZone.ondragover = (e) => { e.preventDefault(); testDropZone.style.borderColor = "var(--blue)"; };
        testDropZone.ondragleave = () => { testDropZone.style.borderColor = "#475569"; };
        testDropZone.ondrop = (e) => {
            e.preventDefault();
            testDropZone.style.borderColor = "#475569";
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.zip')) {
                handleTestZip(file);
                const textSpan = document.getElementById('test-drop-text');
                if (textSpan) textSpan.textContent = `📦 ${file.name}`;
            } else {
                showToast('Error', 'Please drop a ZIP file', 'error');
            }
        };
    }
    if (testFileInput) testFileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) handleTestZip(file);
    };
}
