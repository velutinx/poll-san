// web/routes/monitoring.js

const SUPPORTER_ROLE_ID = '1466155709547675795';

function parseCharacterList(pollList) {
    const lines = pollList.split(/\r?\n/).filter(line => line.trim().length > 0);
    return lines.map(line => line.trim().replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️'));
}

module.exports = function setupMonitoringRoutes(app, client, supabase, supabaseRetry, getGuildMembers) {
    
    // ────────────────────────────────────────────────
    // GET: Fetch Suspicious/New Members
    // ────────────────────────────────────────────────
    app.get('/api/monitoring/members', async (req, res) => {
        try {
            const days = parseInt(req.query.days) || 10;
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            
            // Assuming getGuildMembers is passed in from your main file
            // If not, you can replace this with: await guild.members.fetch()
            const members = await getGuildMembers(guild);
            const now = Date.now();

            const { data: activePoll } = await supabaseRetry(() =>
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

            const { data: votes, error: voteError } = await supabaseRetry(() =>
                supabase.from('votes_discord')
                    .select('user_id, option_id')
                    .eq('poll_id', 'character_poll_new')
            );
            if (voteError) console.error('Error fetching votes:', voteError);

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

            const membersList = [];
            for (const [id, member] of members) {
                if (member.roles.cache.has(SUPPORTER_ROLE_ID)) continue;

                const joinedAt = member.joinedTimestamp;
                const accountCreatedAt = member.user.createdTimestamp;
                const daysSinceJoin = joinedAt ? Math.floor((now - joinedAt) / (24 * 60 * 60 * 1000)) : null;
                const accountAge = accountCreatedAt ? Math.floor((now - accountCreatedAt) / (24 * 60 * 60 * 1000)) : null;

                const isNew = (accountAge !== null && accountAge <= days) || (daysSinceJoin !== null && daysSinceJoin <= days);
                if (!isNew) continue;

                const vote = voteMap[id] || null;
                membersList.push({
                    userId: id,
                    username: member.user.username,
                    nickname: member.nickname || member.user.username,
                    accountCreatedAt: accountCreatedAt ? new Date(accountCreatedAt).toISOString() : null,
                    accountAge: accountAge,
                    joinedAt: joinedAt ? new Date(joinedAt).toISOString() : null,
                    daysSinceJoin: daysSinceJoin,
                    voted: !!vote,
                    voteCharacter: vote ? vote.characterName : null,
                    voteOptionId: vote ? vote.option_id : null
                });
            }

            membersList.sort((a, b) => {
                const aRecent = Math.min(a.accountAge ?? Infinity, a.daysSinceJoin ?? Infinity);
                const bRecent = Math.min(b.accountAge ?? Infinity, b.daysSinceJoin ?? Infinity);
                return aRecent - bRecent;
            });

            res.json(membersList);
        } catch (err) {
            console.error('Monitoring fetch error:', err);
            res.status(500).json({ error: 'Failed to fetch members: ' + err.message });
        }
    });

    // ────────────────────────────────────────────────
    // POST: Kick Member and Remove Votes
    // ────────────────────────────────────────────────
    app.post('/api/monitoring/kick', async (req, res) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        let deletedVotes = 0;
        try {
            const { error: deleteError, count } = await supabaseRetry(() =>
                supabase.from('votes_discord')
                    .delete({ count: 'exact' })
                    .eq('user_id', userId)
                    .eq('poll_id', 'character_poll_new')
            );
            if (!deleteError) deletedVotes = count || 0;
        } catch (err) { 
            console.error(err); 
        }

        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch(userId);
            
            if (!member) return res.status(404).json({ error: 'Member not found' });
            
            await member.kick('Flagged as suspicious new account – poll votes removed');
            res.json({ success: true, message: `Kicked ${member.user.tag} and removed ${deletedVotes} poll vote(s)` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};
