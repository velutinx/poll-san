const supabase = require('./supabase');
const QUEUE_CHANNEL_ID = '1473730427318435860';
// Updated with your custom emojis for 11 and 12
const EMOJIS = [':one:', ':two:', ':three:', ':four:', ':five:', ':six:', ':seven:', ':eight:', ':nine:', ':keycap_ten:', '<:eleven:1472456579742961744>', '<:twelve:1472456610457718845>'];

async function getQueueData() {
    // Explicitly fetching by the ID you used in your table
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
        // Replace symbols with strings for better Discord rendering
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
        // If message missing, send new one
        const sent = await channel.send(content);
        newMessageId = sent.id;
    }

    // Fixed Upsert: We use 'onConflict' to ensure it hits the same row
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