// this is poll-san/web/routes/poll.js

module.exports = function setupPollRoutes(app, client, supabase, supabaseRetry) {
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
                guildId: process.env.GUILD_ID,
                isChatInputCommand: () => true,
                isCommand: () => true
            };
            await supabaseRetry(() => supabase.from('final_votes').delete().neq('option_id', 0));
            startPollLogic(mockInteraction);
            res.json({ success: true });
        } catch (err) {
            console.error('Trigger poll error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ────────────────────────────────────────────────
    // POLL RESULTS DATA (for dashboard)
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
// STOP POLL - Clean version with RPC
// ────────────────────────────────────────────────
app.post('/api/stop-poll', async (req, res) => {
    try {
        // Use RPC - this runs as SECURITY DEFINER and bypasses RLS issues
        const { error: rpcError } = await supabaseRetry(() =>
            supabase.rpc('truncate_poll_tables')
        );

        if (rpcError) {
            console.error('RPC truncate error:', rpcError);
            throw rpcError;
        }

 //       console.log('All poll tables truncated via RPC');

        // Invalidate dashboard cache
        cachedPollResultsData = null;
        cachedPollResultsTime = 0;

        console.log('All poll tables cleared and cache invalidated');
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
        try {
            const { data: poll } = await supabaseRetry(() =>
                supabase.from('auto_resume')
                    .select('*')
                    .order('id', { ascending: false })
                    .limit(1)
                    .single()
            );
            if (!poll) return res.status(404).json({ error: "No active poll." });

            await supabaseRetry(() =>
                supabase.from('final_votes')
                    .update({ selected_at: new Date().toISOString() })
                    .filter('character_name', 'ilike', `%${winner_name}%`)
            );

            const { data: voteData } = await supabaseRetry(() =>
                supabase.from('final_votes')
                    .select('character_name, score, selected_at')
                    .order('option_id', { ascending: true })
            );

            const channel = await client.channels.fetch(poll.channel_id);
            const pollMessage = await channel.messages.fetch(poll.message_id);
            const thread = pollMessage.thread;
            if (!thread) return res.status(404).json({ error: "Thread not found." });

            const emojisArr = [
                '<:one:1485655941520167062>',
                '<:two:1485655967436767252>',
                '<:three:1485655981194215505>',
                '<:four:1487623282722344970>',
                '<:five:1487623335306072297>',
                '<:six:1485656011040620654>',
                '<:seven:1485656023061627060>',
                '<:eight:1487623383897210961>',
                '<:nine:1487623395053932636>',
                '<:ten:1485656068943253786>',
                '<:eleven:1485656186060542104>',
                '<:twelve:1485656217194991667>'
            ];

            const characters = poll.poll_list
                .split(/(?=:female_sign:|:male_sign:|♀️|♂️|\n)/)
                .map(s => s.trim().replace(/:female_sign:/g, '♀️').replace(/:male_sign:/g, '♂️'))
                .filter(s => s.length > 1);

            let scoreboard = `:trophy: **${winner_name}** has been marked as a winner! :tada:\n\n`;
            characters.forEach((char, index) => {
                const emoji = emojisArr[index] || `[${index + 1}]`;
                const record = voteData.find(v => {
                    const cleanChar = char.replace(/♀️|♂️/g, '').trim().toLowerCase();
                    const cleanRecord = v.character_name.replace(/♀️|♂️/g, '').trim().toLowerCase();
                    return cleanChar === cleanRecord;
                });
                const score = record ? parseFloat(record.score).toFixed(1) : "0.0";
                const isWinner = record && record.selected_at !== null;
                const line = `${emoji} = ${score} -- ${char}`;
                scoreboard += isWinner ? `||${line}||\n` : `${line}\n`;
            });

            await thread.send(scoreboard);
            res.json({ success: true });
        } catch (err) {
            console.error('Mark winner error:', err);
            res.status(500).json({ error: err.message });
        }
    });
};
