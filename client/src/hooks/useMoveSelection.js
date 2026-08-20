/**
 * Human move input: click-to-select, click-to-move, promotion prompt.
 * Shared by Local Play and vs Computer. Owns no game state — it submits
 * `makemove` and hands the resulting block to `applyEngineState`.
 */
import { useState, useCallback } from 'react';
import { squareFromRowCol } from '../utils/chessUtils';
import { reportFailure } from '../utils/failure';

export function useMoveSelection({ engine, enabled, turn, applyEngineState, setBusy }) {
  // ── Hooks: state ──
  const [selected, setSelected] = useState(null);      // [row, col]
  const [legalMoves, setLegalMoves] = useState([]);    // UCI strings from the engine
  const [promotion, setPromotion] = useState(null);    // { from, to, color }

  // ── Hooks: stable engine functions ──
  const { getLegalMoves, makeMove } = engine;

  // ── Callbacks ──
  const clearSelection = useCallback(() => {
    setSelected(null);
    setLegalMoves([]);
    setPromotion(null);
  }, []);

  const fetchLegalMoves = useCallback(async (row, col) => {
    try {
      const result = await getLegalMoves(squareFromRowCol(row, col));
      return Array.isArray(result.moves) ? result.moves : [];
    } catch (err) {
      reportFailure('useMoveSelection.fetchLegalMoves', err);
      return [];
    }
  }, [getLegalMoves]);

  const submitMove = useCallback(async (moveStr) => {
    setBusy(true);
    try {
      const newState = await makeMove(moveStr);
      if (!applyEngineState(newState)) throw new Error(`makemove ${moveStr} returned no usable state`);
      clearSelection();
      return true;
    } catch (err) {
      reportFailure('useMoveSelection.submitMove', err);
      clearSelection();          // NOTE: never leave a stale selection or modal on failure
      return false;
    } finally {
      setBusy(false);
    }
  }, [makeMove, applyEngineState, clearSelection, setBusy]);

  const handleSquareClick = useCallback(async (row, col) => {
    if (!enabled || promotion !== null) return;
    const clicked = squareFromRowCol(row, col);

    if (selected !== null) {
      const from = squareFromRowCol(selected[0], selected[1]);
      const moveStr = from + clicked;
      const matching = legalMoves.filter(m => m.startsWith(moveStr));
      if (matching.length > 0) {
        const needsPromotion = matching.some(m => m.length > 4);
        if (needsPromotion) {
          setPromotion({ from, to: clicked, color: turn === 'white' ? 'w' : 'b' });
          return;
        }
        await submitMove(moveStr);
        return;
      }
    }

    // Not a target: (re)select whatever is on the clicked square, if movable.
    const moves = await fetchLegalMoves(row, col);
    if (moves.length > 0) {
      setSelected([row, col]);
      setLegalMoves(moves);
      setPromotion(null);
    } else {
      clearSelection();
    }
  }, [enabled, promotion, selected, legalMoves, turn, submitMove, fetchLegalMoves, clearSelection]);

  const handlePromotion = useCallback(async (pieceChar) => {
    if (promotion === null) return;
    const moveStr = promotion.from + promotion.to + pieceChar;
    setPromotion(null);
    await submitMove(moveStr);
  }, [promotion, submitMove]);

  // ── Return ──
  return { selected, legalMoves, promotion, handleSquareClick, handlePromotion, clearSelection };
}

export default useMoveSelection;