/**
 * Human-game support for the Sandbox — SKELETON.
 *
 * Engine-vs-engine sessions arrive fully instrumented: every decision carries
 * its root ranking, iterations and sampled traces. Human players never call
 * the engine for a move (and local play usually runs with logging off), so a
 * human game is just a MOVE LIST. The Sandbox's comparative questions —
 * "I played the 6th-best move on turn 10: which moves were better, and why?",
 * "where were the blunders?", "which move decided the game?" — need that list
 * turned into engine-style decision records at load time.
 *
 * PIPELINE (load time, SandboxPage.load → preprocessMatchRecords → buildSession)
 *
 *   1 record    { format, version, mode, savedAt, startFen, moves:[uci], players, result }
 *               Built by createMatchRecord() from useGameSession's `uciHistory`
 *               when a human game ends.                                [DONE]
 *               TODO: offer "Save game" on the GameOverModal of the Local /
 *               VS Computer pages (call downloadMatchRecord).
 *
 *   2 replay    synthesizeGame(): one `turn` record per ply — position, move,
 *               mover — in the exact shape of search.ndjson, so model.js,
 *               the timeline and the board work unchanged.            [DONE]
 *
 *   3 analyze   analyzeRecord(): for every ply, ask an analyzer for the FULL
 *               ranked root list of the position (score, exactness and the
 *               per-term static breakdown after each move) and emit
 *               `order/root-move` records + a filled-in turn score. The
 *               Candidates lens, MoveView and PieceView then explain "why"
 *               with no UI change.                                    [TODO]
 *               The engine already produces exactly this data in
 *               SearchEngine._logRootMoves; it needs a UCI extension that
 *               RETURNS it (e.g. `analyse depth N` → `rootmove …` lines)
 *               instead of only logging it. Implement createEngineAnalyzer()
 *               on EngineClient once that exists.
 *
 *   4 annotate  classifyMove() labels each ply (best … blunder) from the
 *               win-probability loss vs the best move.                [DONE]
 *               findCriticalMoments() picks the game-defining swings. [TODO]
 *
 * FENs produced in step 2 come from fenUtils (display-only: castling/e.p.
 * blanked). An analyzer must therefore replay `moves` from `startFen` itself
 * (`position fen <startFen> moves …`), never trust the synthetic FENs.
 */
import { applyUciToFen, sideToMove } from './fenUtils';
import { winProb } from './model';
import { STARTING_FEN } from '../constants/gameConstants';
import { downloadJson } from '../utils/download';

export const MATCH_RECORD_FORMAT = 'chess-master/match';
export const MATCH_RECORD_VERSION = 1;
export const MATCH_RECORD_SUFFIX = '.match.json';

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Record
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {object} p
 * @param {'local'|'vs-computer'} p.mode
 * @param {string}   p.startFen  '' = standard start
 * @param {string[]} p.moves     UCI, in order (useGameSession().uciHistory)
 * @param {{white:string, black:string}} p.players  display names / ids
 * @param {{status:string, winner:string}|null} p.result
 */
export function createMatchRecord({ mode, startFen = '', moves, players = {}, result = null }) {
  return {
    format: MATCH_RECORD_FORMAT,
    version: MATCH_RECORD_VERSION,
    mode,
    savedAt: new Date().toISOString(),
    startFen: startFen || STARTING_FEN,
    moves: [...moves],
    players: { white: players.white ?? 'White', black: players.black ?? 'Black' },
    result,
  };
}

export function isMatchRecord(x) {
  return !!x && x.format === MATCH_RECORD_FORMAT && Array.isArray(x.moves) && x.moves.every(m => typeof m === 'string');
}

export function downloadMatchRecord(record) {
  const stamp = record.savedAt.replace(/[:.]/g, '-');
  downloadJson(record, `${record.mode ?? 'game'}-${stamp}${MATCH_RECORD_SUFFIX}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Moves-only replay
// ═══════════════════════════════════════════════════════════════════════════

/** Half-move index of a FEN's position — the logger's `t`. */
function plyOf(fen) {
  const parts = fen.trim().split(/\s+/);
  return ((parseInt(parts[5], 10) || 1) - 1) * 2 + (parts[1] === 'b' ? 1 : 0);
}

/** `eng` id for a side: the player's name, slugged; falls back to the colour. */
const engIdFor = (record, color) => String(record.players?.[color] ?? color).trim().replace(/\s+/g, '-') || color;

/**
 * One synthetic `turn` per ply, shaped like search.ndjson. Every score field
 * is absent until step 3 fills it in; `t` is counted from the start FEN
 * because the synthetic FENs reset their move counters.
 */
export function synthesizeGame(record, index) {
  const records = [];
  let fen = record.startFen || STARTING_FEN;
  const t0 = plyOf(fen);
  record.moves.forEach((move, i) => {
    const color = sideToMove(fen);
    records.push({
      cat: 'search', label: 'turn', seq: i + 1, t: t0 + i, eng: engIdFor(record, color),
      color, fen, best: move, pv: move, synthetic: 1,
    });
    fen = applyUciToFen(fen, move);
  });
  return { index, records, replay: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Analysis (TODO)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {object} RootMoveScore
 * @property {string}  alg        UCI move
 * @property {number}  cp         search score, mover POV
 * @property {boolean} exact      EXACT score (not a bound)
 * @property {number}  [staticCp] static eval after the move, mover POV
 * @property {object}  [breakdown] { material, centerControl, … } after the move
 *
 * @typedef {object} PositionAnalyzer
 * @property {(req:{startFen:string, moves:string[], depth:number}) => Promise<RootMoveScore[]>} rankRootMoves
 *   Every legal root move of the position reached by `moves`, best first.
 */

/** Analyzer ranking → the `order/root-move` records model.js consumes. */
export function rootMoveRecords(ranking, { eng, t, seq, played }) {
  return ranking.map((m, rank) => ({
    cat: 'order', label: 'root-move', eng, t, seq,
    rank, alg: m.alg, cp: m.cp, exact: m.exact ? 1 : 0, played: m.alg === played ? 1 : 0,
    staticCp: m.staticCp ?? null, ...(m.breakdown ?? {}),
  }));
}

/**
 * TODO(human-analysis): for each ply i, `await analyzer.rankRootMoves({ startFen,
 * moves: record.moves.slice(0, i), depth })`, report progress, honour
 * `signal`, and return rootMoveRecords(...) for every ply plus score fields
 * (cp/bestCp/bestRank/margin) to merge into the synthetic turn records.
 *
 * @returns {Promise<object[]>} extra records for the game
 */
export async function analyzeRecord(record, analyzer, { depth = 10, onProgress = null, signal = null } = {}) {
  void record; void analyzer; void depth; void onProgress; void signal;
  throw new Error('analyzeRecord: human-game analysis is not implemented yet (needs an engine root-ranking command)');
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Annotation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Win-probability loss thresholds. Conventions (the blunder line matches
 * analyze_logs.py --blunder-wp), not discovered breakpoints — tune freely.
 */
export const MOVE_CLASSES = [
  { id: 'best', label: 'Best', maxWpLoss: 0 },
  { id: 'good', label: 'Good', maxWpLoss: 0.02 },
  { id: 'inaccuracy', label: 'Inaccuracy', maxWpLoss: 0.05 },
  { id: 'mistake', label: 'Mistake', maxWpLoss: 0.10 },
  { id: 'blunder', label: 'Blunder', maxWpLoss: Infinity },
];

/**
 * Classify a played move from the best root score and its own score (both
 * mover POV, cp). Bounded in win probability so a 300cp loss in a won
 * position is not a "blunder" while the same loss at equality is.
 */
export function classifyMove(bestCp, playedCp) {
  if (!Number.isFinite(bestCp) || !Number.isFinite(playedCp)) return null;
  const wpLoss = Math.max(0, winProb(bestCp) - winProb(playedCp));
  const cls = MOVE_CLASSES.find(c => wpLoss <= c.maxWpLoss);
  return { ...cls, wpLoss, cpLoss: Math.max(0, bestCp - playedCp) };
}

/**
 * TODO(human-analysis): game-defining moments — plies where the white-POV
 * win probability swings by ≥ `swing`, and the moves that created them
 * (typically the last mistake before the swing, not the swing itself).
 *
 * @returns {Array<{turnIndex:number, wpBefore:number, wpAfter:number, kind:string}>}
 */
export function findCriticalMoments(turns, { swing = 0.15 } = {}) {
  void turns; void swing;
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry point
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert raw.matchRecords into synthetic games (in place) so buildSession
 * can treat them like logged games. With no analyzer, games are moves-only.
 */
export async function preprocessMatchRecords(raw, { analyzer = null, depth = 10, onProgress = null } = {}) {
  const hadEngineGames = raw.games.size > 0;
  let next = Math.max(0, ...raw.games.keys()) + 1;
  for (const record of raw.matchRecords) {
    const game = synthesizeGame(record, next++);
    if (analyzer !== null) game.records.push(...await analyzeRecord(record, analyzer, { depth, onProgress }));
    raw.games.set(game.index, game);
  }
  raw.kind = hadEngineGames ? 'mixed' : 'human';
  return raw;
}