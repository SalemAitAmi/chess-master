import { WebSocketServer } from 'ws';
import logger, { LOG_CATEGORY, installNoopLogger } from './logging/logger.js';
import { loadOpeningBook, isBookLoaded, getBookStats } from './book/openingBook.js';
import { getOrCreateSession } from './uci/engineSession.js';

const __DEV__ = globalThis.__DEV__ ?? true;

const _stdout = console.log.bind(console);
const _stderr = console.error.bind(console);

if (!__DEV__) {
  installNoopLogger();
  _stdout('[server] Production mode — NoopLogger installed');
} else {
  const DEV_MASK = LOG_CATEGORY.ALL;
  const maskArg = process.argv.find(a => a.startsWith('--log-mask='));
  const logMask = maskArg ? (Number(maskArg.split('=')[1]) || DEV_MASK) : DEV_MASK;
  logger.setMask(logMask);
  logger.startSession();
  _stdout(`[server] Dev mode — log mask 0x${logMask.toString(16)}`);
}

console.log  = (...args) => { logger.write(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')); };
console.warn = (...args) => { logger.write(`[WARN] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`); };
console.error = (...args) => {
  const m = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  logger.write(`[ERROR] ${m}`); _stderr(...args);
};

const DEFAULT_PORT = 8080;
let soloCounter = 0;

async function startServer() {
  const portArg = process.argv.find(a => a.startsWith('--port='));
  const port = portArg ? (parseInt(portArg.split('=')[1], 10) || DEFAULT_PORT) : DEFAULT_PORT;

  _stdout('Chess Engine Server starting...');
  logger.write('Chess Engine Server starting');
  await loadBook();

  const wss = new WebSocketServer({ port });
  _stdout(`Chess Engine Server listening on port ${port}`);
  logger.write(`Server listening on port ${port}`);

  wss.on('connection', (ws, req) => onConnection(wss, ws, req));
  wss.on('error', (err) => { _stderr('Server error:', err); });
  installShutdownHandlers(wss);
}

async function loadBook() {
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
}

/**
 * ONE ENGINE INSTANCE PER CONNECTION.
 *
 * The instance is created LAZILY: either by a `session` handshake, or by the
 * first UCI command on a connection that never handshakes (in which case it
 * gets a private solo session, so single-engine pages work unchanged).
 * Eager registration used to create a solo instance that the handshake then
 * immediately discarded — three junk records in instances.ndjson per match.
 *
 * Transport-level log lines bind the orphan context (logger.bind(null)) so they
 * are not mis-attributed to whichever instance happened to be bound last.
 */
function onConnection(wss, ws, req) {
  const clientAddr = req.socket.remoteAddress;
  logger.bind(null);
  logger.write(`Client connected from ${clientAddr}`);
  if (__DEV__) _stdout(`Client connected from ${clientAddr}`);

  let session = null;
  let instance = null;

  const ensureInstance = () => {
    if (instance !== null) return instance;
    session = getOrCreateSession(`solo-${++soloCounter}`);
    instance = session.register('e0', 'baseline');
    return instance;
  };

  ws.on('message', async (message) => {
    const line = message.toString().trim();
    if (!line) return;

    // ── Handshake: session <sessionId> <instanceName> [profile] ──
    // Transport-level, deliberately outside UCI: it selects WHICH engine this
    // socket talks to, like choosing which binary a GUI launches.
    if (line.startsWith('session ')) {
      logger.bind(null);
      logger.write(`< ${line}`);
      const [, sid, name, profile] = line.split(/\s+/);
      try {
        if (session !== null && instance !== null) session.unregister(instance.name);
        session = getOrCreateSession(sid || `solo-${++soloCounter}`);
        instance = session.register(name || 'e0', profile || 'baseline');
        ws.send(`info string session ${session.id} instance ${instance.name} ` +
                `profile ${instance.profile.name} cfg ${instance.profile.hash} tt ${instance.ttId()}`);
      } catch (err) {
        session = null;
        instance = null;
        _stderr('Session handshake failed:', err);
        ws.send(`info string session error ${err.message}`);
      }
      return;
    }

    const inst = ensureInstance();
    logger.write(`< ${line}`);

    try {
      const response = await inst.dispatch(line);
      if (!response) return;
      if (response === 'quit') { ws.close(); return; }
      logOutbound(response);
      ws.send(response);
    } catch (err) {
      _stderr('Error handling command:', err);
      logger.write(`[COMMAND ERROR] ${err.message}\n${err.stack}`);
      try { ws.send(`info string Error: ${err.message}`); } catch { /* */ }
    }
  });

  ws.on('close', (code, reason) => {
    if (session !== null && instance !== null) session.unregister(instance.name);
    const tag = instance !== null ? `${session.id}/${instance.name}` : 'unregistered';
    session = null;
    instance = null;
    logger.bind(null);
    logger.write(`Client disconnected (${tag}): ${code} ${reason}`);
  });

  ws.on('error', (err) => {
    _stderr('WebSocket error:', err);
    logger.bind(null);
    logger.write(`[WS ERROR] ${err.message}`);
  });
}

function logOutbound(response) {
  if (response.startsWith('bestmove') || response.includes('\nbestmove')) {
    const bmLine = response.split('\n').find(l => l.startsWith('bestmove')) || response;
    _stdout(`> ${bmLine}`);
  }
  logger.write(`> ${response.split('\n')[0]}${response.includes('\n') ? '...' : ''}`);
}

function installShutdownHandlers(wss) {
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      // Second signal: the first one is blocked behind something synchronous
      // (a search that overran its deadline). Do not wait for a clean flush.
      _stderr(`${signal} again — forcing exit`);
      logger.flushSync();
      process.exit(130);
    }
    shuttingDown = true;
    _stdout(`\n${signal} received, shutting down...`);
    logger.bind(null);
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