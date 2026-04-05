const supabase = require('../services/supabase');
const { supabaseRetry } = require('../utils/db');

module.exports = async (member) => {
    try {
        const now = new Date().toISOString();
        const { data: giveaway, error } = await supabaseRetry(() =>
            supabase.from('giveaways')
                .select('*')
                .eq('ended', false)
                .gt('end_time', now)
                .maybeSingle()
        );
        if (error || !giveaway) return;

        let entrants = giveaway.entrants || [];
        if (entrants.includes(member.id)) {
            entrants = entrants.filter(id => id !== member.id);
            await supabaseRetry(() =>
                supabase.from('giveaways')
                    .update({ entrants })
                    .eq('message_id', giveaway.message_id)
            );
            console.log(`Removed ${member.user.tag} from active giveaway because they left the server.`);
        }
    } catch (err) {
        console.error('Error cleaning up giveaway on member leave:', err);
    }
};
