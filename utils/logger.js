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
  /\[Queue\] Added .* as premium\./i,
  /✅ Uploaded to Mega:/i,
  /\[RoleManager\] .*/i,
  // ─── NEW: Ignore D1 retry attempts (only care about final failure) ──
  /⚠️ D1 (query|network) error \(attempt \d\/\d\), retrying in .+ms/i,
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
    const payload = {
      worker: 'railway-bot',
      timestamp: new Date().toISOString(),
      error: logs.map(l => l.message).join('\n'),
      stack: '',
      url: '',
      method: '',
      context: JSON.stringify({ logs, level: 'info' })
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

function addLog(level, message) {
  if (shouldIgnore(message)) return;
  logBuffer.push({ level, message, timestamp: new Date().toISOString() });
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
    const msg = args.join(' ');
    originalError(...args);
    addLog('error', msg);
  };

  process.on('uncaughtException', (err) => {
    addLog('error', `Uncaught Exception: ${err.message}\n${err.stack}`);
  });

  process.on('unhandledRejection', (reason) => {
    addLog('error', `Unhandled Rejection: ${reason}`);
  });

  process.on('exit', () => flushBuffer());
}

module.exports = { initLogger, addLog };
