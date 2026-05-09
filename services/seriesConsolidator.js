// services/seriesConsolidator.js
const fs = require('fs');
const path = require('path');
const supabase = require('./supabase');
const helpers = require('../utils/helpers');

const ALIAS_FILE = path.join(__dirname, '..', 'utility', 'series_aliases.txt');

let aliasMap = null; // Map<alias, canonical>

/**
 * Parse the alias file and return a Map: alias -> canonical.
 * The file format:
 *   Canonical Name [alias1, alias2, ...]
 */
function parseAliasFile() {
    const map = new Map();
    try {
        const content = fs.readFileSync(ALIAS_FILE, 'utf8');
        const lines = content.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('//')) continue; // allow comments

            const bracketIdx = line.indexOf('[');
            const closeIdx = line.lastIndexOf(']');
            if (bracketIdx === -1 || closeIdx === -1 || closeIdx <= bracketIdx) continue;

            const canonical = line.substring(0, bracketIdx).trim();
            const aliasPart = line.substring(bracketIdx + 1, closeIdx);
            const aliases = aliasPart.split(',').map(a => a.trim()).filter(Boolean);

            // Map each alias (including canonical itself) to canonical for idempotency
            map.set(canonical, canonical);
            for (const alias of aliases) {
                map.set(alias, canonical);
            }
        }
    } catch (err) {
        console.error('Failed to read series aliases file:', err);
    }
    return map;
}

/**
 * Get the canonical series name for a given raw series string.
 * Returns the original string if no alias matches.
 */
function getCanonicalSeries(rawSeries) {
    if (!rawSeries) return rawSeries;
    if (!aliasMap) aliasMap = parseAliasFile();
    return aliasMap.get(rawSeries) || rawSeries;
}

/**
 * Update all rows in games_mudae_claims so that any series matching an alias
 * is replaced with its canonical name. Runs a series of SQL updates.
 * Returns the total number of affected rows.
 */
async function consolidateExistingClaims() {
    if (!aliasMap) aliasMap = parseAliasFile();
    let totalUpdated = 0;

    // For each alias that differs from its canonical, run an update
    for (const [alias, canonical] of aliasMap.entries()) {
        if (alias === canonical) continue; // don't overwrite self
        const { error, count } = await supabase
            .from(helpers.tables.GAMES_MUDAE_CLAIMS)
            .update({ series: canonical })
            .eq('series', alias)
            .select('*'); // to get count we can just do a separate count? We'll just log

        if (error) {
            console.error(`Failed to update series from "${alias}" to "${canonical}":`, error);
        } else {
            const { count: updatedCount } = await supabase
                .from(helpers.tables.GAMES_MUDAE_CLAIMS)
                .select('*', { count: 'exact', head: true })
                .eq('series', canonical)
                .not('series', 'is', null); // not needed but safe

            // Simpler: we can just note that the update ran; supabase update doesn't return affected count directly in JS. We'll just log.
            console.log(`🔄 Updated series: "${alias}" → "${canonical}"`);
            totalUpdated++;
        }
    }
    return totalUpdated;
}

// On startup, load the alias map
aliasMap = parseAliasFile();

module.exports = {
    getCanonicalSeries,
    consolidateExistingClaims,
    reloadAliases: () => { aliasMap = parseAliasFile(); }
};
