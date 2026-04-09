// this is poll-san/services/queueService.js

const supabase = require('./supabase');
const helpers = require('../utils/helpers'); // Import the whole object
const QUEUE_CHANNEL_ID = helpers.ids?.channels?.QUEUE || '1473730427318435860';
const EMOJIS = helpers.emojis;

async function getQueueData() {
    const { data, error } = await supabase
        .from('main_queue')
        .select('*')
        .eq('id', 'main_queue')
        .single();
    
    if (error && error.code !== 'PGRST116') console.error('Supabase Read Error:', error);
    return data || { queue: '[]', message_id: null };
}

function formatQueue(queueArr) {
    if (!queueArr || queueArr.length === 0) return "Current Queue:\n\n*The queue is currently empty.*";
    
    let str = "Current Queue:\n\n";
    queueArr.forEach((char, i) => {
        const emoji = EMOJIS[i] || `[${i + 1}]`;
        
        const cleanChar = char.replace(/♀️/g, ':female_sign:').replace(/♂️/g, ':male_sign:');
        str += `${emoji} ${cleanChar}\n`;
    });
    return str;
}

async function updateQueueMessage(client, queueArr, existingMessageId) {
    const channel = await client.channels.fetch(QUEUE_CHANNEL_ID);
    const content = formatQueue(queueArr);
    let newMessageId = existingMessageId;

    try {
        if (existingMessageId) {
            const msg = await channel.messages.fetch(existingMessageId);
            await msg.edit(content);
        } else {
            const sent = await channel.send(content);
            newMessageId = sent.id;
        }
    } catch (e) {
        const sent = await channel.send(content);
        newMessageId = sent.id;
    }

    const { error } = await supabase.from('main_queue').upsert({
        id: 'main_queue',
        queue: JSON.stringify(queueArr),
        message_id: newMessageId,
        channel_id: QUEUE_CHANNEL_ID,
        updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

    if (error) console.error('Supabase Write Error:', error);
}

module.exports = { getQueueData, updateQueueMessage };
