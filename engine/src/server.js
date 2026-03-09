/**
 * WebSocket server for UCI communication
 */

import { WebSocketServer } from 'ws';
import { UCIHandler } from './uci/uciHandler.js';
import logger, { LOG_CATEGORY } from './logging/logger.js';
import { loadOpeningBook, isBookLoaded, getBookStats } from './book/openingBook.js';

const PORT = process.env.PORT || 8080;

const logMask = parseInt(process.env.LOG_MASK || '0', 10);
logger.setEnabledCategories(logMask);

async function startServer() {
  console.log('Chess Engine Server starting...');

  // Pre-load opening book and wait for it to be fully ready
  try {
    const bookInstance = await loadOpeningBook();
    if (bookInstance && isBookLoaded()) {
      const stats = getBookStats();
      console.log(`[BOOK] Opening book verified and ready (${stats.positions} positions)`);
    } else {
      console.warn('[BOOK] Opening book not available');
    }
  } catch (err) {
    console.warn('Opening book not loaded:', err.message);
  }

  const wss = new WebSocketServer({ port: PORT });

  console.log(`Chess Engine Server listening on port ${PORT}`);
  logger.uci('info', { port: PORT }, 'Server started');

  wss.on('connection', (ws, req) => {
    const clientAddr = req.socket.remoteAddress;
    console.log(`Client connected from ${clientAddr}`);
    logger.uci('info', { client: clientAddr }, 'Client connected');

    const handler = new UCIHandler();

    ws.on('message', async (message) => {
      const line = message.toString().trim();

      if (!line) return;

      console.log(`< ${line}`);

      try {
        const response = await handler.handleCommand(line);

        if (response) {
          if (response === 'quit') {
            ws.close();
            return;
          }

          console.log(`> ${response}`);
          ws.send(response);
        }
      } catch (err) {
        console.error('Error handling command:', err);
        logger.uci('error', { error: err.message, command: line }, 'Command error');

        try {
          ws.send(`info string Error: ${err.message}`);
        } catch (e) {
          // Ignore send errors
        }
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`Client disconnected: ${code} ${reason}`);
      logger.uci('info', { code, reason: reason.toString() }, 'Client disconnected');
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      logger.uci('error', { error: err.message }, 'WebSocket error');
    });
  });

  wss.on('error', (err) => {
    console.error('Server error:', err);
    logger.uci('error', { error: err.message }, 'Server error');
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');

    wss.clients.forEach(client => {
      client.close();
    });

    wss.close(() => {
      console.log('Server closed');
    });

    await logger.flush();
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    logger.uci('error', { error: err.message, stack: err.stack }, 'Uncaught exception');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection:', reason);
    logger.uci('error', { reason: String(reason) }, 'Unhandled rejection');
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});