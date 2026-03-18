// public/js/releases.js

// These global variables are declared in index.html, so we don't redeclare them.
// uploadedFiles, supporterUploadedFiles, globalForumPosts, globalSupporterPosts

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
        globalForumPosts = Array.isArray(data) ? data : [];

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

        // --- NEW: Auto-fill Pack Number and Set Size in Create New Release ---
        // Extract all pack numbers from post titles
        const packNumbers = globalForumPosts
            .map(p => p.name.match(/Pack #(\d+)/i))
            .filter(match => match)
            .map(match => parseInt(match[1], 10));
        const maxPack = packNumbers.length ? Math.max(...packNumbers) : 0;
        const nextPack = maxPack + 1;
        document.getElementById('rel-pack').value = nextPack;
        // Set default Set Size to "xx"
        document.getElementById('rel-size').value = 'xx';
        // --------------------------------------------------------------------

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
        globalSupporterPosts = Array.isArray(data) ? data : [];
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
submitRelease
// ────────────────────────────────────────────────────────────
// Create a new preview release (Preview tab)
// ────────────────────────────────────────────────────────────
async function submitRelease() {
    const status = document.getElementById('release-status');
    const btn = document.getElementById('release-submit-btn');
    
    // Basic validation
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

    // Add the images from the uploadedFiles array
    uploadedFiles.forEach(file => {
        formData.append('images', file);
    });

    try {
        const res = await fetch('/api/create-release', {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            showToast('Success', 'New release created successfully');
            clearImages();
            // Refresh the dropdowns so the new post appears
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
// Drag & drop helpers for images
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
    uploadedFiles = [];
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
    supporterUploadedFiles = [];
    const supPreviewContainer = document.getElementById('sup-preview-container');
    supPreviewContainer.innerHTML = '';
    const supDropText = document.getElementById('sup-drop-text');
    if (supDropText) supDropText.style.display = 'block';
    const supFileInput = document.getElementById('sup-file-input');
    if (supFileInput) supFileInput.value = '';
}

// ────────────────────────────────────────────────────────────
// Initialize drag-and-drop listeners
// ────────────────────────────────────────────────────────────
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
