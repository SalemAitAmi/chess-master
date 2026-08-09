import { WebSocketServer } from 'ws';
import { UCIHandler } from './uci/uciHandler.js';
import logger, { LOG_CATEGORY, installNoopLogger } from './logging/logger.js';
import { loadOpeningBook, isBookLoaded, getBookStats } from './book/openingBook.js';

const __DEV__ = globalThis.__DEV__ ?? true;

const _stdout = console.log.bind(console);
const _stderr = console.error.bind(console);

if (!__DEV__) {
  installNoopLogger();
  _stdout('[server] Production mode — NoopLogger installed');
} else {
  const DEV_MASK = LOG_CATEGORY.SYSTEM | LOG_CATEGORY.UCI | LOG_CATEGORY.SEARCH |
                   LOG_CATEGORY.PV | LOG_CATEGORY.BOOK | LOG_CATEGORY.TIME | LOG_CATEGORY.STAGE;
  const maskArg = process.argv.find(a => a.startsWith('--log-mask='));
  const logMask = maskArg ? (Number(maskArg.split('=')[1]) || DEV_MASK) : DEV_MASK;
  logger.setMask(logMask);
  logger.startSession();
  _stdout(`[server] Dev mode — log mask 0x${logMask.toString(16)}`);
}

console.log  = (...args) => { const m = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '); logger.write(m); };
console.warn = (...args) => { const m = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '); logger.write(`[WARN] ${m}`); };
console.error = (...args) => { const m = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '); logger.write(`[ERROR] ${m}`); _stderr(...args); };

const DEFAULT_PORT = 8080;

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

function onConnection(wss, ws, req) {
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

  ws.on('close', (code, reason) => { logger.write(`Client disconnected: ${code} ${reason}`); });
  ws.on('error', (err) => { _stderr('WebSocket error:', err); logger.write(`[WS ERROR] ${err.message}`); });
}

function logOutbound(response) {
  if (response.startsWith('bestmove') || response.includes('\nbestmove')) {
    const bmLine = response.split('\n').find(l => l.startsWith('bestmove')) || response;
    _stdout(`> ${bmLine}`);
  }
  logger.write(`> ${response.split('\n')[0]}${response.includes('\n') ? '...' : ''}`);
}

function installShutdownHandlers(wss) {
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