/**
 * WebSocket server for UCI communication.
 *
 * Production logging contract:
 *   - NoopLogger installed → every logger.* call is a no-op
 *   - Per-message console I/O guarded by __DEV__
 *   - ONE unconditional log survives: the `bestmove` response.
 *     This is the single observable output we always want.
 */

import { WebSocketServer } from 'ws';
import { UCIHandler } from './uci/uciHandler.js';
import logger, { LOG_CATEGORY, installNoopLogger } from './logging/logger.js';
import { loadOpeningBook, isBookLoaded, getBookStats } from './book/openingBook.js';

// ── Build-time / runtime environment detection ──
// In a --prod bundle, esbuild replaces `globalThis.__DEV__` with `false`
// and the whole expression folds to `false` at parse time.
// Running from source: falls back to NODE_ENV so `NODE_ENV=production
// node src/server.js` behaves like a prod build even without bundling.
const __DEV__ = globalThis.__DEV__ ?? (process.env.NODE_ENV !== 'production');

// ── Defense in depth ──
// Even if someone sets LOG_MASK in prod, the NoopLogger makes every
// logger method an empty function. Belt + suspenders with the DCE'd
// `if (__LOG__)` guards in search.js/quiescence.js.
if (!__DEV__) {
  installNoopLogger();
  console.log('[server] Production mode — NoopLogger installed, per-message I/O suppressed');
} else {
  const logMask = parseInt(process.env.LOG_MASK || '0', 10);
  logger.setEnabledCategories(logMask);
  if (logMask !== 0) {
    console.log(`[server] Dev mode — log mask 0x${logMask.toString(16)}`);
  }
}

const PORT = process.env.PORT || 8080;

async function startServer() {
  console.log('Chess Engine Server starting...');

  try {
    const bookInstance = await loadOpeningBook();
    if (bookInstance && isBookLoaded()) {
      const stats = getBookStats();
      console.log(`[BOOK] Opening book ready (${stats.positions} positions)`);
    } else {
      console.warn('[BOOK] Opening book not available');
    }
  } catch (err) {
    console.warn('Opening book not loaded:', err.message);
  }

  const wss = new WebSocketServer({ port: PORT });
  console.log(`Chess Engine Server listening on port ${PORT}`);

  wss.on('connection', (ws, req) => {
    const clientAddr = req.socket.remoteAddress;
    if (__DEV__) console.log(`Client connected from ${clientAddr}`);

    const handler = new UCIHandler();

    ws.on('message', async (message) => {
      const line = message.toString().trim();
      if (!line) return;

      // Inbound command echo — dev only. At depth 12 a `go` command
      // is followed by ~30s of silence, so this isn't hot, but it's
      // still noise in prod logs.
      if (__DEV__) console.log(`< ${line}`);

      try {
        const response = await handler.handleCommand(line);

        if (response) {
          if (response === 'quit') {
            ws.close();
            return;
          }

          // ── The ONE log that survives production ──
          // `bestmove` is the post-search, post-eval final answer.
          // Everything else (info strings, readyok, etc.) is dev-only.
          // UCI sends multi-line responses joined by \n, and bestmove
          // is the last line, so check suffix too.
          if (response.startsWith('bestmove') || response.includes('\nbestmove')) {
            // Pull just the bestmove line for a clean prod log
            const bmLine = response.split('\n').find(l => l.startsWith('bestmove')) || response;
            console.log(`> ${bmLine}`);
          } else if (__DEV__) {
            console.log(`> ${response}`);
          }

          ws.send(response);
        }
      } catch (err) {
        // Errors always surface — NoopLogger.uci still console.errors
        console.error('Error handling command:', err);
        logger.uci('error', { error: err.message, command: line }, 'Command error');
        try {
          ws.send(`info string Error: ${err.message}`);
        } catch (e) { /* ignore send errors on closed socket */ }
      }
    });

    ws.on('close', (code, reason) => {
      if (__DEV__) console.log(`Client disconnected: ${code} ${reason}`);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  });

  wss.on('error', (err) => {
    console.error('Server error:', err);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    wss.clients.forEach(client => client.close());
    wss.close(() => console.log('Server closed'));
    await logger.flush();
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});