// services/kvSetup.js

const { setPollKv } = require('./pollService');
async function setupKv(client, env = null) {
    let kvClient = null;

    try {
        const binding = env?.POLL_KV || client.env?.POLL_KV;
        if (binding) {
            kvClient = binding;
            console.log('✅ KV client attached via Cloudflare binding (POLL_KV).');
        } else {
            const kvRestUrl = process.env.CLOUDFLARE_KV_REST_URL;
            const kvRestToken = process.env.CLOUDFLARE_KV_REST_TOKEN;
            if (kvRestUrl && kvRestToken) {
                kvClient = {
                    get: async (key) => {
                        const res = await fetch(`${kvRestUrl}/${key}`, {
                            headers: { 'Authorization': `Bearer ${kvRestToken}` }
                        });
                        if (!res.ok) return null;
                        return res.json();
                    },
                    put: async (key, value, opts = {}) => {
                        const res = await fetch(`${kvRestUrl}/${key}`, {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bearer ${kvRestToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: typeof value === 'string' ? value : JSON.stringify(value)
                        });
                        return res.ok;
                    },
                    delete: async (key) => {
                        const res = await fetch(`${kvRestUrl}/${key}`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${kvRestToken}` }
                        });
                        return res.ok;
                    }
                };
                console.log('✅ KV client attached via REST API fallback.');
            } else {
                console.warn('⚠️ No KV binding or REST URL provided – KV features disabled.');
                kvClient = null;
            }
        }
    } catch (err) {
        console.warn('⚠️ KV setup failed:', err.message);
        kvClient = null;
    }

    if (kvClient) {
        client.kv = kvClient;
        setPollKv(kvClient);
    } else {
        client.kv = null;
    }

    return kvClient;
}

module.exports = { setupKv };
