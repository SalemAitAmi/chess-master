/**
 * Polyglot opening book — provides move ORDERING HINTS, not move selection.
 *
 * Old flow (uciHandler):   book hit → return immediately, skip search
 * New flow:                book hits → pass to search as ordering hints
 *                          → search validates; bad book lines get overridden
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PolyglotBook } from './polyglotReader.js';
import logger, { LOG } from '../logging/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOK_PATH = path.join(__dirname, '../../data/baron30.bin');

// Beyond this, opening theory is mostly exhausted and search knows better.
const MAX_BOOK_MOVE = 15;

let book = null;
let loadPromise = null;
let loadError = null;

export async function loadOpeningBook() {
  if (book) return book;
  if (loadError) return null;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    if (!fs.existsSync(BOOK_PATH)) {
      loadError = new Error(`Opening book not found at ${BOOK_PATH}`);
      console.warn(`[BOOK] ${loadError.message}`);
      return null;
    }

    try {
      const instance = new PolyglotBook(BOOK_PATH);
      await instance.load();

      const sizeKB = Math.round(fs.statSync(BOOK_PATH).size / 1024);
      console.log(`[BOOK] Loaded: ${sizeKB}KB, ${instance.entries.size} positions`);
      if (LOG.book) {
        logger.book('info', { sizeKB, positions: instance.entries.size }, 'Book loaded');
      }

      book = instance;
      return book;
    } catch (err) {
      console.error(`[BOOK] Load failed: ${err.message}`);
      loadError = err;
      return null;
    }
  })();

  return loadPromise;
}

/**
 * Return ALL book moves for the position as Map<algebraic, weight>.
 * This is what search consumes — it passes the map to moveOrdering,
 * which boosts matching moves into the BOOK_MOVE priority tier.
 *
 * Returns null if out of book range, book unavailable, or no entries.
 */
export function lookupAllBookMoves(board, legalMoves) {
  if (!book || !book.loaded) return null;

  // fullMoveCount is the game's move number — unaffected by search make/unmake
  // because search always undoes back to the starting position before we get here.
  if (board.gameState.fullMoveCount > MAX_BOOK_MOVE) return null;

  const fen = board.toFen();
  let entries;
  try {
    entries = book.find(fen);
  } catch (err) {
    console.error(`[BOOK] Lookup failed: ${err.message}`);
    return null;
  }
  if (!entries || entries.length === 0) return null;

  // Filter to legal moves. Polyglot can contain entries that are illegal in
  // the current position due to hash collisions or book-generation quirks.
  // Both polyglot and our move objects use lowercase algebraic (e2e4, e7e8q).
  const legalSet = new Set();
  for (const m of legalMoves) legalSet.add(m.algebraic);

  const hints = new Map();
  for (const entry of entries) {
    const alg = entry.move.toLowerCase();
    if (legalSet.has(alg)) {
      hints.set(alg, entry.weight || 1);
    }
  }

  if (hints.size === 0) return null;

  if (LOG.book) {
    const top = [...hints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    logger.book('debug', {
      fen, count: hints.size,
      top: top.map(([m, w]) => `${m}(${w})`).join(' '),
    }, `Book: ${hints.size} hint(s)`);
  }

  return hints;
}

/**
 * LEGACY — single-move selection with weighted random.
 * @deprecated Use lookupAllBookMoves() + search. Kept for backward compat.
 */
export async function lookupBookMove(board, legalMoves) {
  const hints = lookupAllBookMoves(board, legalMoves);
  if (!hints) return null;

  const entries = [...hints.entries()];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;

  for (const [alg, weight] of entries) {
    r -= weight;
    if (r <= 0) {
      const match = legalMoves.find(m => m.algebraic === alg);
      if (match) {
        console.log(`[BOOK] Legacy select: ${alg} (weight ${weight})`);
        return match;
      }
    }
  }
  return null;
}

export function isBookLoaded() { return book !== null && book.loaded === true; }
export function getBookStats() {
  return {
    loaded: isBookLoaded(),
    positions: book?.entries?.size || 0,
    error: loadError?.message || null,
  };
}
export function getBookError() { return loadError; }

export default {
  loadOpeningBook, lookupAllBookMoves, lookupBookMove,
  isBookLoaded, getBookStats, getBookError,
};