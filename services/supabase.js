// this is poll-san/services/supabase.js

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;   // Note: you used SUPABASE_KEY, not ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY environment variables');
    process.exit(1); // Stop if config is broken
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    realtime: {
        transport: WebSocket,           // This fixes the TIMED_OUT issue on Node 20
        heartbeatIntervalMs: 25000,
        timeout: 30000,
    }
});

console.log('✅ Supabase client initialized with WebSocket transport for better stability');

module.exports = supabase;
