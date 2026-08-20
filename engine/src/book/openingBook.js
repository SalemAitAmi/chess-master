/**
 * Polyglot opening book — provides move ORDERING HINTS, not move selection.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PolyglotBook } from './polyglotReader.js';
import logger, { LOG, CAT } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOK_PATH = path.join(__dirname, '../../data/baron30.bin');
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

      if (__LOG__ && LOG.book) {
        logger.event(CAT.BOOK, 'loaded', { sizeKB, positions: instance.entries.size });
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
 * Returns null if out of book range, book unavailable, or no entries.
 *
 * FAIL LOUD: if an entry lacks a `weight` field the call throws instead
 * of silently defaulting to 1 — this surfaces book format mismatches.
 */
export function lookupAllBookMoves(board, legalMoves) {
  if (!book || !book.loaded) return null;
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

  const legalSet = new Set();
  for (const m of legalMoves) legalSet.add(m.algebraic);

  const hints = new Map();
  for (const entry of entries) {
    const alg = entry.move.toLowerCase();
    if (!legalSet.has(alg)) continue;

    // Fail loud: require explicit weight. Books may use `weight` or `score`.
    const w = entry.weight != null ? entry.weight
            : entry.score  != null ? entry.score
            : undefined;
    if (w === undefined) {
      throw new Error(
        `[BOOK] Entry for ${alg} has no 'weight' or 'score' field. ` +
        `Keys present: ${Object.keys(entry).join(', ')}`
      );
    }
    hints.set(alg, w);
  }
  if (hints.size === 0) return null;

  if (__LOG__ && LOG.book) {
    const top = [...hints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    logger.event(CAT.BOOK, 'hints', {
      count: hints.size, top: top.map(([m, w]) => `${m}(${w})`).join(' '),
    });
  }
  return hints;
}

/**
 * Print all opening book keys and nested entry keys to stdout.
 * Diagnostic utility — call from a script or the REPL.
 */
export function printBookKeys() {
  if (!book || !book.loaded) {
    console.log('[BOOK] Book not loaded');
    return;
  }
  const stdout = console.log.bind(console);
  stdout(`=== Opening Book Keys (${book.entries.size} positions) ===`);
  let posCount = 0;
  for (const [hash, entries] of book.entries) {
    posCount++;
    if (posCount <= 5 || posCount === book.entries.size) {
      stdout(`\nPosition hash: ${hash}  (${entries.length} move(s))`);
      for (const entry of entries) {
        const keys = Object.keys(entry);
        stdout(`  move: ${entry.move}  entry keys: [${keys.join(', ')}]`);
        for (const k of keys) {
          stdout(`    ${k}: ${JSON.stringify(entry[k])}`);
        }
      }
    } else if (posCount === 6) {
      stdout(`\n  ... (${book.entries.size - 6} more positions) ...`);
    }
  }
  stdout(`\n=== Total: ${posCount} positions ===`);
}

export function isBookLoaded() { return book !== null && book.loaded === true; }
export function getBookStats() {
  return {
    loaded: isBookLoaded(),
    positions: book && book.entries ? book.entries.size : 0,
    error: loadError ? loadError.message : null,
  };
}
export function getBookError() { return loadError; }