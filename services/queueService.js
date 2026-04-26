// services/queueService.js

const supabase = require('./supabase');
const helpers = require('../utils/helpers');

const QUEUE_CHANNEL_ID = helpers.ids?.channels?.QUEUE || '1473730427318435860';
const EMOJIS = helpers.emojis || [];
const PROGRESS_EMOJI = helpers.releaseEmojis?.PROGRESS || '<a:progress:1491670111923212308>';

async function getQueueData() {
    const { data, error } = await supabase
        .from(helpers.tables.MAIN_QUEUE)   // 👈 changed
        .select('*')
        .eq('id', 'main_queue')
        .single();
    
    if (error && error.code !== 'PGRST116') console.error('Supabase Read Error:', error);
    return data || { queue: '[]', message_id: null };
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

        const { error } = await supabase.from(helpers.tables.MAIN_QUEUE).upsert({   // 👈 changed
            id: 'main_queue',
            queue: JSON.stringify(queueArr),
            message_id: newMessageId,
            channel_id: QUEUE_CHANNEL_ID,
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        if (error) console.error('Supabase Write Error:', error);
    } catch (err) {
        console.error('Queue Service Critical Error:', err);
    }
}

module.exports = { getQueueData, updateQueueMessage };
