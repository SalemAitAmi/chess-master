/**
 * Polyglot opening book integration using custom reader
 * (chess-tools has bugs, so we use our own implementation)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PolyglotBook } from './polyglotReader.js';
import logger from '../logging/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let book = null;
let loadPromise = null;
let loadError = null;

// Opening book should be placed in chess-engine/data/baron30.bin
const BOOK_PATH = path.join(__dirname, '../../data/baron30.bin');

/**
 * Load the opening book
 */
export async function loadOpeningBook() {
  if (book) return book;
  if (loadError) return null;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    if (!fs.existsSync(BOOK_PATH)) {
      const errorMsg = `Opening book not found at ${BOOK_PATH}. Place baron30.bin in chess-engine/data/`;
      console.warn(`[BOOK WARNING] ${errorMsg}`);
      logger.book('warn', { path: BOOK_PATH }, errorMsg);
      loadError = new Error(errorMsg);
      return null;
    }

    try {
      logger.book('info', { path: BOOK_PATH }, 'Loading opening book');

      const bookInstance = new PolyglotBook(BOOK_PATH);
      await bookInstance.load();
      
      const stats = fs.statSync(BOOK_PATH);
      const entryCount = bookInstance.entries.size;
      
      console.log(`[BOOK] Opening book loaded successfully (${Math.round(stats.size / 1024)} KB, ${entryCount} positions)`);
      logger.book('info', {
        path: BOOK_PATH,
        sizeKB: Math.round(stats.size / 1024),
        positions: entryCount,
        loaded: bookInstance.loaded
      }, 'Opening book loaded and ready');

      // Verify with a test lookup
      try {
        const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        const testEntries = bookInstance.find(startFen);
        logger.book('debug', { 
          testEntriesCount: testEntries?.length || 0 
        }, `Verification: ${testEntries?.length || 0} moves for starting position`);
      } catch (verifyErr) {
        logger.book('warn', { 
          error: verifyErr.message 
        }, 'Verification lookup failed');
      }

      book = bookInstance;
      return book;
    } catch (err) {
      const errorMsg = `Failed to load opening book: ${err.message}`;
      console.error(`[BOOK ERROR] ${errorMsg}`);
      console.error(err.stack);
      logger.book('error', {
        error: err.message,
        stack: err.stack,
        path: BOOK_PATH
      }, errorMsg);
      loadError = err;
      book = null;
      return null;
    }
  })();

  return loadPromise;
}

/**
 * Look up a book move for the current position
 */
export async function lookupBookMove(board, legalMoves) {
  if (!book && !loadError) {
    await loadOpeningBook();
  }

  if (!book) {
    logger.book('trace', { reason: loadError?.message || 'not loaded' }, 'No opening book available');
    return null;
  }

  // Don't use book after move 15
  const moveNumber = Math.floor((board.moveHistory?.length || 0) / 2) + 1;
  if (moveNumber > 15) {
    logger.book('trace', { moveNumber }, 'Past opening book range (move 15)');
    return null;
  }

  const fen = board.toFen();

  try {
    const entries = book.find(fen);

    if (!entries || entries.length === 0) {
      logger.book('debug', { fen }, 'No book moves found for position');
      return null;
    }

    logger.book('debug', {
      fen,
      bookMoves: entries.slice(0, 5).map(e => `${e.move}(${e.weight})`)
    }, `Found ${entries.length} book moves`);

    // Weighted random selection
    const totalWeight = entries.reduce((sum, e) => sum + (e.weight || 1), 0);
    let random = Math.random() * totalWeight;

    for (const entry of entries) {
      random -= (entry.weight || 1);
      if (random <= 0) {
        const moveStr = entry.move;
        const fromStr = moveStr.slice(0, 2);
        const toStr = moveStr.slice(2, 4);
        const promoChar = moveStr.length > 4 ? moveStr[4].toLowerCase() : '';

        // Find matching legal move
        const legalMove = legalMoves.find(m => {
          const fromFile = String.fromCharCode('a'.charCodeAt(0) + m.from[1]);
          const fromRank = 8 - m.from[0];
          const toFile = String.fromCharCode('a'.charCodeAt(0) + m.to[1]);
          const toRank = 8 - m.to[0];
          const from = `${fromFile}${fromRank}`;
          const to = `${toFile}${toRank}`;

          if (from !== fromStr || to !== toStr) return false;

          if (promoChar && m.promotionPiece !== undefined) {
            const promoMap = { 'q': 1, 'r': 2, 'b': 3, 'n': 4 };
            return m.promotionPiece === promoMap[promoChar];
          }

          return !promoChar || !m.isPromotion;
        });

        if (legalMove) {
          console.log(`[BOOK] Selected book move: ${moveStr} (weight: ${entry.weight})`);
          logger.book('info', {
            move: moveStr,
            weight: entry.weight,
            totalWeight
          }, 'Book move selected');
          return legalMove;
        } else {
          console.warn(`[BOOK WARNING] Book move ${moveStr} not found in legal moves`);
          logger.book('warn', { bookMove: moveStr }, 'Book move not found in legal moves');
        }
      }
    }
  } catch (err) {
    console.error(`[BOOK ERROR] Book lookup error: ${err.message}`);
    logger.book('error', { error: err.message, stack: err.stack, fen }, 'Book lookup error');
  }

  return null;
}

/**
 * Check if book is loaded
 */
export function isBookLoaded() {
  return book !== null && book.loaded === true;
}

/**
 * Get book statistics
 */
export function getBookStats() {
  return {
    loaded: book !== null && book.loaded === true,
    positions: book?.entries?.size || 0,
    error: loadError?.message || null
  };
}

/**
 * Get the load error if any
 */
export function getBookError() {
  return loadError;
}

export default {
  loadOpeningBook,
  lookupBookMove,
  isBookLoaded,
  getBookStats,
  getBookError
};