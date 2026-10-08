/**
 * Records one result per finished game, attributed to SIDE IDs.
 *
 * The side assignment is captured while a game is ONGOING and frozen once it
 * ends. Pages swap colours in their restart handler BEFORE the new game's
 * state arrives; reading live colours at record time (or when rendering the
 * game-over headline) would credit the other side.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
export function useMatchRecord({ gameState, whiteId, blackId, moveCount }) {
  const over = gameState.status !== 'ongoing';
  const [sides, setSides] = useState({ whiteId, blackId });
  const [results, setResults] = useState([]);
  const recordedRef = useRef(false);
  useEffect(() => {
    if (over) return;
    recordedRef.current = false;
    setSides(prev => (prev.whiteId === whiteId && prev.blackId === blackId) ? prev : { whiteId, blackId });
  }, [over, whiteId, blackId]);
  useEffect(() => {
    if (!over || recordedRef.current) return;
    recordedRef.current = true;
    const winnerColor = gameState.winner === 'white' || gameState.winner === 'black' ? gameState.winner : null;
    const winnerId = winnerColor === 'white' ? sides.whiteId : winnerColor === 'black' ? sides.blackId : null;
    setResults(prev => [...prev, {
      round: prev.length + 1, winnerId, winnerColor, status: gameState.status,
      moves: moveCount, whiteId: sides.whiteId, blackId: sides.blackId,
    }]);
  }, [over, gameState.status, gameState.winner, moveCount, sides]);
  const winnerId = over && gameState.winner === 'white' ? sides.whiteId
                 : over && gameState.winner === 'black' ? sides.blackId : null;
  const reset = useCallback(() => setResults([]), []);
  return { results, sides, winnerId, reset };
}
export default useMatchRecord;