/**
 * WebSocket server with timestamped-file logging and crash-safe flush.
 */
import { WebSocketServer } from 'ws';
import { UCIHandler } from './uci/uciHandler.js';
import logger, { LOG_CATEGORY, installNoopLogger } from './logging/logger.js';
import { loadOpeningBook, isBookLoaded, getBookStats } from './book/openingBook.js';

const __DEV__ = globalThis.__DEV__ ?? (process.env.NODE_ENV !== 'production');

if (!__DEV__) {
  installNoopLogger();
  console.log('[server] Production mode — NoopLogger installed');
} else {
  const logMask = parseInt(process.env.LOG_MASK || '0', 10);
  logger.setEnabledCategories(logMask);
  if (logMask !== 0) console.log(`[server] Dev mode — log mask 0x${logMask.toString(16)}`);
}

// ── Redirect engine console output to the log file ──
const _stdout = console.log.bind(console);
const _stderr = console.error.bind(console);
console.log  = (...args) => { const m = args.map(a => typeof a==='object'?JSON.stringify(a):String(a)).join(' '); logger.write(m); };
console.warn = (...args) => { const m = args.map(a => typeof a==='object'?JSON.stringify(a):String(a)).join(' '); logger.write(`[WARN] ${m}`); };
console.error= (...args) => { const m = args.map(a => typeof a==='object'?JSON.stringify(a):String(a)).join(' '); logger.write(`[ERROR] ${m}`); _stderr(...args); };

const PORT = process.env.PORT || 8080;

async function startServer() {
  _stdout('Chess Engine Server starting...');
  logger.write('Chess Engine Server starting');

  try {
    const bookInstance = await loadOpeningBook();
    if (bookInstance && isBookLoaded()) {
      const stats = getBookStats();
      _stdout(`[BOOK] Opening book ready (${stats.positions} positions)`);
      logger.write(`[BOOK] Opening book ready (${stats.positions} positions)`);
    } else {
      _stdout('[BOOK] Opening book not available');
    }
  } catch (err) {
    _stdout('Opening book not loaded:', err.message);
  }

  const wss = new WebSocketServer({ port: PORT });
  _stdout(`Chess Engine Server listening on port ${PORT}`);
  logger.write(`Server listening on port ${PORT}`);

  wss.on('connection', (ws, req) => {
    const clientAddr = req.socket.remoteAddress;
    logger.write(`Client connected from ${clientAddr}`);
    if (__DEV__) _stdout(`Client connected from ${clientAddr}`);

    const handler = new UCIHandler();

    ws.on('message', async (message) => {
      const line = message.toString().trim();
      if (!line) return;
      logger.write(`< ${line}`);

      try {
        const response = await handler.handleCommand(line);
        if (response) {
          if (response === 'quit') { ws.close(); return; }
          if (response.startsWith('bestmove') || response.includes('\nbestmove')) {
            const bmLine = response.split('\n').find(l => l.startsWith('bestmove')) || response;
            _stdout(`> ${bmLine}`);
          }
          logger.write(`> ${response.split('\n')[0]}${response.includes('\n')?'...':''}`);
          ws.send(response);
        }
      } catch (err) {
        _stderr('Error handling command:', err);
        logger.write(`[COMMAND ERROR] ${err.message}\n${err.stack}`);
        try { ws.send(`info string Error: ${err.message}`); } catch {}
      }
    });

    ws.on('close', (code, reason) => { logger.write(`Client disconnected: ${code} ${reason}`); });
    ws.on('error', (err) => { _stderr('WebSocket error:', err); logger.write(`[WS ERROR] ${err.message}`); });
  });

  wss.on('error', (err) => { _stderr('Server error:', err); });

  // ── Crash / exit handlers — flush logs before dying ──
  const shutdown = async (signal) => {
    _stdout(`\n${signal} received, shutting down...`);
    logger.write(`${signal} — shutting down`);
    wss.clients.forEach(c => c.close());
    wss.close(() => {});
    await logger.flush();
    logger.close();
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    _stderr('Uncaught exception:', err);
    logger.write(`[FATAL] uncaughtException: ${err.message}\n${err.stack}`);
    logger.flushSync();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    _stderr('Unhandled rejection:', reason);
    logger.write(`[FATAL] unhandledRejection: ${reason}`);
    logger.flushSync();
    process.exit(1);
  });
}

startServer().catch(err => { _stderr('Failed to start server:', err); process.exit(1); });