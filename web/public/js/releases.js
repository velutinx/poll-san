// This is    /web/public/js/releases.js

let supporterSortable = null;
let previewSortable = null;
let cachedConfig = null; 
async function getConfig() {
    if (cachedConfig) return cachedConfig;
    try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const config = await res.json();
        if (!config.forumIds?.preview || !config.forumIds?.supporter) {
            throw new Error('Missing forum IDs in config');
        }
        cachedConfig = config;
        return cachedConfig;
    } catch (err) {
        console.error('Failed to load config:', err);
        showToast('Error', 'Could not load configuration. Please refresh.', 'error');
        throw err;
    }
}

function initPreviewSortable() {
    const container = document.getElementById('preview-container');
    if (!container || previewSortable) return;
    previewSortable = new Sortable(container, {
        animation: 150,
        handle: '.preview-img',
        ghostClass: 'sortable-ghost',
        onEnd: function() {
            const newOrder = [];
            container.querySelectorAll('.preview-img').forEach((img) => {
                const idx = img.getAttribute('data-file-index');
                if (idx !== null && window.uploadedFiles[idx]) {
                    newOrder.push(window.uploadedFiles[idx]);
                }
            });
            if (newOrder.length === window.uploadedFiles.length) {
                window.uploadedFiles = newOrder;
            }
            container.querySelectorAll('.preview-img').forEach((img, i) => {
                img.setAttribute('data-file-index', i);
            });
        }
    });
}

const originalHandleFiles = window.handleFiles;
window.handleFiles = function(files) {
    if (originalHandleFiles) {
        originalHandleFiles(files);
    } else {
        for (let file of files) {
            window.uploadedFiles.push(file);
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

    setTimeout(() => {
        const container = document.getElementById('preview-container');
        if (container) {
            container.querySelectorAll('.preview-img').forEach((img, idx) => {
                img.setAttribute('data-file-index', idx);
            });
            if (previewSortable) {
                previewSortable.destroy();
                previewSortable = null;
            }
            initPreviewSortable();
        }
    }, 50);
};

const originalClearImages = window.clearImages;
window.clearImages = function() {
    if (originalClearImages) {
        originalClearImages();
    } else {
        window.uploadedFiles.length = 0;
        const previewContainer = document.getElementById('preview-container');
        previewContainer.innerHTML = '';
        const dropText = document.getElementById('drop-text');
        if (dropText) dropText.style.display = 'block';
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';
    }
    if (previewSortable) {
        previewSortable.destroy();
        previewSortable = null;
    }
};

function setupPreviewSortable() {
    const container = document.getElementById('preview-container');
    if (container && container.children.length > 0) {
        container.querySelectorAll('.preview-img').forEach((img, i) => {
            if (!img.hasAttribute('data-file-index')) {
                img.setAttribute('data-file-index', i);
            }
        });
        if (!previewSortable) {
            initPreviewSortable();
        }
    }
}

function initSupporterSortable() {
    const container = document.getElementById('sup-preview-container');
    if (!container || supporterSortable) return;
    supporterSortable = new Sortable(container, {
        animation: 200,
        onEnd: function() {
            const newOrder = [];
            container.querySelectorAll('.preview-img').forEach((img) => {
                const idx = img.getAttribute('data-file-index');
                if (idx !== null && window.supporterUploadedFiles[idx]) {
                    newOrder.push(window.supporterUploadedFiles[idx]);
                } else {
                    const filename = img.src.split('/').pop();
                    const file = window.supporterUploadedFiles.find(f => f.name === filename);
                    if (file) newOrder.push(file);
                }
            });
            if (newOrder.length === window.supporterUploadedFiles.length) {
                window.supporterUploadedFiles = newOrder;
            }
            container.querySelectorAll('.preview-img').forEach((img, i) => {
                img.setAttribute('data-file-index', i);
            });
        }
    });
}

if (window.handleSupporterFiles) {
    const originalHandleSupporterFiles = window.handleSupporterFiles;
    window.handleSupporterFiles = function(files) {
        originalHandleSupporterFiles(files);
        setTimeout(() => {
            const container = document.getElementById('sup-preview-container');
            if (container) {
                container.querySelectorAll('.preview-img').forEach((img, idx) => {
                    img.setAttribute('data-file-index', idx);
                });
                if (!supporterSortable) initSupporterSortable();
            }
        }, 50);
    };
}

if (window.clearSupporterImages) {
    const originalClearSupporterImages = window.clearSupporterImages;
    window.clearSupporterImages = function() {
        originalClearSupporterImages();
        if (supporterSortable) {
            supporterSortable.destroy();
            supporterSortable = null;
        }
    };
}

function setupSupporterSortable() {
    const container = document.getElementById('sup-preview-container');
    if (container && container.children.length > 0 && !supporterSortable) {
        container.querySelectorAll('.preview-img').forEach((img, i) => {
            if (!img.hasAttribute('data-file-index')) {
                img.setAttribute('data-file-index', i);
            }
        });
        initSupporterSortable();
    }
}

async function fetchForumPosts() {
    const previewDrop = document.getElementById('postDropdown');
    const supporterBaseDrop = document.getElementById('supporterPostSelect');
    if (previewDrop) previewDrop.innerHTML = '<option value="">Loading posts...</option>';
    if (supporterBaseDrop) supporterBaseDrop.innerHTML = '<option value="">Loading posts...</option>';

    try {
        const config = await getConfig();
        const res = await fetch(`/api/forum-posts?channelId=${config.forumIds.preview}`);
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        const data = await res.json();
        window.globalForumPosts = Array.isArray(data) ? data : [];

        if (previewDrop) previewDrop.innerHTML = '<option value="">-- Select a post to edit --</option>';
        if (supporterBaseDrop) supporterBaseDrop.innerHTML = '<option value="">-- Select a post to base this on --</option>';

        window.globalForumPosts.forEach(post => {
            if (previewDrop) {
                const opt = document.createElement('option');
                opt.value = post.id;
                opt.textContent = post.name;
                previewDrop.appendChild(opt);
            }
            if (supporterBaseDrop) {
                const opt = document.createElement('option');
                opt.value = post.id;
                opt.textContent = post.name;
                supporterBaseDrop.appendChild(opt);
            }
        });

        const packNumbers = window.globalForumPosts
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
        window.globalForumPosts = [];
    }
}

async function fetchSupporterPosts() {
    const drop = document.getElementById('supporterEditDropdown');
    if (drop) drop.innerHTML = '<option value="">Loading supporter posts...</option>';
    try {
        const config = await getConfig();
        const res = await fetch(`/api/forum-posts?channelId=${config.forumIds.supporter}`);
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        const data = await res.json();
        window.globalSupporterPosts = Array.isArray(data) ? data : [];

        if (drop) {
            drop.innerHTML = '<option value="">-- Select a supporter post to edit --</option>';
            window.globalSupporterPosts.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                drop.appendChild(opt);
            });
        }
    } catch (e) {
        console.error("Error fetching supporter posts:", e);
        window.globalSupporterPosts = [];
        if (drop) drop.innerHTML = '<option value="">Error loading posts</option>';
    }
}

async function loadPostData() {
    const drop = document.getElementById('postDropdown');
    const postId = drop.value;
    const post = window.globalForumPosts.find(p => p.id === postId);
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
        const config = await getConfig();
        const previewFemaleTag = config.tagIds.preview_female;
        const previewMaleTags = config.tagIds.preview_male;
        let genderValue = ":male_sign:";
        if (appliedTags.includes(previewFemaleTag)) {
            genderValue = ":female_sign:";
        } else if (previewMaleTags.some(tag => appliedTags.includes(tag))) {
            genderValue = ":male_sign:";
        } else if (fullName.includes("♀️")) {
            genderValue = ":female_sign:";
        } else if (fullName.includes("♂️")) {
            genderValue = ":male_sign:";
        }
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
                const res = await fetch(`/api/get-post-content?id=${postId}`);
                if (!res.ok) throw new Error('Failed to fetch content: ' + res.status);
                const data = await res.json();
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

async function loadSupporterEditData() {
    const drop = document.getElementById('supporterEditDropdown');
    const postId = drop.value;
    const post = window.globalSupporterPosts.find(p => p.id === postId);
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
    const config = await getConfig();
    const femaleTag = config.tagIds.supporter_female;
    const maleTags = config.tagIds.supporter_male;
    const genderSelect = document.getElementById('supGender');

    if (appliedTags.includes(femaleTag)) {
        genderSelect.value = ':female_sign:';
    } else if (maleTags.some(tag => appliedTags.includes(tag))) {
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
    megaUrl = megaUrl.replace(/[)\]},.]+$/, '');
    megaUrl = megaUrl.replace(/\)$/, '');
    document.getElementById('supDownload').value = megaUrl.replace(/[<>*]/g, '').trim();
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

async function loadSupporterPostData() {
    const drop = document.getElementById('supporterPostSelect');
    const postId = drop.value;
    const post = window.globalForumPosts.find(p => p.id === postId);
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
    const config = await getConfig();
    const previewFemaleTag = config.tagIds.preview_female;
    const previewMaleTags = config.tagIds.preview_male;
    const genderSelect = document.getElementById('supGender');

    if (appliedTags.includes(previewFemaleTag)) {
        genderSelect.value = ':female_sign:';
    } else if (previewMaleTags.some(tag => appliedTags.includes(tag))) {
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
    window.uploadedFiles.forEach(file => { formData.append('images', file); });

    try {
        const res = await fetch('/api/release-preview', { method: 'POST', body: formData });
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
    if (supporterThreadId) formData.append('supporterThreadId', supporterThreadId);
    const previewThreadId = document.getElementById('supporterPostSelect').value;
    if (previewThreadId) formData.append('previewThreadId', previewThreadId);

    window.supporterUploadedFiles.forEach(file => { formData.append('images', file); });

    try {
        const res = await fetch('/api/supporter-release', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok) {
            showToast('Success', 'Supporter release posted/updated');
            if (data.previewError) showToast('Preview Update Warning', data.previewError, 'warning');
            clearSupporterImages();
            await fetchSupporterPosts();
            if (status) status.innerText = '';
        } else {
            showToast('Error', data.error || 'Failed', 'error');
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

function handleFiles(files) {
    for (let file of files) {
        window.uploadedFiles.push(file);
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
    window.uploadedFiles.length = 0;
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
        window.supporterUploadedFiles.push(file);
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
    if (supDropText && window.supporterUploadedFiles.length > 0) {
        supDropText.style.display = 'none';
    }
}

function clearSupporterImages() {
    window.supporterUploadedFiles.length = 0;
    const supPreviewContainer = document.getElementById('sup-preview-container');
    supPreviewContainer.innerHTML = '';
    const supDropText = document.getElementById('sup-drop-text');
    if (supDropText) supDropText.style.display = 'block';
    const supFileInput = document.getElementById('sup-file-input');
    if (supFileInput) supFileInput.value = '';
}

function initReleases() {
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
}
