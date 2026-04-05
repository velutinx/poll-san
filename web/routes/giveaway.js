const SUPPORTER_ROLE_ID = '1466155709547675795';

function parseCharacterList(pollList) {
    if (!pollList) return [];
    const lines = pollList.split(/\r?\n/).filter(line => line.trim().length > 0);
    return lines.map(line => line.trim().replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️'));
}

module.exports = function setupGiveawayRoutes(app, client, supabase, supabaseRetry) {
    
    // Get active giveaway and entrants with full details
    app.get('/api/giveaway/active', async (req, res) => {
        try {
            const now = new Date().toISOString();
            const { data: giveaway, error } = await supabaseRetry(() =>
                supabase.from('giveaways')
                    .select('*')
                    .eq('ended', false)
                    .gt('end_time', now)
                    .order('end_time', { ascending: true })
                    .limit(1)
                    .single()
            );
            if (error || !giveaway) {
                return res.json({ active: false });
            }

            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const entrants = giveaway.entrants || [];
            const entrantsDetails = [];

            // Get active poll data for vote info
            const { data: activePoll, error: pollError } = await supabaseRetry(() =>
                supabase.from('auto_resume')
                    .select('poll_list')
                    .order('id', { ascending: false })
                    .limit(1)
                    .single()
            );
            let characterList = [];
            if (activePoll && activePoll.poll_list) {
                characterList = parseCharacterList(activePoll.poll_list);
            }

            // Get votes for current poll
            const { data: votes, error: voteError } = await supabaseRetry(() =>
                supabase.from('votes_discord')
                    .select('user_id, option_id')
                    .eq('poll_id', 'character_poll_new')
            );
            const voteMap = {};
            if (votes) {
                for (const v of votes) {
                    const optId = v.option_id;
                    let characterName = null;
                    if (characterList.length >= optId && optId >= 1) {
                        characterName = characterList[optId - 1];
                    }
                    voteMap[v.user_id] = { option_id: optId, characterName };
                }
            }

            // Build entrants details with live member data
            for (const userId of entrants) {
                let member = null;
                let leftServer = false;
                let isSupporter = false;
                let nickname = userId;
                let username = userId;
                let accountAge = null;

                try {
                    member = await guild.members.fetch(userId).catch(() => null);
                    if (!member) {
                        leftServer = true;
                    } else {
                        nickname = member.nickname || member.user.username;
                        username = member.user.username;
                        accountAge = member.user.createdTimestamp
                            ? Math.floor((Date.now() - member.user.createdTimestamp) / (24 * 60 * 60 * 1000))
                            : null;
                        isSupporter = member.roles.cache.has(SUPPORTER_ROLE_ID);
                    }
                } catch (err) {
                    console.warn(`Failed to fetch member ${userId}:`, err.message);
                    leftServer = true;
                }

                const vote = voteMap[userId] || null;

                entrantsDetails.push({
                    userId,
                    username: leftServer ? `[LEFT] ${userId}` : username,
                    nickname: leftServer ? `[LEFT] ${userId}` : nickname,
                    accountAge,
                    voted: !!vote,
                    voteCharacter: vote ? vote.characterName : null,
                    isSupporter,
                    leftServer
                });
            }

            res.json({
                active: true,
                prize: giveaway.prize,
                endTime: giveaway.end_time,
                winnersCount: giveaway.winners_count,
                entrants: entrantsDetails
            });
        } catch (err) {
            console.error('Giveaway active endpoint error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/giveaway/remove', async (req, res) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        try {
            const now = new Date().toISOString();
            const { data: giveaway, error } = await supabaseRetry(() =>
                supabase.from('giveaways')
                    .select('*')
                    .eq('ended', false)
                    .gt('end_time', now)
                    .order('end_time', { ascending: true })
                    .limit(1)
                    .single()
            );
            if (error || !giveaway) {
                return res.status(404).json({ error: 'No active giveaway found' });
            }

            let entrants = giveaway.entrants || [];
            if (!entrants.includes(userId)) {
                return res.status(400).json({ error: 'User is not in this giveaway' });
            }

            entrants = entrants.filter(id => id !== userId);
            const { error: updateError } = await supabaseRetry(() =>
                supabase.from('giveaways')
                    .update({ entrants })
                    .eq('message_id', giveaway.message_id)
            );
            if (updateError) throw updateError;

            // Optional: delete their poll votes
            await supabaseRetry(() =>
                supabase.from('votes_discord')
                    .delete()
                    .eq('user_id', userId)
                    .eq('poll_id', 'character_poll_new')
            );

            res.json({ success: true, message: `Removed ${userId} from giveaway and deleted their poll votes` });
        } catch (err) {
            console.error('Giveaway remove error:', err);
            res.status(500).json({ error: err.message });
        }
    });
};
