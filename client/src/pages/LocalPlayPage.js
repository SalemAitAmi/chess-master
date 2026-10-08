import { useState, useCallback, useMemo } from "react";
import { useEngine } from "../hooks/useEngine";
import { useGameSession } from "../hooks/useGameSession";
import { useMoveSelection } from "../hooks/useMoveSelection";
import { useMatchRecord } from "../hooks/useMatchRecord";
import GamePageLayout, { EngineGate } from "../components/GamePageLayout";
import ChessBoard from "../components/ChessBoard";
import PromotionModal from "../components/PromotionModal";
import GameOverModal from "../components/GameOverModal";
import GameInfoPanel from "../components/GameInfoPanel";
import MoveHistory from "../components/MoveHistory";
import CapturedPieces from "../components/CapturedPieces";
import MatchScore from "../components/MatchScore";
import { lastMoveToCoords, selectionToBoard } from "../utils/chessUtils";
import { reportFailure } from "../utils/failure";
import { getSettings } from "../config/settings";

const BTN = 'px-6 py-3 rounded-lg text-lg font-semibold transition-all';
const NAMES = { p1: 'Player 1', p2: 'Player 2' };
const other = (c) => (c === 'white' ? 'black' : 'white');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const LocalPlayPage = ({ onBackToMenu }) => {
  // ═════════════════════════════════════════════════════════════════════════
  // HOOKS
  // ═════════════════════════════════════════════════════════════════════════
  const engine = useEngine();
  const startFen = useMemo(() => (getSettings().client.startFen || '').trim(), []);
  const session = useGameSession(engine, { startFen });
  const { gameState, moveHistory, busy, setBusy, applyEngineState, rollbackHistory, resign, startNewGame } = session;
  // Player 1 starts as White; sides swap every game.
  const [player1Color, setPlayer1Color] = useState('white');
  const whiteId = player1Color === 'white' ? 'p1' : 'p2';
  const blackId = whiteId === 'p1' ? 'p2' : 'p1';
  const match = useMatchRecord({ gameState, whiteId, blackId, moveCount: moveHistory.length });
  const gameOver = gameState.status !== 'ongoing';
  const selection = useMoveSelection({
    engine,
    enabled: engine.connected && !gameOver && !busy,
    turn: gameState.turn,
    applyEngineState,
    setBusy,
  });
  // ═════════════════════════════════════════════════════════════════════════
  // DERIVED
  // ═════════════════════════════════════════════════════════════════════════
  const lastMove = lastMoveToCoords(gameState.lastmove);
  const selectedWithMoves = selectionToBoard(selection.selected, selection.legalMoves);
  const winner = (gameState.winner === 'none' || gameState.winner === 'draw') ? null : gameState.winner;
  const canUndo = gameState.canundo && !busy && !gameOver;
  const sides = [
    { id: 'p1', name: NAMES.p1, short: 'P1', accent: 'text-cyan-300', playing: player1Color },
    { id: 'p2', name: NAMES.p2, short: 'P2', accent: 'text-pink-300', playing: other(player1Color) },
  ];
  // ═════════════════════════════════════════════════════════════════════════
  // CALLBACKS
  // ═════════════════════════════════════════════════════════════════════════
  const handleUndo = useCallback(async () => {
    if (!gameState.canundo || busy) return;
    setBusy(true);
    try {
      const newState = await engine.undoMove();
      if (!newState) throw new Error('undomove returned no state');
      rollbackHistory(1);
      applyEngineState(newState, false);
      selection.clearSelection();
    } catch (err) {
      reportFailure('LocalPlayPage.handleUndo', err);
    } finally {
      setBusy(false);
    }
  }, [gameState.canundo, busy, setBusy, engine, rollbackHistory, applyEngineState, selection]);
  const handleSurrender = useCallback(() => { resign(gameState.turn); }, [resign, gameState.turn]);
  const handleRestart = useCallback(async () => {
    setPlayer1Color(other);
    selection.clearSelection();
    await startNewGame();
  }, [selection, startNewGame]);
  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════
  return (
    <EngineGate engine={engine} session={session} onBackToMenu={onBackToMenu}>
      <GamePageLayout
        title="Local Play"
        subtitle={`Player 1 (${cap(player1Color)}) vs Player 2 (${cap(other(player1Color))})` +
                  (match.results.length > 0 ? ` • Game #${match.results.length + (gameOver ? 0 : 1)}` : '')}
        onBackToMenu={onBackToMenu}
        banner={busy ? (
          <div className="px-4 py-2 bg-gray-700 rounded-lg text-gray-300 animate-pulse">Applying move...</div>
        ) : null}
        leftPanels={
          <>
            <GameInfoPanel gameState={gameState} />
            <CapturedPieces capturedWhite={gameState.captured_white} capturedBlack={gameState.captured_black} />
            <MatchScore sides={sides} results={match.results} />
          </>
        }
        board={
          <ChessBoard
            fen={gameState.fen}
            selected={selectedWithMoves}
            legalMoves={selection.legalMoves}
            lastMove={lastMove}
            onSquareClick={selection.handleSquareClick}
            flipped={gameState.turn === 'black'}
            disabled={busy || gameOver}
          />
        }
        controls={!gameOver && selection.promotion === null ? (
          <>
            <button onClick={handleUndo} disabled={!canUndo}
              className={`${BTN} ${canUndo ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-600 cursor-not-allowed text-gray-400'}`}>
              ↶ Undo
            </button>
            <button onClick={handleSurrender} disabled={busy}
              className={`${BTN} bg-red-600 hover:bg-red-700 text-white`}>
              ⚑ Surrender
            </button>
          </>
        ) : null}
        rightPanels={<MoveHistory history={moveHistory} startFen={startFen} />}
        overlays={
          <>
            <PromotionModal promotion={selection.promotion} onPromotion={selection.handlePromotion} />
            <GameOverModal gameOver={gameOver} winner={winner}
              winnerName={match.winnerId ? NAMES[match.winnerId] : null}
              status={gameState.status} onRestart={handleRestart} />
          </>
        }
      />
    </EngineGate>
  );
};
export default LocalPlayPage;