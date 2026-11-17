import { useState, useEffect, useCallback, useRef } from 'react';
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
import { Banner, Button } from '../components/primitives';
import { DIFFICULTY_NAMES, DIFFICULTY_DEPTHS, TIMEOUTS } from '../constants/gameConstants';
import { lastMoveToCoords, selectionToBoard, otherColor, winnerColor } from '../utils/chessUtils';
import { reportFailure } from '../utils/failure';

const SIDE_NAMES = { player: 'Player', computer: 'Computer' };

/** Human vs the e0 engine. Colours swap every game; the board follows the player. */
const VsComputerPage = ({ playerColor, difficulty, onBackToMenu }) => {
  // ── Engine + session ──
  const engine = useEngine();
  const startFen = useStartFen();
  const session = useGameSession(engine, { startFen });
  const {
    gameState, moveHistory, initialized, busy, setBusy,
    applyEngineState, rollbackHistory, resign, startNewGame, mountedRef,
  } = session;

  // ── State ──
  const [currentPlayerColor, setCurrentPlayerColor] = useState(playerColor);
  const [gamesPlayed, setGamesPlayed] = useState(0);
  const [engineThinking, setEngineThinking] = useState(false);
  const [engineError, setEngineError] = useState(null);

  // ── Refs ──
  const engineMoveRef = useRef(false);   // one engine move in flight at a time

  // ── Derived ──
  const gameOver = gameState.status !== 'ongoing';
  const isPlayerTurn = gameState.turn === currentPlayerColor;
  const computerColor = otherColor(currentPlayerColor);
  const difficultyName = DIFFICULTY_NAMES[difficulty];
  const searchDepth = DIFFICULTY_DEPTHS[difficulty];

  // ── Composed hooks ──
  const selection = useMoveSelection({
    engine, enabled: engine.connected && !gameOver && !busy && !engineThinking && isPlayerTurn,
    turn: gameState.turn, applyEngineState, setBusy,
  });
  const { clearSelection } = selection;
  const match = useMatchRecord({
    gameState,
    whiteId: currentPlayerColor === 'white' ? 'player' : 'computer',
    blackId: currentPlayerColor === 'white' ? 'computer' : 'player',
    moveCount: moveHistory.length,
  });

  // ── Derived (from composed hooks) ──
  const canUndo = gameState.canundo && !busy && !engineThinking && !gameOver;
  const engineShouldMove = initialized && engine.connected && !gameOver &&
                           !isPlayerTurn && !engineThinking && !busy && engineError === null;
  const sides = [
    { id: 'player', name: SIDE_NAMES.player, accent: 'text-cyan-300', playing: currentPlayerColor },
    { id: 'computer', name: SIDE_NAMES.computer, detail: difficultyName, accent: 'text-pink-300', playing: computerColor },
  ];

  // ── Callbacks ──

  /** Engine move. NO setPosition: the engine's board keeps full history (repetition, undo). */
  const makeEngineMove = useCallback(async () => {
    if (engineMoveRef.current) return;
    engineMoveRef.current = true;
    setEngineThinking(true);
    try {
      const current = await engine.getGameState();
      if (!current) throw new Error('gamestate returned nothing before engine move');
      if (!mountedRef.current || current.status !== 'ongoing') return;
      const result = await engine.go({ depth: searchDepth });
      if (!mountedRef.current) return;
      if (!result.move || result.move === '(none)') throw new Error(`engine returned no move (bestmove ${result.move})`);
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

  /** Clearing the error re-arms `engineShouldMove`, which retries via the effect. */
  const handleRetryEngineMove = useCallback(() => setEngineError(null), []);

  const handleUndo = useCallback(async () => {
    if (!gameState.canundo || busy || engineThinking) return;
    setBusy(true);
    try {
      // Undo the engine's reply AND the player's move so it is the player's turn again.
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
      clearSelection();
      setEngineError(null);
    } catch (err) {
      reportFailure('VsComputerPage.handleUndo', err);
    } finally {
      setBusy(false);
    }
  }, [gameState.canundo, busy, engineThinking, setBusy, engine, currentPlayerColor, rollbackHistory, applyEngineState, clearSelection]);

  const handleSurrender = useCallback(() => resign(currentPlayerColor), [resign, currentPlayerColor]);

  const handleRestart = useCallback(async () => {
    setCurrentPlayerColor(otherColor(currentPlayerColor));
    setGamesPlayed(p => p + 1);
    setEngineError(null);
    engineMoveRef.current = false;
    clearSelection();
    await startNewGame();
  }, [currentPlayerColor, clearSelection, startNewGame]);

  // ── Effects ──

  // Engine's turn → move after a short pause (so the player's move is seen landing).
  useEffect(() => {
    if (!engineShouldMove) return undefined;
    const timer = setTimeout(makeEngineMove, TIMEOUTS.ENGINE_MOVE_DELAY);
    return () => clearTimeout(timer);
  }, [engineShouldMove, gameState.turn, makeEngineMove]);

  // ── Render ──
  let banner = null;
  if (engineError !== null) {
    banner = (
      <Banner tone="error">
        <span>⚠ Engine move failed: <span className="font-mono text-sm">{engineError}</span></span>
        <Button size="sm" tone="danger" onClick={handleRetryEngineMove}>Retry</Button>
      </Banner>
    );
  } else if (engineThinking) {
    banner = <Banner pulse>🤔 {difficultyName} is thinking...</Banner>;
  } else if (busy) {
    banner = <Banner pulse>Applying move...</Banner>;
  }

  return (
    <EngineGate engine={engine} session={session} onBackToMenu={onBackToMenu}>
      <GamePageLayout
        title="VS Computer"
        subtitle={`${difficultyName} • Playing as ${currentPlayerColor}${gamesPlayed > 0 ? ` • Game #${gamesPlayed + 1}` : ''}`}
        onBackToMenu={onBackToMenu}
        banner={banner}
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
            flipped={currentPlayerColor === 'black'}
            disabled={busy || engineThinking || gameOver || !isPlayerTurn}
          />
        }
        controls={!gameOver && selection.promotion === null ? (
          <PlayerControls canUndo={canUndo} onUndo={handleUndo} onSurrender={handleSurrender}
            surrenderDisabled={busy || engineThinking} />
        ) : null}
        rightPanels={<MoveHistory history={moveHistory} startFen={startFen} />}
        overlays={
          <>
            <PromotionModal promotion={selection.promotion} onPromotion={selection.handlePromotion} />
            <GameOverModal gameOver={gameOver} winner={winnerColor(gameState)}
              winnerName={match.winnerId ? SIDE_NAMES[match.winnerId] : null}
              status={gameState.status} onRestart={handleRestart} />
          </>
        }
      />
    </EngineGate>
  );
};

export default VsComputerPage;