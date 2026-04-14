// this is poll-san/services/supabase.js

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    realtime: {
        transport: WebSocket,
        heartbeatIntervalMs: 15000,     // Send heartbeats more frequently
        timeout: 20000,                 // Shorter timeout for detection
        params: {
            heartbeat: true
        }
    }
});
module.exports = supabase;
