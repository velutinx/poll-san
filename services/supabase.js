// this is poll-san/services/supabase.js

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const supabaseUrl = process.env.SUPABASE_URL;
// Use service role key if available, fallback to anon
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    realtime: {
        transport: WebSocket,
        heartbeatIntervalMs: 15000,
        timeout: 20000,
        params: { heartbeat: true }
    }
});
module.exports = supabase;
