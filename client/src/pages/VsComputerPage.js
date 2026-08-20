import { useState, useEffect, useCallback, useRef } from "react";
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
import { DIFFICULTY_NAMES, DIFFICULTY_DEPTHS, TIMEOUTS } from "../constants/gameConstants";
import { lastMoveToCoords, selectionToBoard } from "../utils/chessUtils";
import { reportFailure } from "../utils/failure";

const BTN = 'px-6 py-3 rounded-lg text-lg font-semibold transition-all';

const VsComputerPage = ({ playerColor, difficulty, onBackToMenu }) => {
  // ═════════════════════════════════════════════════════════════════════════
  // HOOKS
  // ═════════════════════════════════════════════════════════════════════════
  const engine = useEngine();
  const session = useGameSession(engine);
  const { gameState, moveHistory, initialized, busy, setBusy, applyEngineState, rollbackHistory, resign, startNewGame, mountedRef } = session;

  const [currentPlayerColor, setCurrentPlayerColor] = useState(playerColor);
  const [gamesPlayed, setGamesPlayed] = useState(0);
  const [engineThinking, setEngineThinking] = useState(false);
  const [engineError, setEngineError] = useState(null);

  const engineMoveRef = useRef(false);

  const gameOver = gameState.status !== 'ongoing';
  const isPlayerTurn = gameState.turn === currentPlayerColor;

  const selection = useMoveSelection({
    engine,
    enabled: engine.connected && !gameOver && !busy && !engineThinking && isPlayerTurn,
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
  const difficultyName = DIFFICULTY_NAMES[difficulty];
  const searchDepth = DIFFICULTY_DEPTHS[difficulty];
  const canUndo = gameState.canundo && !busy && !engineThinking && !gameOver;
  const engineShouldMove = initialized && engine.connected && !gameOver &&
                           !isPlayerTurn && !engineThinking && !busy && engineError === null;

  // ═════════════════════════════════════════════════════════════════════════
  // CALLBACKS
  // ═════════════════════════════════════════════════════════════════════════

  /* ── Engine move — NO setPosition, board keeps full history ── */
  const makeEngineMove = useCallback(async () => {
    if (engineMoveRef.current) return;
    engineMoveRef.current = true;
    setEngineThinking(true);
    try {
      const current = await engine.getGameState();
      if (!current) throw new Error('gamestate returned nothing before engine move');
      if (!mountedRef.current) return;
      if (current.status !== 'ongoing') return;

      const result = await engine.go({ depth: searchDepth });
      if (!mountedRef.current) return;
      if (!result.move || result.move === '(none)') {
        throw new Error(`engine returned no move (bestmove ${result.move})`);
      }

      const newState = await engine.makeMove(result.move);
      if (!mountedRef.current) return;
      if (!applyEngineState(newState)) throw new Error(`makemove ${result.move} rejected`);
    } catch (err) {
      reportFailure('VsComputerPage.makeEngineMove', err);
      if (mountedRef.current) setEngineError(err.message || 'Engine move failed');
    } finally {
      if (mountedRef.current) setEngineThinking(false);
      engineMoveRef.current = false;
    }
  }, [engine, searchDepth, applyEngineState, mountedRef]);

  const handleRetryEngineMove = useCallback(() => {
    setEngineError(null);
  }, []);

  const handleUndo = useCallback(async () => {
    if (!gameState.canundo || busy || engineThinking) return;
    setBusy(true);
    try {
      // Undo the engine's reply AND the player's move so it is the player's turn.
      let newState = await engine.undoMove();
      if (!newState) throw new Error('undomove returned no state');
      let undoCount = 1;
      if (newState.canundo && newState.turn !== currentPlayerColor) {
        newState = await engine.undoMove();
        if (!newState) throw new Error('second undomove returned no state');
        undoCount = 2;
      }
      rollbackHistory(undoCount);
      applyEngineState(newState, false);
      selection.clearSelection();
      setEngineError(null);
    } catch (err) {
      reportFailure('VsComputerPage.handleUndo', err);
    } finally {
      setBusy(false);
    }
  }, [gameState.canundo, busy, engineThinking, setBusy, engine, currentPlayerColor, rollbackHistory, applyEngineState, selection]);

  const handleSurrender = useCallback(() => {
    resign(currentPlayerColor);
  }, [resign, currentPlayerColor]);

  const handleRestart = useCallback(async () => {
    const nextColor = currentPlayerColor === 'white' ? 'black' : 'white';
    setCurrentPlayerColor(nextColor);
    setGamesPlayed(p => p + 1);
    setEngineError(null);
    engineMoveRef.current = false;
    selection.clearSelection();
    await startNewGame();
  }, [currentPlayerColor, selection, startNewGame]);

  // ═════════════════════════════════════════════════════════════════════════
  // EFFECTS
  // ═════════════════════════════════════════════════════════════════════════

  // Engine's turn → move after a short pause.
  useEffect(() => {
    if (!engineShouldMove) return;
    const timer = setTimeout(makeEngineMove, TIMEOUTS.ENGINE_MOVE_DELAY);
    return () => clearTimeout(timer);
  }, [engineShouldMove, gameState.turn, makeEngineMove]);

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════
  const banner = engineError !== null ? (
    <div className="px-4 py-2 bg-red-900 rounded-lg text-red-200 flex items-center gap-3">
      <span>⚠ Engine move failed: <span className="font-mono text-sm">{engineError}</span></span>
      <button onClick={handleRetryEngineMove} className="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-sm">Retry</button>
    </div>
  ) : engineThinking ? (
    <div className="px-4 py-2 bg-gray-700 rounded-lg text-gray-300 animate-pulse">🤔 {difficultyName} is thinking...</div>
  ) : busy ? (
    <div className="px-4 py-2 bg-gray-700 rounded-lg text-gray-300 animate-pulse">Applying move...</div>
  ) : null;

  return (
    <EngineGate engine={engine} session={session} onBackToMenu={onBackToMenu}>
      <GamePageLayout
        title="VS Computer"
        subtitle={`${difficultyName} • Playing as ${currentPlayerColor}${gamesPlayed > 0 ? ` • Game #${gamesPlayed + 1}` : ''}`}
        onBackToMenu={onBackToMenu}

        /* ── BANNER ── */
        banner={banner}

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
            flipped={currentPlayerColor === 'black'}
            disabled={busy || engineThinking || gameOver || !isPlayerTurn}
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
              disabled={busy || engineThinking}
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

export default VsComputerPage;