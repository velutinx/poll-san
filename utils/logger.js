// utils/logger.js
const util = require('util');

const LOG_WORKER_URL = 'https://error-logger.velutinx.workers.dev/log';
const IGNORE_PATTERNS = [
  /npm warn/i,
  /> discord-bot@1\.0\.0 start/i,
  /node --dns-result-order=ipv4first index\.js/i,
  /Starting Container/i,
  /Dashboard running at/i,
  /Restoring giveaway/i,
  /✅ Poll (Live|started)/i,
  /🗳️ Vote (Recorded|Removed)/i,
  /📝 Recorded:/i,
  /✅ (D1|KV) (cache|entrants)/i,
  /⏩ Duplicate/i,
  /⏭️ Skipping/i,
  /🔍 SQL:/i,
  /\[Queue\] .*/i,
  /✅ Queue updated: .* marked as completed\./i,
  /✅ Queue updated: .*/i,
  /✅ Uploaded to Mega:/i,
  /\[RoleManager\] .*/i,
  /⚠️ D1 (query|network) error \(attempt \d\/\d\), retrying in .+ms/i,
  /✅ D1:/i,
  /D1: Recorded poll/i,
  /\[MonthlyScan\] .*/i,
  /\[MassScan\] .*/i,
  /\[AvatarScan\] .*/i,
  /\[Database\] Slow query .*/i,
  /📋 Added winner to queue:/i,
  /📋 Added .* to queue/i,
  /📋 .* to queue/i,
  /✅ Reminder sent for giveaway/i,
  /Starting giveaway ID:/i,
  /✅ Reminder sent and stored for giveaway/i,
  /✅ Reminder sent/i,
  /🗑️ Deleted reminder message .+ for giveaway .+/i,
  /\[PollReminders\] .*/i,

  // ─── MembershipSync routine info logs ─────────────────────────
  //  These fire every 12h from the role-enforcement scan. They're
  //  expected, benign, and drown out real errors if not filtered.
  //  NOTE: we deliberately do NOT ignore all "[MembershipSync]" —
  //  the sync code also emits real failures (❌ Failed to fetch…,
  //  ❌ Error processing inactive user, ❌ Failed to send DM) that
  //  should still surface in the error dashboard.
  /\[MembershipSync\] Added Member to .+ \(was roleless\)/i,
  /\[MembershipSync\] Fixed roles for \d+ members?\./i,
  /\[MembershipSync\] Full enforcement scan skipped \(cooldown active\)\./i,
  /\[MembershipSync\] Inactive user \d+ not found in guild, skipping\./i,
  /\[MembershipSync\] Skipping role sync for Creator .+/i,
  /\[MembershipSync\] Skipping inactive Creator .+ \(\d+\)/i,
  /\[MembershipSync\] ✅ DM sent to .+ \(lang: .+\)/i,
];
let logBuffer = [];
let flushTimer = null;
const FLUSH_INTERVAL = 2000;
const MAX_BUFFER_SIZE = 50;

function shouldIgnore(message) {
  return IGNORE_PATTERNS.some(pattern => pattern.test(message));
}

async function sendLogsToWorker(logs) {
  if (!logs.length) return;
  try {
    const context = {
      logs: logs.map(({ level, message, stack, timestamp }) => ({
        level,
        message,
        stack: stack || '',
        timestamp,
      })),
    };
    const lastError = logs.find(l => l.level === 'error') || logs[logs.length - 1];
    const payload = {
      worker: 'railway-bot',
      timestamp: new Date().toISOString(),
      error: lastError ? lastError.message : 'Unknown error',
      stack: lastError ? lastError.stack || '' : '',
      url: '',
      method: '',
      context: JSON.stringify(context),
    };
    await fetch(LOG_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    // Ignore
  }
}

function flushBuffer() {
  if (logBuffer.length === 0) return;
  const copy = [...logBuffer];
  logBuffer = [];
  sendLogsToWorker(copy);
}

function addLog(level, message, stack = '') {
  if (shouldIgnore(message)) return;
  logBuffer.push({ level, message, stack, timestamp: new Date().toISOString() });
  if (logBuffer.length >= MAX_BUFFER_SIZE) {
    flushBuffer();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushBuffer();
    }, FLUSH_INTERVAL);
  }
}

function initLogger() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = function(...args) {
    const msg = args.join(' ');
    originalLog(...args);
    addLog('info', msg);
  };

  console.warn = function(...args) {
    const msg = args.join(' ');
    originalWarn(...args);
    addLog('warn', msg);
  };

  console.error = function(...args) {
    // 1. Get a short message for grouping on your website
    let shortMsg = '';
    const firstError = args.find(arg => arg instanceof Error);
    if (firstError) {
      shortMsg = firstError.message;
    } else {
      shortMsg = String(args[0]);
    }

    // 2. Use util.format to get the EXACT text Node/Railway prints, including [cause]
    const fullTrace = util.format(...args);

    originalError(...args);

    // 3. Send shortMsg as the message, and fullTrace as the stack
    addLog('error', shortMsg.trim(), fullTrace);
  };

  process.on('uncaughtException', (err) => {
    // util.inspect prints the entire error object natively
    const fullTrace = util.inspect(err, { depth: null });
    addLog('error', `Uncaught Exception: ${err.message}`, fullTrace);
  });

  process.on('unhandledRejection', (reason) => {
    const shortMsg = reason instanceof Error ? reason.message : String(reason);
    const fullTrace = reason instanceof Error ? util.inspect(reason, { depth: null }) : String(reason);
    addLog('error', `Unhandled Rejection: ${shortMsg}`, fullTrace);
  });

  process.on('exit', () => flushBuffer());
}

module.exports = { initLogger, addLog };
