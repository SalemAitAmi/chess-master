import { useState, useCallback } from 'react';
import { useEngine } from '../hooks/useEngine';
import { useGameSession, useStartFen } from '../hooks/useGameSession';
import { useMoveSelection } from '../hooks/useMoveSelection';
import { useMatchRecord } from '../hooks/useMatchRecord';
import GamePageLayout, { EngineGate, PlayerControls } from '../components/GamePageLayout';
import ChessBoard from '../components/ChessBoard';
import PromotionModal from '../components/PromotionModal';
import GameOverModal from '../components/GameOverModal';
import GameInfoPanel from '../components/GameInfoPanel';
import MoveHistory from '../components/MoveHistory';
import CapturedPieces from '../components/CapturedPieces';
import MatchScore from '../components/MatchScore';
import { Banner } from '../components/primitives';
import { lastMoveToCoords, selectionToBoard, otherColor, winnerColor } from '../utils/chessUtils';
import { capitalize } from '../utils/text';
import { reportFailure } from '../utils/failure';

const NAMES = { p1: 'Player 1', p2: 'Player 2' };

/** Two humans at one board. The board flips to the side to move. */
const LocalPlayPage = ({ onBackToMenu }) => {
  // ── Engine + session ──
  const engine = useEngine();
  const startFen = useStartFen();
  const session = useGameSession(engine, { startFen });
  const { gameState, moveHistory, busy, setBusy, applyEngineState, rollbackHistory, resign, startNewGame } = session;

  // ── State ──
  // Player 1 starts as White; sides swap every game.
  const [player1Color, setPlayer1Color] = useState('white');

  // ── Derived ──
  const gameOver = gameState.status !== 'ongoing';
  const whiteId = player1Color === 'white' ? 'p1' : 'p2';
  const blackId = whiteId === 'p1' ? 'p2' : 'p1';

  // ── Composed hooks ──
  const match = useMatchRecord({ gameState, whiteId, blackId, moveCount: moveHistory.length });
  const selection = useMoveSelection({
    engine, enabled: engine.connected && !gameOver && !busy,
    turn: gameState.turn, applyEngineState, setBusy,
  });
  const { clearSelection } = selection;

  // ── Derived (from composed hooks) ──
  const canUndo = gameState.canundo && !busy && !gameOver;
  const sides = [
    { id: 'p1', name: NAMES.p1, short: 'P1', accent: 'text-cyan-300', playing: player1Color },
    { id: 'p2', name: NAMES.p2, short: 'P2', accent: 'text-pink-300', playing: otherColor(player1Color) },
  ];
  const gameNumber = match.results.length > 0 ? ` • Game #${match.results.length + (gameOver ? 0 : 1)}` : '';

  // ── Callbacks ──
  const handleUndo = useCallback(async () => {
    if (!gameState.canundo || busy) return;
    setBusy(true);
    try {
      const newState = await engine.undoMove();
      if (!newState) throw new Error('undomove returned no state');
      rollbackHistory(1);
      applyEngineState(newState, false);
      clearSelection();
    } catch (err) {
      reportFailure('LocalPlayPage.handleUndo', err);
    } finally {
      setBusy(false);
    }
  }, [gameState.canundo, busy, setBusy, engine, rollbackHistory, applyEngineState, clearSelection]);

  const handleSurrender = useCallback(() => resign(gameState.turn), [resign, gameState.turn]);

  const handleRestart = useCallback(async () => {
    setPlayer1Color(otherColor);
    clearSelection();
    await startNewGame();
  }, [clearSelection, startNewGame]);

  // ── Render ──
  return (
    <EngineGate engine={engine} session={session} onBackToMenu={onBackToMenu}>
      <GamePageLayout
        title="Local Play"
        subtitle={`Player 1 (${capitalize(player1Color)}) vs Player 2 (${capitalize(otherColor(player1Color))})${gameNumber}`}
        onBackToMenu={onBackToMenu}
        banner={busy ? <Banner pulse>Applying move...</Banner> : null}
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
            selected={selectionToBoard(selection.selected, selection.legalMoves)}
            lastMove={lastMoveToCoords(gameState.lastmove)}
            onSquareClick={selection.handleSquareClick}
            flipped={gameState.turn === 'black'}
            disabled={busy || gameOver}
          />
        }
        controls={!gameOver && selection.promotion === null ? (
          <PlayerControls canUndo={canUndo} onUndo={handleUndo} onSurrender={handleSurrender} surrenderDisabled={busy} />
        ) : null}
        rightPanels={<MoveHistory history={moveHistory} startFen={startFen} />}
        overlays={
          <>
            <PromotionModal promotion={selection.promotion} onPromotion={selection.handlePromotion} />
            <GameOverModal gameOver={gameOver} winner={winnerColor(gameState)}
              winnerName={match.winnerId ? NAMES[match.winnerId] : null}
              status={gameState.status} onRestart={handleRestart} />
          </>
        }
      />
    </EngineGate>
  );
};

export default LocalPlayPage;