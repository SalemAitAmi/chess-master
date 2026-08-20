import { useCallback } from "react";
import { useEngine } from "../hooks/useEngine";
import { useGameSession } from "../hooks/useGameSession";
import { useMoveSelection } from "../hooks/useMoveSelection";
import GamePageLayout, { EngineGate } from "../components/GamePageLayout";
import ChessBoard from "../components/ChessBoard";
import PromotionModal from "../components/PromotionModal";
import GameOverModal from "../components/GameOverModal";
import GameInfoPanel from "../components/GameInfoPanel";
import MoveHistory from "../components/MoveHistory";
import CapturedPieces from "../components/CapturedPieces";
import { lastMoveToCoords, selectionToBoard } from "../utils/chessUtils";
import { reportFailure } from "../utils/failure";

const BTN = 'px-6 py-3 rounded-lg text-lg font-semibold transition-all';

const LocalPlayPage = ({ onBackToMenu }) => {
  // ═════════════════════════════════════════════════════════════════════════
  // HOOKS
  // ═════════════════════════════════════════════════════════════════════════
  const engine = useEngine();
  const session = useGameSession(engine);
  const { gameState, moveHistory, busy, setBusy, applyEngineState, rollbackHistory, resign, startNewGame } = session;

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
  // The engine reports winner='draw' for every drawn termination and 'none'
  // while undecided. Both mean "no winner".
  const winner = (gameState.winner === 'none' || gameState.winner === 'draw') ? null : gameState.winner;
  const canUndo = gameState.canundo && !busy && !gameOver;

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

  const handleSurrender = useCallback(() => {
    resign(gameState.turn);
  }, [resign, gameState.turn]);

  const handleRestart = useCallback(async () => {
    selection.clearSelection();
    await startNewGame();
  }, [selection, startNewGame]);

  // ═════════════════════════════════════════════════════════════════════════
  // EFFECTS — none beyond the session hook's init/watchdog
  // ═════════════════════════════════════════════════════════════════════════

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════
  return (
    <EngineGate engine={engine} session={session} onBackToMenu={onBackToMenu}>
      <GamePageLayout
        title="Local Play"
        subtitle="Two Player Mode"
        onBackToMenu={onBackToMenu}

        /* ── BANNER ── */
        banner={busy ? (
          <div className="px-4 py-2 bg-gray-700 rounded-lg text-gray-300 animate-pulse">Applying move...</div>
        ) : null}

        /* ── LEFT ── */
        leftPanels={
          <>
            <GameInfoPanel gameState={gameState} />
            <CapturedPieces
              capturedWhite={gameState.captured_white}
              capturedBlack={gameState.captured_black}
            />
          </>
        }

        /* ── BOARD ── */
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

        /* ── CONTROLS ── */
        controls={!gameOver && selection.promotion === null ? (
          <>
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className={`${BTN} ${canUndo
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-600 cursor-not-allowed text-gray-400'}`}
            >
              ↶ Undo
            </button>
            <button
              onClick={handleSurrender}
              disabled={busy}
              className={`${BTN} bg-red-600 hover:bg-red-700 text-white`}
            >
              ⚑ Surrender
            </button>
          </>
        ) : null}

        /* ── RIGHT ── */
        rightPanels={<MoveHistory history={moveHistory} />}

        /* ── OVERLAYS ── */
        overlays={
          <>
            <PromotionModal promotion={selection.promotion} onPromotion={selection.handlePromotion} />
            <GameOverModal gameOver={gameOver} winner={winner} status={gameState.status} onRestart={handleRestart} />
          </>
        }
      />
    </EngineGate>
  );
};

export default LocalPlayPage;