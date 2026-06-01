// services/queueService.js

const db = require('./database');           // D1 client
const helpers = require('../utils/helpers');

const QUEUE_CHANNEL_ID = helpers.ids?.channels?.QUEUE || '1473730427318435860';
const EMOJIS = helpers.emojis || [];
const PROGRESS_EMOJI = helpers.releaseEmojis?.PROGRESS || '<a:progress:1491670111923212308>';

async function getQueueData() {
    const row = await db.query(
        `SELECT * FROM ${helpers.tables.MAIN_QUEUE} WHERE id = ?`,
        ['main_queue'],
        true   // single row
    );

    if (!row) return { queue: '[]', message_id: null };

    return {
        queue: row.queue || '[]',
        message_id: row.message_id || null
    };
}

function formatQueue(queueArr) {
    const header = `${PROGRESS_EMOJI} **Current Queue:**\n\n`;

    if (!queueArr || queueArr.length === 0) {
        return `${header}*The queue is currently empty.*`;
    }
    
    let str = header;
    queueArr.forEach((char, i) => {
        const emoji = EMOJIS[i] || `[${i + 1}]`;
        const cleanChar = char.replace(/♀️/g, ':female_sign:').replace(/♂️/g, ':male_sign:');
        str += `${emoji} ${cleanChar}\n`;
    });
    return str;
}

async function updateQueueMessage(client, queueArr, existingMessageId) {
    try {
        const channel = await client.channels.fetch(QUEUE_CHANNEL_ID);
        const content = formatQueue(queueArr);
        let newMessageId = existingMessageId;

        if (existingMessageId) {
            try {
                const msg = await channel.messages.fetch(existingMessageId);
                await msg.edit(content);
            } catch (e) {
                const sent = await channel.send(content);
                newMessageId = sent.id;
            }
        } else {
            const sent = await channel.send(content);
            newMessageId = sent.id;
        }

        await db.query(
            `INSERT INTO ${helpers.tables.MAIN_QUEUE} (id, queue, message_id, channel_id, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               queue = excluded.queue,
               message_id = excluded.message_id,
               channel_id = excluded.channel_id,
               updated_at = excluded.updated_at`,
            [
                'main_queue',
                JSON.stringify(queueArr),
                newMessageId,
                QUEUE_CHANNEL_ID,
                new Date().toISOString()
            ]
        );
    } catch (err) {
        console.error('Queue Service Critical Error:', err);
    }
}

module.exports = { getQueueData, updateQueueMessage };
