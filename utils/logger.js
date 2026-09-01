// utils/logger.js

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
    // Combine all logs into a single context
    const context = {
      logs: logs.map(({ level, message, stack, timestamp }) => ({
        level,
        message,
        stack: stack || '',
        timestamp,
      })),
    };
    // For the main error, take the last non‑ignored log (or the first error)
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
    // Capture the error object and stack
    let msg = '';
    let stack = '';
    for (const arg of args) {
      if (arg instanceof Error) {
        msg += (arg.message || '') + ' ';
        stack = arg.stack || '';
      } else {
        msg += String(arg) + ' ';
      }
    }
    msg = msg.trim();
    originalError(...args);
    addLog('error', msg, stack);
  };

  process.on('uncaughtException', (err) => {
    addLog('error', `Uncaught Exception: ${err.message}`, err.stack);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : '';
    addLog('error', `Unhandled Rejection: ${msg}`, stack);
  });

  process.on('exit', () => flushBuffer());
}

module.exports = { initLogger, addLog };
