// this is poll-san/web/routes/releases.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');
const { Storage } = require('megajs');
const helpers = require('../../utils/helpers');

module.exports = function setupReleasesRoutes(app, client, upload, FORUM_ID, SUPPORTER_FORUM_ID) {
    // Pull constants from helpers
    const { releaseEmojis, ids } = helpers;
    
    // Header Helpers
    const PREVIEW_RELEASE_HEADER = `${releaseEmojis.NEW1}${releaseEmojis.NEW2} RELEASE`;
    const SUPPORTER_RELEASE_HEADER = `${releaseEmojis.EIGHTEEN} ${releaseEmojis.NEW1}${releaseEmojis.NEW2} SUPPORTER RELEASE`;

    // Arrow Helpers
    const getRandomArrow = () => releaseEmojis.ARROWS[Math.floor(Math.random() * releaseEmojis.ARROWS.length)];
    const getRandomDownArrow = () => releaseEmojis.DOWN_ARROWS[Math.floor(Math.random() * releaseEmojis.DOWN_ARROWS.length)];

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
            if (genderEmoji.includes('female_sign') || genderEmoji === '♀️') {
                appliedTags.push(ids.tags.preview_female);
            } else if (genderEmoji.includes('male_sign') || genderEmoji === '♂️') {
                appliedTags.push(...ids.tags.preview_male);
            }

            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const forumChannel = await guild.channels.fetch(FORUM_ID);

            const isSoon = setSize.toUpperCase() === 'XX';
            const suffixStr = suffix ? ` — ${suffix}` : '';
            const threadTitle = `[${series.toUpperCase()}] ${charName} — Pack #${pack}${suffixStr}`;
            
            const messageBody = `${PREVIEW_RELEASE_HEADER}${isSoon ? ' -- SOON' : ''}
━━━━━━━━━━━━━━
Character: ${charName}
Series: ${series}
Set size: ${setSize} images

:pushpin: SFW preview below

${getRandomArrow()} Full version for supporters
${getRandomArrow()} See <#${SUPPORTER_FORUM_ID}>`;

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
                    if (!newBody.includes(' -- SOON')) {
                        newBody = newBody.replace(PREVIEW_RELEASE_HEADER, `${PREVIEW_RELEASE_HEADER} -- SOON`);
                    }
                } else {
                    newBody = newBody.replace(`${PREVIEW_RELEASE_HEADER} -- SOON`, `${releaseEmojis.VERIFY} RELEASE`);
                    newBody = newBody.replace(PREVIEW_RELEASE_HEADER, `${releaseEmojis.VERIFY} RELEASE`);
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
    // 12. SUPPORTER RELEASE
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
                roleMention = `<@&${ids.roles.female_supporter}>`;
                appliedTags.push(ids.tags.supporter_female);
            } else if (genderEmoji.includes('male_sign') || genderEmoji === '♂️') {
                roleMention = `<@&${ids.roles.male_supporter}>`;
                appliedTags.push(...ids.tags.supporter_male);
            }

            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const forumChannel = await guild.channels.fetch(SUPPORTER_FORUM_ID);

            const suffixStr = suffix ? ` — ${suffix}` : '';
            const threadTitle = `[${series.toUpperCase()}] ${charName} — Pack #${pack}${suffixStr}`;
            
            const messageBody = `${SUPPORTER_RELEASE_HEADER}
${roleMention || ''}
━━━━━━━━━━━━━━
Character: ${charName}
Set size: ${setSize} images
Content: Explicit (18+)

${getRandomDownArrow()} **Download:**
${releaseEmojis.LINK} [megaLink](${download || 'https://mega.nz'})`;
      
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
                if (targetPreviewId) {
                    const previewThread = await client.channels.fetch(targetPreviewId);
                    if (previewThread) {
                        const starter = await previewThread.fetchStarterMessage();
                        if (starter) {
                            let newContent = starter.content;
                            newContent = newContent.replace(/(Set size:\s*)(\d+|XX)(\s*images)/i, `$1${setSize}$3`);
                            
                            if (newContent.includes(`${PREVIEW_RELEASE_HEADER} -- SOON`)) {
                                newContent = newContent.replace(`${PREVIEW_RELEASE_HEADER} -- SOON`, `${releaseEmojis.VERIFY} RELEASE`);
                            } else if (newContent.includes(PREVIEW_RELEASE_HEADER)) {
                                newContent = newContent.replace(PREVIEW_RELEASE_HEADER, `${releaseEmojis.VERIFY} RELEASE`);
                            }
                            newContent = newContent.replace(/ -- SOON/g, '');

                            await starter.edit(newContent);
                            previewResult = { previewUpdated: true };
                        }
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
    // 13. MEGA UPLOAD
    // ────────────────────────────────────────────────
    app.post('/api/upload-to-mega', upload.single('file'), async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        
        const desiredFileName = req.body.desiredName || req.file.originalname;
        const month = req.body.month;
        if (!month) return res.status(400).json({ error: 'Month folder not provided' });

        const year = `20${month.slice(-2)}`;
        const folderPath = ['Packs', year, month];

        async function getOrCreateFolder(node, pathParts) {
            let current = node;
            for (const part of pathParts) {
                let child = current.children.find(c => c.name === part && c.directory);
                if (!child) child = await current.mkdir(part);
                current = child;
            }
            return current;
        }

        const tempFilePath = path.join(os.tmpdir(), `mega-${Date.now()}-${desiredFileName}`);

        try {
            fs.writeFileSync(tempFilePath, req.file.buffer);
            const storage = await new Storage({ email: process.env.MEGA_EMAIL, password: process.env.MEGA_PASSWORD }).ready;
            const targetFolder = await getOrCreateFolder(storage.root, folderPath);
            const readStream = fs.createReadStream(tempFilePath);

            const uploadResult = await new Promise((resolve, reject) => {
                const upload = targetFolder.upload({ name: desiredFileName, size: req.file.size }, readStream);
                upload.on('error', reject);
                upload.on('complete', resolve);
            });

            const megaLink = await uploadResult.link();
            let localPath = null;

            if (req.body.downloadAfterUpload === 'true') {
                const downloadDir = req.body.localDownloadPath || './downloads/';
                if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
                const { File } = require('megajs');
                const megaFile = File.fromURL(megaLink);

                await new Promise((resolve, reject) => {
                    const localFileStream = fs.createWriteStream(path.join(downloadDir, desiredFileName));
                    megaFile.download((err, data) => {
                        if (err) return reject(err);
                        localFileStream.write(data);
                        localFileStream.end();
                        localFileStream.on('finish', resolve);
                    });
                });
                localPath = path.join(downloadDir, desiredFileName);
            }

            fs.unlinkSync(tempFilePath);
            storage.close();

            res.json({ success: true, link: megaLink, localPath, fileName: desiredFileName });
        } catch (error) {
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            res.status(500).json({ error: error.message });
        }
    });

  // ────────────────────────────────────────────────
  // 14. TEST ZIP
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

  // ────────────────────────────────────────────────
  // 15. DOWNLOAD FILE
  // ────────────────────────────────────────────────
  app.get('/api/download-file', (req, res) => {
    const filename = req.query.filename;
    if (!filename) {
      return res.status(400).send('Missing filename');
    }

    const downloadsDir = path.join(process.cwd(), 'downloads');
    const filePath = path.join(downloadsDir, filename);

    if (filePath.indexOf(downloadsDir) !== 0) {
      return res.status(403).send('Forbidden');
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }

    res.download(filePath, filename);
  });

  // ────────────────────────────────────────────────
  // 16. GET PREVIEW POSTS (Fixes Frontend 404)
  // ────────────────────────────────────────────────
  app.get('/api/preview-posts', async (req, res) => {
      try {
          const guild = await client.guilds.fetch(process.env.GUILD_ID);
          const channel = await guild.channels.fetch(FORUM_ID);
          const { threads } = await channel.threads.fetchActive();
          
          const posts = threads.map(t => ({ id: t.id, name: t.name }));
          res.json({ success: true, posts });
      } catch (err) {
          console.error('Fetch preview posts error:', err);
          res.status(500).json({ error: err.message });
      }
  });

  // ────────────────────────────────────────────────
  // 17. GET SUPPORTER POSTS (Fixes Frontend 404)
  // ────────────────────────────────────────────────
  app.get('/api/supporter-posts', async (req, res) => {
      try {
          const guild = await client.guilds.fetch(process.env.GUILD_ID);
          const channel = await guild.channels.fetch(SUPPORTER_FORUM_ID);
          const { threads } = await channel.threads.fetchActive();
          
          const posts = threads.map(t => ({ id: t.id, name: t.name }));
          res.json({ success: true, posts });
      } catch (err) {
          console.error('Fetch supporter posts error:', err);
          res.status(500).json({ error: err.message });
      }
  });

  // Temporary GET for testing – remove after debugging
  app.get('/api/test-zip', (req, res) => {
    res.json({ message: 'GET works' });
  });
};
