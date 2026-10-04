// utils/logger.js
const util = require('util');

const LOG_WORKER_URL = 'https://error-logger.velutinx.workers.dev/log';
const IGNORE_PATTERNS = [
  /✅ (D1|KV) (cache|entrants)/i,
  /✅ D1:/i,
  /✅ Poll (Live|started)/i,
  /✅ Queue updated: .* marked as completed\./i,
  /✅ Queue updated: .*/i,
  /✅ Reminder sent/i,
  /✅ Reminder sent and stored for giveaway/i,
  /✅ Reminder sent for giveaway/i,
  /✅ Uploaded to Mega:/i,
  /✅ \[GiveawayReminder\] Sent reminder for giveaway .+/i,
  /⚠️ D1 (query|network) error \(attempt \d\/\d\), retrying in .+ms/i,
  /⏩ Duplicate/i,
  /⏭️ Skipping/i,
  /🗑️ Deleted reminder message .+ for giveaway .+/i,
  /🗳️ Vote (Recorded|Removed)/i,
  /🧹 (Cleared stale poll_settings|Reset reminder columns)/i,
  /📋 .* to queue/i,
  /📋 Added .* to queue/i,
  /📋 Added winner to queue:/i,
  /📝 Recorded:/i,
  /🔍 SQL:/i,
  /> discord-bot@1\.0\.0 start/i,
  /D1: Recorded poll/i,
  /Dashboard running at/i,
  /node --dns-result-order=ipv4first index\.js/i,
  /npm warn/i,
  /Restoring giveaway/i,
  /Starting Container/i,
  /Starting giveaway ID:/i,
  /\[AvatarScan\] .*/i,
  /\[Database\] Slow query .*/i,
  /\[MassScan\] .*/i,
  /\[MembershipSync\] Added Member to .+ \(was roleless\)/i,
  /\[MembershipSync\] Fixed roles for \d+ members?\./i,
  /\[MembershipSync\] Full enforcement scan skipped \(cooldown active\)\./i,
  /\[MembershipSync\] Inactive user \d+ not found in guild, skipping\./i,
  /\[MembershipSync\] Skipping inactive Creator .+ \(\d+\)/i,
  /\[MembershipSync\] Skipping role sync for Creator .+/i,
  /\[MembershipSync\] ✅ DM sent to .+ \(lang: .+\)/i,
  /\[MonthlyScan\] .*/i,
  /\[PollReminders\] .*/i,
  /\[Queue\] .*/i,
  /\[RoleManager\] .*/i,
];
let logBuffer = [];
let flushTimer = null;
const FLUSH_INTERVAL = 2000;
const MAX_BUFFER_SIZE = 50;

function shouldIgnore(message) {
  return IGNORE_PATTERNS.some(pattern => pattern.test(message));
}

function isTransientNetworkError(err) {
  if (!(err instanceof Error)) return false;
  const causeCode = err.cause?.code;
  if (
    causeCode === 'UND_ERR_CONNECT_TIMEOUT' ||
    causeCode === 'UND_ERR_SOCKET' ||
    causeCode === 'ECONNRESET' ||
    causeCode === 'ETIMEDOUT'
  ) {
    return true;
  }

  if (err.message && err.message.includes('fetch failed') &&
      (err.message.includes('Connect Timeout') || err.message.includes('ECONNRESET'))) {
    return true;
  }
  return false;
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

    if (isTransientNetworkError(err)) return;

    // util.inspect prints the entire error object natively
    const fullTrace = util.inspect(err, { depth: null });
    addLog('error', `Uncaught Exception: ${err.message}`, fullTrace);
  });

  process.on('unhandledRejection', (reason) => {

    if (isTransientNetworkError(reason)) return;

    const shortMsg = reason instanceof Error ? reason.message : String(reason);
    const fullTrace = reason instanceof Error ? util.inspect(reason, { depth: null }) : String(reason);
    addLog('error', `Unhandled Rejection: ${shortMsg}`, fullTrace);
  });

  process.on('exit', () => flushBuffer());
}

module.exports = { initLogger, addLog };
