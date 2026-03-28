// web/routes/releases.js
const AdmZip = require('adm-zip');
const { Storage } = require('megajs');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function setupReleasesRoutes(app, client, upload, FORUM_ID, SUPPORTER_FORUM_ID) {
  // ────────────────────────────────────────────────
  // 8. RELEASE PREVIEW
  // ────────────────────────────────────────────────
  app.post('/api/release-preview', upload.array('images'), async (req, res) => {
    const { pack, setSize, input, series, suffix } = req.body;
    const files = req.files || [];
    try {
      const fullInput = input.trim();
      const spaceIndex = fullInput.indexOf(' ');
      let genderEmoji = "";
      let charName = fullInput;
      if (spaceIndex !== -1) {
        genderEmoji = fullInput.substring(0, spaceIndex);
        charName = fullInput.substring(spaceIndex + 1).trim();
      }
      const appliedTags = [];
      if (genderEmoji.includes('female_sign') || genderEmoji === '♀️') appliedTags.push('1465939310720192637');
      else if (genderEmoji.includes('male_sign') || genderEmoji === '♂️') appliedTags.push('1465939329120469095', '1467020233272328195');

      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const forumChannel = await guild.channels.fetch(FORUM_ID);

      const isSoon = setSize.toUpperCase() === 'XX';
      const suffixStr = suffix ? ` — ${suffix}` : '';
      const threadTitle = `[${series.toUpperCase()}] ${charName} — Pack #${pack}${suffixStr}`;
      const messageBody = `:new: NEW RELEASE${isSoon ? ' -- SOON' : ''}
━━━━━━━━━━━━━━
Character: ${charName}
Series: ${series}
Set size: ${setSize} images

:pushpin: SFW preview below

:arrow_right: Full version for supporters
:arrow_right: See <#${SUPPORTER_FORUM_ID}>`;

      const attachments = files.map(f => ({ attachment: f.buffer, name: f.originalname }));

      await forumChannel.threads.create({
        name: threadTitle,
        appliedTags: appliedTags,
        message: { content: messageBody, files: attachments }
      });

      res.json({ success: true });
    } catch (err) {
      console.error('Release preview error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ────────────────────────────────────────────────
  // 9. FORUM FETCHING
  // ────────────────────────────────────────────────
  app.get('/api/forum-posts', async (req, res) => {
    try {
      const channelId = req.query.channelId || FORUM_ID;
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const forumChannel = await guild.channels.fetch(channelId);
      if (!forumChannel.isThreadOnly()) {
        return res.status(400).json({ error: "Channel is not a forum" });
      }

      const threads = await forumChannel.threads.fetchActive();
      const postList = threads.threads.map(t => ({
        id: t.id,
        name: t.name,
        applied_tags: Array.isArray(t.appliedTags) ? t.appliedTags : []
      }));

      postList.sort((a, b) => {
        const aId = BigInt(a.id);
        const bId = BigInt(b.id);
        return aId > bId ? -1 : aId < bId ? 1 : 0;
      });

      res.json(postList);
    } catch (err) {
      console.error('Forum posts endpoint error:', err);
      res.status(500).json({ error: err.message || 'Failed to fetch forum threads' });
    }
  });

  // ────────────────────────────────────────────────
  // 10. EDIT FORUM POST
  // ────────────────────────────────────────────────
  app.post('/api/edit-post', async (req, res) => {
    const { threadId, pack, setSize, input, series, suffix } = req.body;
    try {
      const thread = await client.channels.fetch(threadId);
      if (!thread) return res.status(404).json({ error: "Thread not found" });

      const fullInput = input.trim();
      const spaceIndex = fullInput.indexOf(' ');
      let charName = spaceIndex !== -1 ? fullInput.substring(spaceIndex + 1).trim() : fullInput;

      const isSoon = setSize.toUpperCase() === 'XX';
      const suffixStr = suffix ? ` — ${suffix}` : '';
      const newTitle = `[${series.toUpperCase()}] ${charName} — Pack #${pack}${suffixStr}${isSoon ? ' — SOON' : ''}`;

      await thread.setName(newTitle);

      const firstMsg = await thread.fetchStarterMessage();
      if (firstMsg) {
        let newBody = firstMsg.content
          .replace(/Character: .*/, `Character: ${charName}`)
          .replace(/Series: .*/, `Series: ${series}`)
          .replace(/Set size: .* images/, `Set size: ${setSize} images`);

        if (isSoon) {
          if (!newBody.includes('-- SOON')) {
            newBody = newBody.replace(/:new: NEW RELEASE/, ':new: NEW RELEASE -- SOON');
          }
        } else {
          newBody = newBody.replace(/ -- SOON/g, '');
        }

        await firstMsg.edit(newBody);
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Edit post error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ────────────────────────────────────────────────
  // 11. GET POST CONTENT
  // ────────────────────────────────────────────────
  app.get('/api/get-post-content', async (req, res) => {
    const { id } = req.query;
    try {
      if (!id) return res.status(400).json({ error: "Missing thread id" });
      const thread = await client.channels.fetch(id);
      if (!thread?.isThread()) return res.status(404).json({ error: "Not a valid thread" });

      const starter = await thread.fetchStarterMessage();
      if (!starter) return res.status(404).json({ error: "Starter message not found" });

      res.json({
        content: starter.content,
        attachments: starter.attachments.map(att => ({
          url: att.url,
          content_type: att.contentType || att.content_type || 'unknown',
          name: att.name || 'attachment',
          size: att.size
        }))
      });
    } catch (err) {
      console.error('Get post content error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ────────────────────────────────────────────────
  // 12. SUPPORTER RELEASE (with embed suppression)
  // ────────────────────────────────────────────────
  app.post('/api/supporter-release', upload.array('images'), async (req, res) => {
    const { pack, setSize, input, series, suffix, download, editPreview, previewThreadId, supporterThreadId } = req.body;
    const files = req.files || [];

    try {
      const fullInput = input.trim();
      const spaceIndex = fullInput.indexOf(' ');
      let genderEmoji = "";
      let charName = fullInput;
      if (spaceIndex !== -1) {
        genderEmoji = fullInput.substring(0, spaceIndex).trim();
        charName = fullInput.substring(spaceIndex + 1).trim();
      }

      let roleMention = "";
      const appliedTags = [];
      if (genderEmoji.includes('female_sign') || genderEmoji === '♀️') {
        roleMention = '<@&1465968041404928177>';
        appliedTags.push('1465939610642415921');
      } else if (genderEmoji.includes('male_sign') || genderEmoji === '♂️') {
        roleMention = '<@&1465967964804350160>';
        appliedTags.push('1465939591352680488');
        appliedTags.push('1467020371428642957');
      }

      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const forumChannel = await guild.channels.fetch(SUPPORTER_FORUM_ID);

      const suffixStr = suffix ? ` — ${suffix}` : '';
      const threadTitle = `[${series.toUpperCase()}] ${charName} — Pack #${pack}${suffixStr}`;
const messageBody = `:underage: NEW SUPPORTER RELEASE
${roleMention || ''}
━━━━━━━━━━━━━━
Character: ${charName}
Set size: ${setSize} images
Content: Explicit (18+)

:inbox_tray: Download:
:link: **[megaLink](${download || 'https://mega.nz'})**`; 
      
      let supporterResult = {};
      if (supporterThreadId) {
        const thread = await client.channels.fetch(supporterThreadId);
        if (!thread) return res.status(404).json({ error: "Thread not found" });

        await thread.setName(threadTitle);
        await thread.setAppliedTags(appliedTags, `Updating tags for supporter release`);

        const starter = await thread.fetchStarterMessage();
        if (starter) {
          await starter.edit({
            content: messageBody,
            flags: ["SuppressEmbeds"]
          });
        }

        if (files.length > 0) {
          const attachments = files.map(f => ({ attachment: f.buffer, name: f.originalname }));
          const sent = await thread.send({ content: "📸 **Updated images:**", files: attachments });
          await sent.edit({ flags: ["SuppressEmbeds"] });
        }
        supporterResult = { updated: true };
      } else {
const newThread = await forumChannel.threads.create({
    name: threadTitle,
    appliedTags: appliedTags.length > 0 ? appliedTags : undefined,
    message: { content: messageBody, files: files.map(f => ({ attachment: f.buffer, name: f.originalname })) }
});
        const starter = await newThread.fetchStarterMessage();
        if (starter) {
          await starter.edit({ flags: ["SuppressEmbeds"] });
        }
        supporterResult = { created: true };
      }

      // --- Update Preview Thread if Toggle is ON ---
      let previewResult = {};
      if (editPreview === 'true') {
        let targetPreviewId = previewThreadId;

        if (!targetPreviewId && supporterThreadId) {
          try {
            const previewForum = await guild.channels.fetch(FORUM_ID);
            const threads = await previewForum.threads.fetchActive();
            const seriesUpper = series.toUpperCase();
            const packPattern = `Pack #${pack}`;
            const matchingThread = threads.threads.find(t =>
              t.name.includes(`[${seriesUpper}]`) && t.name.includes(packPattern)
            );

            if (matchingThread) {
              targetPreviewId = matchingThread.id;
              console.log(`Auto-matched preview thread: ${matchingThread.name} (${matchingThread.id})`);
            } else {
              console.warn('No matching preview thread found for auto-update.');
              previewResult = { previewError: 'No matching preview thread found' };
            }
          } catch (findErr) {
            console.error('Error finding preview thread:', findErr);
            previewResult = { previewError: findErr.message };
          }
        }

        if (targetPreviewId) {
          try {
            const previewThread = await client.channels.fetch(targetPreviewId);
            if (!previewThread) {
              console.warn("Preview thread not found:", targetPreviewId);
              previewResult = { previewError: "Preview thread not found" };
            } else {
              // Unarchive if archived
              if (previewThread.archived) {
                await previewThread.setArchived(false);
                console.log(`Unarchived preview thread ${targetPreviewId}`);
              }

              let newTitle = previewThread.name;
              if (newTitle.includes(' — SOON')) {
                newTitle = newTitle.replace(' — SOON', '');
                await previewThread.setName(newTitle);
              }

              const starter = await previewThread.fetchStarterMessage();
              if (starter) {
                let newContent = starter.content;
                const setSizeRegex = /Set size:\s*\d+\s*images/i;
                const setSizeSoonRegex = /Set size:\s*XX\s*images/i;
                if (setSizeRegex.test(newContent) || setSizeSoonRegex.test(newContent)) {
                  newContent = newContent.replace(/(Set size:\s*)(\d+|XX)(\s*images)/i, `$1${setSize}$3`);
                }
                if (newContent.includes(':new: NEW RELEASE -- SOON')) {
                  newContent = newContent.replace(':new: NEW RELEASE -- SOON', ':new: NEW RELEASE');
                }
                await starter.edit(newContent);
              }
              previewResult = { previewUpdated: true };
            }
          } catch (previewErr) {
            console.error('Error updating preview thread:', previewErr);
            previewResult = { previewError: previewErr.message };
          }
        }
      }

      res.json({ success: true, ...supporterResult, ...previewResult });

    } catch (err) {
      console.error('Supporter release error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ────────────────────────────────────────────────
  // 13. MEGA UPLOAD (with month folder and progress)
  // ────────────────────────────────────────────────
  app.post('/api/upload-to-mega', upload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!req.file.originalname.toLowerCase().endsWith('.zip')) {
      return res.status(400).json({ error: 'Only ZIP files are allowed' });
    }

    if (req.file.size > 100 * 1024 * 1024) {
      return res.status(400).json({ error: 'File exceeds 100MB limit' });
    }

    const megaEmail = process.env.MEGA_EMAIL;
    const megaPassword = process.env.MEGA_PASSWORD;
    if (!megaEmail || !megaPassword) {
      console.error('MEGA credentials not set in environment');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const desiredFileName = req.file.originalname;
    const month = req.body.month; // e.g., "MAR-26"
    if (!month) {
      return res.status(400).json({ error: 'Month folder not provided' });
    }

    const yearShort = month.slice(-2);
    const year = `20${yearShort}`;
    const folderPath = ['Packs', year, month];

    async function getOrCreateFolder(node, pathParts) {
      let current = node;
      for (const part of pathParts) {
        let child = current.children.find(c => c.name === part && c.directory);
        if (!child) {
          child = await current.mkdir(part);
        }
        current = child;
      }
      return current;
    }

    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `mega-upload-${Date.now()}-${desiredFileName}`);

    try {
      fs.writeFileSync(tempFilePath, req.file.buffer);

      const storage = await new Storage({
        email: megaEmail,
        password: megaPassword
      }).ready;

      const targetFolder = await getOrCreateFolder(storage.root, folderPath);

      const readStream = fs.createReadStream(tempFilePath);

      const uploadResult = await new Promise((resolve, reject) => {
        const upload = targetFolder.upload({
          name: desiredFileName,
          size: req.file.size
        }, readStream);

        upload.on('error', reject);
        upload.on('complete', (file) => resolve(file));
      });

      console.log('📤️[MEGA] Upload complete');

      const link = await uploadResult.link();

      fs.unlinkSync(tempFilePath);
      storage.close();

      res.json({ success: true, link });
    } catch (error) {
      console.error('MEGA upload error:', error);
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      res.status(500).json({ error: error.message || 'Upload failed' });
    }
  });

  // ────────────────────────────────────────────────
  // 14. TEST ZIP (extract first 10 images, sorted by embedded number)
  // ────────────────────────────────────────────────
  app.post('/api/test-zip', upload.single('zipfile'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (req.file.size > 100 * 1024 * 1024) {
      return res.status(400).json({ error: 'File exceeds 100MB limit' });
    }

    try {
      const zip = new AdmZip(req.file.buffer);
      const entries = zip.getEntries();

      const imageEntries = entries.filter(entry => 
        /\.(jpg|jpeg|png|gif|webp)$/i.test(entry.entryName) && !entry.isDirectory
      );

      imageEntries.sort((a, b) => {
        const regex = /-(\d{3})-/;
        const aMatch = a.entryName.match(regex);
        const bMatch = b.entryName.match(regex);
        const aNum = aMatch ? parseInt(aMatch[1], 10) : 0;
        const bNum = bMatch ? parseInt(bMatch[1], 10) : 0;
        return aNum - bNum;
      });

      const totalImages = imageEntries.length;
      const previewImages = imageEntries.slice(0, 10).map(entry => ({
        name: entry.entryName.split('/').pop(),
        data: `data:image/jpeg;base64,${entry.getData().toString('base64')}`
      }));

      res.json({ success: true, images: previewImages, total: totalImages });
    } catch (err) {
      console.error('Test zip error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Temporary GET for testing – remove after debugging
  app.get('/api/test-zip', (req, res) => {
    res.json({ message: 'GET works' });
  });
};
