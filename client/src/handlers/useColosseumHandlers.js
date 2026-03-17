/**
 * Colosseum game loop — engine vs engine.
 *
 * v3 — fixes the triple-win regression from v2.
 *
 * v2's failure mode: `roundActiveRef.current = true` ran in the effect
 * body. When `config` came through as a fresh object reference per
 * parent render (inline prop, unstable), the effect refired on every
 * `setBoard` → parent re-render → new `config`. Each refire reset
 * roundActiveRef, so after loop₁ called endRound and set it false,
 * the very next refire flipped it back to true — and loop₂'s
 * null-move handler walked right through the "idempotence" guard.
 * Same refire also cleared positionCountsRef on every move, so draws
 * never accumulated.
 *
 * Fix:
 *   - `roundTerminatedRef` is reset ONLY by currentRound changing —
 *     never by the game-loop effect. Spurious refires can't un-terminate.
 *   - `config` removed from game-loop deps entirely. Read via ref.
 *   - Generation counter kills stale loops deterministically, regardless
 *     of where they are in their await chain.
 *   - 1s minimum per-move cadence (per user request) so endgame TT hits
 *     don't machine-gun through the last ten moves.
 */

import { useEffect, useRef, useCallback } from "react";
import { isInCheck, hasValidMoves } from "../utils/chessLogic";
import { PIECES } from "../constants/gameConstants";
import { rowColToIndex, colorToIndex } from "../utils/bitboard";
import { BotPlayer, abortSearch } from '../players/BotPlayer';

// Hard floor on move cadence. Engine often replies in <10ms near the
// endgame (TT hits, narrow trees) — without this the last dozen moves
// blur past faster than React can keep up, and any per-render race
// gets a dozen chances to fire.
const MIN_MOVE_INTERVAL_MS = 1000;

export const useColosseumHandlers = (
  gameState,
  config,
  currentRound,
  setCurrentRound,
  colosseumResults,
  setColosseumResults,
  isRunning,
  setIsRunning
) => {
  const {
    boardObj,
    setBoard,
    setLastMove,
    gameOver,
    setGameOver,
    setWinner,
  } = gameState;

  // ── Live mirrors ──
  // Read these inside the async loop instead of closing over React state.
  const boardRef   = useRef(boardObj);
  const configRef  = useRef(config);
  useEffect(() => { boardRef.current  = boardObj; }, [boardObj]);
  useEffect(() => { configRef.current = config;   }, [config]);

  // ── Termination flag — reset ONLY on round change ──
  // This is the critical difference from v2. The game-loop effect never
  // touches this. It can refire a thousand times and a terminated round
  // stays terminated.
  const roundTerminatedRef = useRef(false);
  useEffect(() => {
    roundTerminatedRef.current = false;
  }, [currentRound]);

  // ── Generation counter — stale-loop kill switch ──
  // Each game-loop effect fire bumps this. A loop captures its generation
  // at birth; the moment a newer generation exists, the old loop exits on
  // its next check. Works regardless of which await the old loop is stuck
  // in, and doesn't depend on cleanup timing.
  const generationRef = useRef(0);

  // ── Draw tracking — survives effect refires ──
  // Cleared on round change, NOT on effect refire. (v2 cleared these in
  // the effect body → wiped on every spurious refire → never reached 3.)
  const positionCountsRef = useRef(new Map());
  const halfMoveClockRef  = useRef(0);
  useEffect(() => {
    positionCountsRef.current = new Map();
    halfMoveClockRef.current = 0;
  }, [currentRound]);

  // ── External control ──
  const botsRef           = useRef({ white: null, black: null });
  const stopRequestedRef  = useRef(false);
  const onStopCallbackRef = useRef(null);

  // ───────────────────────────────────────────────────────────────────────

  const endRound = (winnerValue, reason) => {
    // Truly idempotent now — roundTerminatedRef survives effect refires.
    if (roundTerminatedRef.current) return;
    roundTerminatedRef.current = true;
    console.log(`[Colosseum] Round ${currentRound + 1} over: ${winnerValue} (${reason})`);
    setGameOver(true);
    setWinner(winnerValue);
  };

  const recordPosition = (board, wasCapture, wasPawnMove) => {
    if (wasCapture || wasPawnMove) {
      // Irreversible → prior positions unreachable → counts irrelevant.
      // Clearing keeps the Map bounded (≤100 entries between clears).
      positionCountsRef.current.clear();
      halfMoveClockRef.current = 0;
    } else {
      halfMoveClockRef.current++;
    }
    const key = String(board.gameState.zobrist_key);
    positionCountsRef.current.set(key, (positionCountsRef.current.get(key) || 0) + 1);
  };

  const checkForDraw = (board) => {
    const hmc = halfMoveClockRef.current;

    // Diagnostic — fires every 20 reversible plies so we can confirm
    // tracking is actually accumulating. If you never see this log in
    // a 198-move game, something upstream is resetting the refs.
    if (hmc > 0 && hmc % 20 === 0) {
      const key = String(board.gameState.zobrist_key);
      console.log(
        `[Colosseum] Draw tracking — hmc=${hmc} ` +
        `positions=${positionCountsRef.current.size} ` +
        `currentKeyCount=${positionCountsRef.current.get(key) || 0} ` +
        `keyPrefix=${key.slice(0, 12)}`
      );
    }

    if (hmc >= 100) {
      return { isDraw: true, reason: '50-move rule' };
    }

    const key = String(board.gameState.zobrist_key);
    if ((positionCountsRef.current.get(key) || 0) >= 3) {
      return { isDraw: true, reason: 'threefold repetition' };
    }

    // Insufficient material — pure popcount, no history needed.
    const w = colorToIndex('white'), b = colorToIndex('black');
    const heavy = (i) =>
      board.bbPieces[i][PIECES.PAWN].popCount() +
      board.bbPieces[i][PIECES.ROOK].popCount() +
      board.bbPieces[i][PIECES.QUEEN].popCount();
    if (heavy(w) === 0 && heavy(b) === 0) {
      const minors = (i) =>
        board.bbPieces[i][PIECES.BISHOP].popCount() +
        board.bbPieces[i][PIECES.KNIGHT].popCount();
      if (minors(w) <= 1 && minors(b) <= 1) {
        return { isDraw: true, reason: 'insufficient material' };
      }
    }

    return { isDraw: false, reason: null };
  };

  // ───────────────────────────────────────────────────────────────────────
  // Game loop — deps are [currentRound, isRunning] ONLY.
  //
  // config is gone from deps. If it's an inline object in the parent,
  // that no longer refires us. We read configRef.current once at the
  // top of each effect fire. If config genuinely changes mid-tournament
  // (user tweaks difficulty?), the next round picks it up; the current
  // round finishes with the old settings. That's the sane behavior anyway.
  // ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const cfg = configRef.current;
    if (!cfg || !isRunning) return;

    // If this round already ended (e.g. StrictMode double-fire, or some
    // other refire after termination), don't spin up another loop.
    if (roundTerminatedRef.current) {
      console.log('[Colosseum] Skipping loop start — round already terminated');
      return;
    }

    // Claim a generation. Any older loop sees the mismatch and exits.
    const myGen = ++generationRef.current;
    console.log(`[Colosseum] Round ${currentRound + 1} loop gen=${myGen}`);

    // Seed position tracking with the starting position — only if the
    // map is empty (i.e., this is a fresh round, not a spurious refire).
    // On a refire mid-round, the map already has data we want to keep.
    if (positionCountsRef.current.size === 0) {
      const startKey = String(boardRef.current.gameState.zobrist_key);
      positionCountsRef.current.set(startKey, 1);
    }

    // Bot init — inline, one-shot, no stale boardObj closure.
    const swapped = currentRound % 2 === 1;
    botsRef.current.white = new BotPlayer('white', boardRef.current,
      swapped ? cfg.blackBot : cfg.whiteBot);
    botsRef.current.black = new BotPlayer('black', boardRef.current,
      swapped ? cfg.whiteBot : cfg.blackBot);

    // Closure-local cancellation for cleanup. Generation check handles
    // the stale-loop case; this handles the unmount case.
    let cancelled = false;
    const shouldExit = () =>
      cancelled ||
      generationRef.current !== myGen ||
      roundTerminatedRef.current ||
      stopRequestedRef.current;

    const loop = async () => {
      // Move cadence: track when each iteration STARTS, not when the
      // engine replies. If the engine takes 3s, no extra wait. If it
      // takes 10ms, we wait the remaining 990ms.
      let iterStart = Date.now() - MIN_MOVE_INTERVAL_MS;  // first iter: no wait

      while (!shouldExit()) {
        // ── Cadence throttle ──
        const sinceLastIter = Date.now() - iterStart;
        if (sinceLastIter < MIN_MOVE_INTERVAL_MS) {
          await new Promise(r => setTimeout(r, MIN_MOVE_INTERVAL_MS - sinceLastIter));
          if (shouldExit()) break;
        }
        iterStart = Date.now();

        // ── Read CURRENT board via ref — never a stale closure ──
        const board = boardRef.current;
        const color = board.gameState.active_color;
        const bot = color === 'white' ? botsRef.current.white : botsRef.current.black;
        if (!bot) break;

        // ── Engine move ──
        let move;
        try {
          bot.updateBoard(board);
          move = await bot.makeMove();
        } catch (err) {
          console.error('[Colosseum] Bot error:', err);
          break;
        }
        if (shouldExit()) break;

        if (!move) {
          // Engine saw terminal before we did (its movegen returned empty).
          // Confirm with our own check so the winner is correct.
          const mated = isInCheck(board, color);
          endRound(mated ? (color === 'white' ? 'black' : 'white') : 'draw',
                   mated ? 'checkmate (engine-side)' : 'stalemate (engine-side)');
          break;
        }

        // ── Apply ──
        const fromIdx = rowColToIndex(move.from[0], move.from[1]);
        const toIdx   = rowColToIndex(move.to[0], move.to[1]);
        const newBoard = board.clone();

        const movingPiece   = newBoard.pieceList[fromIdx];
        const capturedPiece = newBoard.pieceList[toIdx];
        const wasCapture  = capturedPiece !== PIECES.NONE;
        const wasPawnMove = movingPiece === PIECES.PAWN;
        const isPromo = wasPawnMove && (
          (color === 'white' && move.to[0] === 0) ||
          (color === 'black' && move.to[0] === 7)
        );
        newBoard.makeMove(fromIdx, toIdx, isPromo ? PIECES.QUEEN : undefined);

        // Record BEFORE setBoard so draw state is consistent with the
        // board we're about to publish, even if React batches weirdly.
        recordPosition(newBoard, wasCapture, wasPawnMove);

        // Publish + eager ref bump (don't wait for React's render to
        // update boardRef — next iteration reads it immediately).
        setBoard(newBoard);
        setLastMove({ from: move.from, to: move.to });
        boardRef.current = newBoard;

        // ── Terminal checks ──
        const draw = checkForDraw(newBoard);
        if (draw.isDraw) {
          endRound('draw', draw.reason);
          break;
        }

        const next = newBoard.gameState.active_color;
        if (!hasValidMoves(next, newBoard)) {
          const mated = isInCheck(newBoard, next);
          endRound(mated ? color : 'draw', mated ? 'checkmate' : 'stalemate');
          break;
        }
      }

      // Stop-callback handshake
      if (stopRequestedRef.current && onStopCallbackRef.current) {
        const cb = onStopCallbackRef.current;
        onStopCallbackRef.current = null;
        stopRequestedRef.current = false;
        cb();
      }
    };

    loop();

    return () => {
      cancelled = true;
      // Do NOT touch roundTerminatedRef or positionCountsRef here.
      // Cleanup fires on every refire — resetting round-scoped state
      // here was exactly the v2 bug.
    };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRound, isRunning]);

  // ───────────────────────────────────────────────────────────────────────

  const stopMatch = useCallback((callback) => {
    console.log('[Colosseum] Stop requested');
    stopRequestedRef.current = true;
    onStopCallbackRef.current = callback || null;
    roundTerminatedRef.current = true;   // round is over, just not naturally
    generationRef.current++;             // kill any loop in flight
    setIsRunning(false);
    abortSearch();

    setTimeout(() => {
      if (onStopCallbackRef.current) {
        const cb = onStopCallbackRef.current;
        onStopCallbackRef.current = null;
        cb();
      }
    }, 500);
  }, [setIsRunning]);

  const cleanup = useCallback(() => {
    console.log('[Colosseum] Final cleanup');
    stopRequestedRef.current = true;
    roundTerminatedRef.current = true;
    generationRef.current++;
    abortSearch();
    botsRef.current = { white: null, black: null };
    onStopCallbackRef.current = null;
    positionCountsRef.current.clear();
    halfMoveClockRef.current = 0;
  }, []);

  return { stopMatch, cleanup };
};