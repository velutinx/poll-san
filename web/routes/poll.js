// this is poll-san/web/routes/poll.js

module.exports = function setupPollRoutes(app, client, supabase, supabaseRetry) {
    const h = require('../../utils/helpers');
    const pollService = require('../../services/pollService');
    
    // Cache for poll results (shared between endpoints)
    let cachedPollResultsData = null;
    let cachedPollResultsTime = 0;
    const POLL_CACHE_TTL = 60000; // 1 minute

    // ────────────────────────────────────────────────
    // START POLL
    // ────────────────────────────────────────────────
    app.post('/api/trigger-poll', async (req, res) => {
        const { channel_id, days, character_list } = req.body;
        try {
            const channel = await client.channels.fetch(channel_id);
            const startPollLogic = require('../../commands/startpoll.js');
            
            const mockInteraction = {
                channel,
                guild: channel.guild,
                member: channel.guild.members.me,
                user: client.user,
                isDashboard: true,
                options: {
                    getInteger: (name) => name === 'days' ? parseInt(days) : null,
                    getString: (name) => name === 'list' ? character_list : null,
                    get: (name) => {
                        if (name === 'days') return { value: parseInt(days) };
                        if (name === 'list') return { value: character_list };
                        return null;
                    }
                },
                deferReply: async () => {},
                editReply: async () => {},
                reply: async () => {},
                followUp: async () => {},
                guildId: process.env.GUILD_ID || channel.guild.id,
                isChatInputCommand: () => true,
                isCommand: () => true
            };

            // Clear final votes before starting a fresh poll
            await supabaseRetry(() => supabase.from('final_votes').delete().neq('option_id', 0));
            
            startPollLogic(mockInteraction);
            res.json({ success: true });
        } catch (err) {
            console.error('Trigger poll error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ────────────────────────────────────────────────
    // POLL RESULTS DATA
    // ────────────────────────────────────────────────
    app.get('/api/poll-results-data', async (req, res) => {
        try {
            if (cachedPollResultsData && (Date.now() - cachedPollResultsTime) < POLL_CACHE_TTL) {
                return res.json(cachedPollResultsData);
            }
            const { data } = await supabaseRetry(() =>
                supabase.from('final_votes')
                    .select('character_name, score, selected_at')
                    .order('option_id', { ascending: true })
            );
            cachedPollResultsData = data || [];
            cachedPollResultsTime = Date.now();
            res.json(cachedPollResultsData);
        } catch (e) {
            console.error('Poll results error:', e);
            res.json(cachedPollResultsData || []);
        }
    });

    // ────────────────────────────────────────────────
    // STOP POLL
    // ────────────────────────────────────────────────
    app.post('/api/stop-poll', async (req, res) => {
        try {
            // 1. Physically stop the Node.js update interval
            pollService.forceStopPoll();

            // 2. Fetch the active poll to update the message UI to "Ended"
            const { data: poll } = await supabaseRetry(() =>
                supabase.from('auto_resume')
                    .select('*')
                    .order('id', { ascending: false })
                    .limit(1)
                    .single()
            );

            if (poll) {
                const channel = await client.channels.fetch(poll.channel_id);
                const pollMessage = await channel.messages.fetch(poll.message_id);
                
                // Update message to static "Ended" state
                const characters = poll.poll_list
                    .split(/(?=:female_sign:|:male_sign:|♀️|♂️|\n)/)
                    .map(s => s.trim())
                    .filter(s => s.length > 1);
                
                const results = await pollService.getPollResults(pollMessage, characters);
                const content = await pollService.generateMessageContent(0, results, characters, true);
                await pollMessage.edit({ content });
            }

            // 3. Clear the database records
            const { error: rpcError } = await supabaseRetry(() =>
                supabase.rpc('truncate_poll_tables')
            );
            if (rpcError) throw rpcError;

            cachedPollResultsData = null;
            cachedPollResultsTime = 0;
            res.json({ success: true });
        } catch (err) {
            console.error('Stop poll error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ────────────────────────────────────────────────
    // MARK WINNER
    // ────────────────────────────────────────────────
    app.post('/api/mark-winner', async (req, res) => {
        const { winner_name } = req.body;
        const e = h.releaseEmojis;

        try {
            const { data: poll } = await supabaseRetry(() =>
                supabase.from('auto_resume')
                    .select('*')
                    .order('id', { ascending: false })
                    .limit(1)
                    .single()
            );
            
            if (!poll) return res.status(404).json({ error: "No active poll found." });

            // Update winner status in database
            await supabaseRetry(() =>
                supabase.from('final_votes')
                    .update({ selected_at: new Date().toISOString() })
                    .filter('character_name', 'ilike', `%${winner_name}%`)
            );

            // ✅ Refresh the main Discord poll message (scoreboard) immediately
            await pollService.refreshActivePollMessage();

            // Fetch current standings for the thread scoreboard
            const { data: voteData } = await supabaseRetry(() =>
                supabase.from('final_votes')
                    .select('character_name, score, selected_at')
                    .order('option_id', { ascending: true })
            );

            const channel = await client.channels.fetch(poll.channel_id);
            const pollMessage = await channel.messages.fetch(poll.message_id);
            const thread = pollMessage.thread;
            
            if (!thread) return res.status(404).json({ error: "Thread not found." });

            const characters = poll.poll_list
                .split(/(?=:female_sign:|:male_sign:|♀️|♂️|\n)/)
                .map(s => s.trim().replace(/:female_sign:/g, '♀️').replace(/:male_sign:/g, '♂️'))
                .filter(s => s.length > 1);

            // Build the scoreboard
            let scoreboard = `:trophy: **${winner_name}** has been marked as a winner! ${e.CONFETTI}\n\n`;
            const v = poll.id; 

            characters.forEach((char, index) => {
                const imgNum = index + 1;
                const emoji = h.emojis[index] || `[${imgNum}]`;
                const record = voteData.find(v => {
                    const cleanChar = char.replace(/♀️|♂️/g, '').trim().toLowerCase();
                    const cleanRecord = v.character_name.replace(/♀️|♂️/g, '').trim().toLowerCase();
                    return cleanChar === cleanRecord;
                });
                
                const score = record ? parseFloat(record.score).toFixed(1) : "0.0";
                const isWinner = record && record.selected_at !== null;
                const imgLink = `https://www.velutinx.com/images/poll/${imgNum}.jpg?v=${v}`;
                const line = `${emoji} = ${score} -- ${char} \n${imgLink}`;
                scoreboard += isWinner ? `||${line}||\n\n` : `${line}\n\n`;
            });

            await thread.send(scoreboard);
            
            res.json({ success: true });
        } catch (err) {
            console.error('Mark winner error:', err);
            res.status(500).json({ error: err.message });
        }
    });
};
