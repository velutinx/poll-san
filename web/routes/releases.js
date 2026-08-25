// web/routes/releases.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const { Storage } = require('megajs');
const h = require('../../utils/helpers');
const { getMegaStorage } = require('../../services/megaSession');
const db = require('../../services/database');
const { updateDiscordQueue, getQueue } = require('./queue');
const TEST_CHANNEL_ID = '1466019839205314644';
const SERIES_NAME_MAP = {
  'RE-ZERO': 'Re:Zero',
  'STEINS-GATE': 'Steins;Gate',
  'FATE-GRAND-ORDER': 'Fate/Grand Order',
};
function getProperSeries(series) {
  const upper = series.toUpperCase();
  return SERIES_NAME_MAP[upper] || series;
}
function sortFilesByIndex(files) {
  return files.sort((a, b) => {
    const numA = parseInt((a.originalname.match(/-(\d+)\./))?.[1] || '0');
    const numB = parseInt((b.originalname.match(/-(\d+)\./))?.[1] || '0');
    return numA - numB;
  });
}
async function getFreeMembersByGender(guild, isFemale) {
  const CONTENT_ROLE_ID = isFemale ? h.ids.roles.female_supporter : h.ids.roles.male_supporter;
  const MEMBER_ROLE_ID = h.ids.roles.member;
  const SUPPORTER_ROLE_ID = h.ids.roles.supporter;
  const members = await guild.members.fetch();
  const targetIds = [];
  for (const [, member] of members) {
    if (member.user.bot) continue;
    const hasContentRole = member.roles.cache.has(CONTENT_ROLE_ID);
    const hasMember = member.roles.cache.has(MEMBER_ROLE_ID);
    const hasSupporter = member.roles.cache.has(SUPPORTER_ROLE_ID);
    if (hasContentRole && hasMember && !hasSupporter) {
      targetIds.push(member.id);
    }
  }
  return targetIds;
}
async function sendGhostPingToFreeMembers(client, guild, packInfo, threadId) {
  try {
    const targetIds = await getFreeMembersByGender(guild, packInfo.isFemale);
    if (targetIds.length === 0) {
      console.log(`No free ${packInfo.isFemale ? 'female' : 'male'} members to ping.`);
      return;
    }
    let channel;
    let isThread = false;
    if (threadId) {
      try {
        const thread = await client.channels.fetch(threadId);
        if (thread && thread.isThread()) {
          channel = thread.parent;
          isThread = true;
        } else {
          channel = thread;
        }
      } catch (e) {
        console.error(`Failed to fetch thread ${threadId}:`, e.message);
        channel = await client.channels.fetch(TEST_CHANNEL_ID).catch(() => null);
      }
    } else {
      channel = await client.channels.fetch(TEST_CHANNEL_ID).catch(() => null);
    }
    if (!channel) {
      console.error(`No valid channel found for ghost ping.`);
      return;
    }
    let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'New Release');
    if (!webhook) {
      webhook = await channel.createWebhook({
        name: 'New Release',
        avatar: h.urls.LOGO_URL
      });
    }
    const chunkSize = 50;
    const chunks = [];
    for (let i = 0; i < targetIds.length; i += chunkSize) {
      chunks.push(targetIds.slice(i, i + chunkSize));
    }
    for (const chunk of chunks) {
      const mentionString = chunk.map(id => `<@${id}>`).join(' ');
      const content = `📢 ${packInfo.pack ? `Pack ${packInfo.pack}` : 'New release'} ${packInfo.character || ''} was just released! ${mentionString}`;
      const sendOptions = {
        content,
        allowedMentions: { users: chunk },
        username: 'New Release',
        avatarURL: h.urls.LOGO_URL,
      };
      if (isThread && threadId) {
        sendOptions.threadId = threadId;
      }
      const sentMsg = await webhook.send(sendOptions);
      setTimeout(() => {
        sentMsg.delete().catch(() => {});
      }, 10000);
    }
  } catch (err) {
    console.error('Failed to send ghost ping:', err);
  }
}
async function markQueueCompleted(client, characterName, isRequest) {
  try {
    let queue = await getQueue();
    queue = queue.map(item => {
      if (typeof item === 'string') {
        return { text: item, checked: false, slashed: false, slashedAt: null };
      }
      return {
        text: item.text || item,
        checked: !!item.checked,
        slashed: !!item.slashed,
        slashedAt: item.slashedAt || null
      };
    });
    function cleanText(text) {
      if (!text) return '';
      return text
        .replace(/^[•:blank:diamond]?\s*/, '')
        .replace(/^[:]?male_sign[:]?\s*/, '')
        .replace(/^[:]?female_sign[:]?\s*/, '')
        .replace(/^[♂♀]️?\s*/, '')
        .replace(/^[:]?blank[:]?\s*/, '')
        .replace(/^[:]?diamond[:]?\s*/, '')
        .trim();
    }
    let found = false;
    const updatedQueue = queue.map(item => {
      const itemName = cleanText(item.text);
      if (itemName.toLowerCase() === characterName.toLowerCase()) {
        found = true;
        item.slashed = true;
        item.slashedAt = new Date().toISOString();
        item.checked = isRequest;
      }
      return item;
    });
    if (!found) {
      console.log(`[Queue] Character "${characterName}" not found – skipping update.`);
      for (const item of updatedQueue) {
        const cleanItem = cleanText(item.text);
        if (cleanItem.toLowerCase().includes(characterName.toLowerCase())) {
          found = true;
          item.slashed = true;
          item.slashedAt = new Date().toISOString();
          item.checked = isRequest;
          console.log(`[Queue] Found "${characterName}" in "${item.text}" – slashed.`);
          break;
        }
      }
    }
    if (!found) {
      console.log(`[Queue] Still not found after loose match.`);
      return;
    }
    await db.query(
      `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
      [JSON.stringify(updatedQueue)]
    );
    await updateDiscordQueue(client);
  } catch (err) {
    console.error('[Queue] Failed to mark as completed:', err);
  }
}
async function addPremiumToQueue(characterText, client) {
  try {
    let queue = await getQueue();
    queue = queue.map(item => {
      if (typeof item === 'string') {
        return { text: item, checked: false, slashed: false, slashedAt: null };
      }
      return {
        text: item.text || item,
        checked: !!item.checked,
        slashed: !!item.slashed,
        slashedAt: item.slashedAt || null
      };
    });
    const exists = queue.some(item => item.text === characterText);
    if (exists) {
      console.log(`[Queue] "${characterText}" already in queue, skipping.`);
      return;
    }
    queue.push({
      text: characterText,
      checked: true,
      slashed: false,
      slashedAt: null
    });
    await db.query(
      `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
      [JSON.stringify(queue)]
    );
    await updateDiscordQueue(client);
    console.log(`[Queue] Added "${characterText}" as premium.`);
  } catch (err) {
    console.error('[Queue] Failed to add premium entry:', err);
  }
}
module.exports = function setupReleasesRoutes(app, client, upload, FORUM_ID, SUPPORTER_FORUM_ID) {
  const LOGO_URL = h.urls.LOGO_URL;
  async function getWebhook(channel, name) {
    let webhook = (await channel.fetchWebhooks()).find(w => w.name === name);
    if (webhook) {
      if (webhook.name !== name || webhook.avatar !== LOGO_URL) {
        await webhook.edit({ name, avatar: LOGO_URL });
      }
      return webhook;
    }
    webhook = await channel.createWebhook({ name, avatar: LOGO_URL });
    return webhook;
  }
  async function editThreadMessage(thread, newContent) {
    try {
      const starter = await thread.fetchStarterMessage().catch(() => null);
      if (!starter) return { success: false, error: 'No starter message' };
      if (starter.webhookId) {
        const webhooks = await thread.parent.fetchWebhooks();
        const webhook = webhooks.find(w => w.id === starter.webhookId);
        if (webhook) {
          await webhook.editMessage(starter.id, { 
            content: newContent, 
            flags: ["SuppressEmbeds"],
            threadId: thread.id 
          });
          return { success: true };
        }
      }
      await starter.edit({ 
        content: newContent, 
        flags: ["SuppressEmbeds"] 
      });
      return { success: true };
    } catch (err) {
      console.error("Edit thread message failed, attempting final fallback send:", err);
        try {
        await thread.send({ 
          content: `${h.releaseEmojis?.ALERT || '⚠️'} **Update:**\n${newContent}`, 
          flags: ["SuppressEmbeds"] 
        });
        return { success: true, replaced: true };
      } catch (finalErr) {
        return { success: false, error: finalErr.message };
      }
    }
  }
  const getRandomArrow = () => h.releaseEmojis.ARROWS[Math.floor(Math.random() * h.releaseEmojis.ARROWS.length)];
  const getRandomDownArrow = () => h.releaseEmojis.DOWN_ARROWS[Math.floor(Math.random() * h.releaseEmojis.DOWN_ARROWS.length)];
  const PREVIEW_RELEASE_HEADER = `${h.releaseEmojis.NEW1}${h.releaseEmojis.NEW2} RELEASE`;
  const SUPPORTER_RELEASE_HEADER = `${h.releaseEmojis.EIGHTEENPLUS} ${h.releaseEmojis.NEW1}${h.releaseEmojis.NEW2} SUPPORTER RELEASE`;
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
      const seriesTrimmed = series.trim();
      const appliedTags = [];
      if (genderEmoji.includes('female_sign') || genderEmoji === '♀️') {
        appliedTags.push(h.ids.tags.preview_female);
      } else if (genderEmoji.includes('male_sign') || genderEmoji === '♂️') {
        appliedTags.push(...h.ids.tags.preview_male);
      }
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const forumChannel = await guild.channels.fetch(FORUM_ID);
      const isSoon = setSize.toUpperCase() === 'XX';
      const suffixStr = suffix ? ` — ${suffix}` : '';
      const threadTitle = `[${seriesTrimmed}] ${charName} — Pack #${pack}${suffixStr}`;

      const messageBody = `${PREVIEW_RELEASE_HEADER}${isSoon ? ' -- SOON' : ''}
━━━━━━━━━━━━━━
Character: ${charName}
Series: ${seriesTrimmed}
Set size: ${setSize} images
:pushpin: SFW preview below
${getRandomArrow()} Full version for supporters
${getRandomArrow()} See <#${SUPPORTER_FORUM_ID}>`;
      const webhook = await getWebhook(forumChannel, 'New Release');
      const sentMessage = await webhook.send({
        content: messageBody,
        files: files.map(f => ({ attachment: f.buffer, name: f.originalname })),
        threadName: threadTitle,
        appliedTags: appliedTags.length > 0 ? appliedTags : undefined,
        username: 'New Release',
        avatarURL: LOGO_URL,
        flags: ["SuppressEmbeds"],
      });
      const heartEmoji = h.releaseEmojis?.HEART || '💖';
      try {
        await sentMessage.react(heartEmoji);
      } catch (reactErr) {
        console.warn('Could not add heart reaction:', reactErr.message);
      }
      if (suffix && suffix.toLowerCase() === 'request') {
        await addPremiumToQueue(input, client);
      }
      res.json({ success: true });
    } catch (err) {
      console.error('Release preview error:', err);
      res.status(500).json({ error: err.message });
    }
  });
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
  app.post('/api/edit-post', async (req, res) => {
    const { threadId, pack, setSize, input, series, suffix } = req.body;
    try {
      const thread = await client.channels.fetch(threadId);
      if (!thread) return res.status(404).json({ error: "Thread not found" });
      const fullInput = input.trim();
      const spaceIndex = fullInput.indexOf(' ');
      let charName = spaceIndex !== -1 ? fullInput.substring(spaceIndex + 1).trim() : fullInput.trim();
      const seriesTrimmed = series.trim();
      const isSoon = setSize.toUpperCase() === 'XX';
      const suffixStr = suffix ? ` — ${suffix}` : '';
      const newTitle = `[${seriesTrimmed}] ${charName} — Pack #${pack}${suffixStr}${isSoon ? ' — SOON' : ''}`;
      await thread.setName(newTitle);
      const firstMsg = await thread.fetchStarterMessage();
      if (firstMsg) {
        let newBody = firstMsg.content
          .replace(/Character: .*/, `Character: ${charName}`)
          .replace(/Series: .*/, `Series: ${seriesTrimmed}`)
          .replace(/Set size: .* images/, `Set size: ${setSize} images`);
        if (isSoon) {
          if (!newBody.includes(' -- SOON')) {
            newBody = newBody.replace(PREVIEW_RELEASE_HEADER, `${PREVIEW_RELEASE_HEADER} -- SOON`);
          }
        } else {
          newBody = newBody.replace(`${PREVIEW_RELEASE_HEADER} -- SOON`, `${h.releaseEmojis.getRandomVerify()} RELEASE`);
          newBody = newBody.replace(PREVIEW_RELEASE_HEADER, `${h.releaseEmojis.getRandomVerify()} RELEASE`);
          newBody = newBody.replace(/ -- SOON/g, '');
        }
        await editThreadMessage(thread, newBody);
      }
      res.json({ success: true });
    } catch (err) {
      console.error('Edit post error:', err);
      res.status(500).json({ error: err.message });
    }
  });
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
      const seriesTrimmed = series.trim();
      const isFemale = genderEmoji.includes('female_sign') || genderEmoji === '♀️';
      let roleMention = "";
      const appliedTags = [];
      if (isFemale) {
        roleMention = `<@&${h.ids.roles.female_supporter}>`;
        appliedTags.push(h.ids.tags.supporter_female);
      } else if (genderEmoji.includes('male_sign') || genderEmoji === '♂️') {
        roleMention = `<@&${h.ids.roles.male_supporter}>`;
        appliedTags.push(...h.ids.tags.supporter_male);
      }
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const forumChannel = await guild.channels.fetch(SUPPORTER_FORUM_ID);
      const suffixStr = suffix ? ` — ${suffix}` : '';
      const threadTitle = `[${seriesTrimmed}] ${charName} — Pack #${pack}${suffixStr}`;
      const messageBody = `${SUPPORTER_RELEASE_HEADER}
${roleMention || ''}
━━━━━━━━━━━━━━
Character: ${charName}
Set size: ${setSize} images
Content: Explicit (${h.releaseEmojis.EIGHTEEN})
${getRandomDownArrow()} Download:
${h.releaseEmojis.LINK} [megaLink](${download || 'https://mega.nz'})`;
      let supporterResult = {};
      if (supporterThreadId) {
        const thread = await client.channels.fetch(supporterThreadId);
        if (!thread) return res.status(404).json({ error: "Thread not found" });
        await thread.setName(threadTitle);
        await thread.setAppliedTags(appliedTags, `Updating tags for supporter release`);
        const starter = await thread.fetchStarterMessage();
        if (starter) {
          await editThreadMessage(thread, messageBody);
        }
        if (files.length > 0) {
          const attachments = files.map(f => ({ attachment: f.buffer, name: f.originalname }));
          const sent = await thread.send({ content: `${getRandomDownArrow()} **Updated images:**`, files: attachments });
          await sent.edit({ flags: ["SuppressEmbeds"] });
        }
        supporterResult = { updated: true };
      } else {
        const webhook = await getWebhook(forumChannel, 'Release');
        const sentMessage = await webhook.send({
          content: messageBody,
          files: files.map(f => ({ attachment: f.buffer, name: f.originalname })),
          threadName: threadTitle,
          appliedTags: appliedTags.length > 0 ? appliedTags : undefined,
          username: 'Release',
          avatarURL: LOGO_URL,
          flags: ["SuppressEmbeds"],
        });
        const heartEmoji = h.releaseEmojis?.HEART || '💖';
        try {
          await sentMessage.react(heartEmoji);
        } catch (reactErr) {
          console.warn('Could not add heart reaction:', reactErr.message);
        }
        supporterResult = { created: true };
      }
      let targetPreviewId = null;
      let previewResult = {};
      if (editPreview === 'true') {
        targetPreviewId = previewThreadId;
        if (!targetPreviewId && supporterThreadId) {
          try {
            const previewForum = await guild.channels.fetch(FORUM_ID);
            const threads = await previewForum.threads.fetchActive();
            const seriesUpper = seriesTrimmed.toUpperCase();
            const packPattern = `Pack #${pack}`;
            const matchingThread = threads.threads.find(t =>
              t.name.includes(`[${seriesUpper}]`) && t.name.includes(packPattern)
            );
            if (matchingThread) targetPreviewId = matchingThread.id;
          } catch (findErr) {
            console.error('Error finding preview thread:', findErr);
          }
        }
        if (targetPreviewId) {
          try {
            const previewThread = await client.channels.fetch(targetPreviewId);
            if (previewThread) {
              if (previewThread.archived) await previewThread.setArchived(false);

              let newTitle = previewThread.name;
              if (newTitle.includes(' — SOON')) {
                newTitle = newTitle.replace(' — SOON', '');
                await previewThread.setName(newTitle);
              }

              const starter = await previewThread.fetchStarterMessage();
              if (starter) {
                let newContent = starter.content;
                newContent = newContent.replace(/(Set size:\s*)(\d+|XX)(\s*images)/i, `$1${setSize}$3`);

                const verifyEmoji = h.releaseEmojis.getRandomVerify();
                if (newContent.includes(`${PREVIEW_RELEASE_HEADER} -- SOON`)) {
                newContent = newContent.replace(`${PREVIEW_RELEASE_HEADER} -- SOON`, `${verifyEmoji} RELEASE`);
                } else if (newContent.includes(PREVIEW_RELEASE_HEADER)) {
                newContent = newContent.replace(PREVIEW_RELEASE_HEADER, `${verifyEmoji} RELEASE`);
                }
                newContent = newContent.replace(/ -- SOON/g, '');

                const editResult = await editThreadMessage(previewThread, newContent);
                if (editResult.success) {
                  previewResult = { previewUpdated: true };
                } else {
                  console.error('Could not update preview message:', editResult.error);
                }
              }
            }
          } catch (previewErr) {
            console.error('Error updating preview thread:', previewErr);
          }
        }
      }
      let targetThreadId = null;
      if (previewThreadId) {
        targetThreadId = previewThreadId;
      } else if (editPreview === 'true' && targetPreviewId) {
        targetThreadId = targetPreviewId;
      }
      try {
        if (targetThreadId) {
          await sendGhostPingToFreeMembers(client, guild, { pack, character: charName, isFemale }, targetThreadId);
        } else {
          await sendGhostPingToFreeMembers(client, guild, { pack, character: charName, isFemale }, TEST_CHANNEL_ID);
        }
      } catch (pingErr) {
        console.error('Ghost ping error:', pingErr);
      }
      const cleanCharName = charName.replace(/^[♂♀]️?\s*/, '').trim();
      if (cleanCharName) {
        const isRequest = suffix && suffix.toLowerCase() === 'request';
        await markQueueCompleted(client, cleanCharName, isRequest); 
      }
      try {
        const category = isFemale ? 1 : 2;
        const illustrationCount = parseInt(setSize, 10) || 0;
        const priceKey = illustrationCount <= 45 ? 'PRICE_1' : 'PRICE_2';
        const properSeries = getProperSeries(seriesTrimmed);
        const title = `[Pack ${pack}] ${charName} - ${properSeries}`;
        const websiteFormData = new FormData();
        websiteFormData.append('id', String(pack).padStart(3, '0'));
        websiteFormData.append('title', title);
        websiteFormData.append('category', category);
        websiteFormData.append('price', priceKey);
        websiteFormData.append('illustrationCount', illustrationCount);
        websiteFormData.append('downloadUrl', download || '');
        const imageFiles = files.map(f => new Blob([f.buffer], { type: f.mimetype || 'image/jpeg' }));
        imageFiles.forEach((blob, idx) => {
          const name = files[idx]?.originalname || `image_${idx}.jpg`;
          websiteFormData.append('images', blob, name);
        });
        await fetch('https://packs-api.velutinx.workers.dev/api/packs', {
          method: 'POST',
          body: websiteFormData,
          mode: 'cors'
        }).then(async resp => {
          if (resp.ok) {
          } else {
            const errText = await resp.text();
            console.warn(`⚠️ Website sync failed: ${resp.status} ${errText}`);
          }
        }).catch(err => {
          console.warn('⚠️ Website sync error (non-fatal):', err.message);
        });
      } catch (syncErr) {
        console.warn('⚠️ Website sync error (non-fatal):', syncErr.message);
      }
      res.json({ success: true, ...supporterResult, ...previewResult });
    } catch (err) {
      console.error('Supporter release error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  async function getOrCreateFolder(node, pathParts) {
    let current = node;
    for (const part of pathParts) {
      let child = current.children.find(c => c.name === part && c.directory);
      if (!child) child = await current.mkdir(part);
      current = child;
    }
    return current;
  }
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
    const desiredFileName = req.body.desiredName || req.file.originalname;
    const month = req.body.month;
    if (!month) return res.status(400).json({ error: 'Month folder not provided' });
    const yearShort = month.slice(-2);
    const year = `20${yearShort}`;
    const folderPath = ['Packs', year, month];
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `mega-upload-${Date.now()}-${desiredFileName}`);
    try {
      fs.writeFileSync(tempFilePath, req.file.buffer);
      const storage = await getMegaStorage();
      const targetFolder = await getOrCreateFolder(storage.root, folderPath);
      const readStream = fs.createReadStream(tempFilePath);
      const uploadResult = await new Promise((resolve, reject) => {
        const upload = targetFolder.upload({ name: desiredFileName, size: req.file.size }, readStream);
        upload.on('error', reject);
        upload.on('complete', resolve);
      });
      const megaLink = await uploadResult.link();
      console.log(`✅ Uploaded to Mega: ${megaLink}`);
      let localPath = null;
      if (req.body.downloadAfterUpload === 'true') {
        try {
          const downloadDir = req.body.localDownloadPath || './downloads/';
          if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
          const { File } = require('megajs');
          const megaFile = File.fromURL(megaLink);
          const localFile = path.join(downloadDir, desiredFileName);
          await new Promise((resolve, reject) => {
            const writeStream = fs.createWriteStream(localFile);
            megaFile.download((err, data) => {
              if (err) return reject(err);
              writeStream.write(data);
              writeStream.end();
              writeStream.on('finish', resolve);
              writeStream.on('error', reject);
            });
          });
          localPath = localFile;
        } catch (downloadErr) {
          console.warn('⚠️ Optional local download failed, continuing:', downloadErr.message);
        }
      }
      fs.unlinkSync(tempFilePath);
      res.json({
        success: true,
        link: megaLink,
        localPath: localPath,
        fileName: desiredFileName
      });
    } catch (error) {
      console.error('MEGA operation error:', error);
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      res.status(500).json({ error: error.message || 'Upload failed' });
    }
  });
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
        data: `data:image;jpeg;base64,${entry.getData().toString('base64')}`
      }));
      res.json({ success: true, images: previewImages, total: totalImages });
    } catch (err) {
      console.error('Test zip error:', err);
      res.status(500).json({ error: err.message });
    }
  });
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
  app.get('/api/test-zip', (req, res) => {
    res.json({ message: 'GET works' });
  });
};
