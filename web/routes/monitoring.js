// this is poll-san/web/routes/monitoring.js

const h = require('../../utils/helpers');

// ------------------------- CACHE -------------------------
let cachedData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ------------------------- HELPERS -------------------------
function parseCharacterList(pollList) {
    if (!pollList) return [];
    const lines = pollList.split(/\r?\n/).filter(line => line.trim().length > 0);
    return lines.map(line => line.trim().replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️'));
}

async function fetchMembersWithRetry(getGuildMembers, guild, maxRetries = 3) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await getGuildMembers(guild);
        } catch (err) {
            lastError = err;
            const isRateLimit = err.code === 50001 ||
                                (err.message && err.message.includes('rate limited')) ||
                                (err.name === 'GatewayRateLimitError');
            if (isRateLimit && attempt < maxRetries - 1) {
                const delay = Math.pow(2, attempt) * 1000;
                console.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}

// ------------------------- ROUTES -------------------------
module.exports = function setupMonitoringRoutes(app, client, supabase, supabaseRetry, getGuildMembers) {

    app.get('/api/monitoring/members', async (req, res) => {
        const days = parseInt(req.query.days) || 10;

        // Check cache
        const now = Date.now();
        if (cachedData && (now - cacheTimestamp) < CACHE_TTL && cachedData.days === days) {
            return res.json(cachedData.members);
        }

        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            let members;

            try {
                if (typeof getGuildMembers === 'function') {
                    members = await fetchMembersWithRetry(getGuildMembers, guild);
                } else {
                    members = await guild.members.fetch({ withPresences: false });
                }
            } catch (err) {
                console.error('Member fetch failed after retries:', err);
                if (err.name === 'GatewayRateLimitError' || (err.message && err.message.includes('rate limited'))) {
                    return res.status(429).json({ error: 'Discord API rate limited. Please wait a moment and try again.' });
                }
                throw err;
            }

            // Fetch current poll list
            const { data: activePoll, error: pollError } = await supabaseRetry(() =>
                supabase.from('auto_resume')
                    .select('poll_list')
                    .order('id', { ascending: false })
                    .limit(1)
                    .single()
            );
            if (pollError) console.error('Poll fetch error:', pollError);

            let characterList = [];
            if (activePoll && activePoll.poll_list) {
                characterList = parseCharacterList(activePoll.poll_list);
            }

            // Fetch all votes
            const { data: votes, error: voteError } = await supabaseRetry(() =>
                supabase.from('votes_discord')
                    .select('user_id, option_id')
                    .eq('poll_id', 'character_poll_new')
            );
            if (voteError) console.error('Vote fetch error:', voteError);

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
                // Skip supporters
                if (member.roles.cache.has(h.ids.roles.supporter)) continue;

                let freshMember = member;
                try {
                    freshMember = await guild.members.fetch({ user: id, force: false });
                } catch (err) {
                    console.warn(`Failed to refresh member ${id}:`, err.message);
                }

                const joinedAt = freshMember.joinedTimestamp;
                const accountCreatedAt = freshMember.user.createdTimestamp;
                const daysSinceJoin = joinedAt ? Math.floor((now - joinedAt) / (24 * 60 * 60 * 1000)) : null;
                const accountAge = accountCreatedAt ? Math.floor((now - accountCreatedAt) / (24 * 60 * 60 * 1000)) : null;

                const isNew = (accountAge !== null && accountAge <= days) || (daysSinceJoin !== null && daysSinceJoin <= days);
                if (!isNew) continue;

                const vote = voteMap[id] || null;
                membersList.push({
                    userId: id,
                    username: freshMember.user.username,
                    nickname: freshMember.nickname || freshMember.user.username,
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

            // Store in cache
            cachedData = { members: membersList, days: days };
            cacheTimestamp = Date.now();

            res.json(membersList);
        } catch (err) {
            console.error('Monitoring fetch error:', err);
            res.status(500).json({ error: 'Failed to fetch members: ' + err.message });
        }
    });

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
            else console.error('Delete votes error:', deleteError);
        } catch (err) {
            console.error('Exception deleting votes:', err);
        }

        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch(userId);
            if (!member) return res.status(404).json({ error: 'Member not found' });
            await member.kick('Flagged as suspicious new account – poll votes removed');
            // Invalidate cache after a kick (so next load shows fresh data)
            cachedData = null;
            cacheTimestamp = 0;
            res.json({ success: true, message: `Kicked ${member.user.tag} and removed ${deletedVotes} poll vote(s)` });
        } catch (err) {
            console.error('Kick error:', err);
            res.status(500).json({ error: err.message });
        }
    });
};
