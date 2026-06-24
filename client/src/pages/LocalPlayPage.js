import { useState, useEffect, useCallback, useRef } from "react";
import { useEngine } from "../hooks/useEngine";
import ChessBoard from "../components/ChessBoard";
import PromotionModal from "../components/PromotionModal";
import GameOverModal from "../components/GameOverModal";
import GameInfoPanel from "../components/GameInfoPanel";
import MoveHistory from "../components/MoveHistory";
import CapturedPieces from "../components/CapturedPieces";
import { indexToSquare, rowColToIndex, squareToIndex, indexToRowCol } from "../utils/bitboard";

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const initialGameState = {
  fen: STARTING_FEN,
  turn: 'white',
  fullmove: 1,
  halfmove: 0,
  status: 'ongoing',
  winner: 'none',
  incheck: false,
  eval: 0,
  material_white: 3900,
  material_black: 3900,
  captured_white: [],
  captured_black: [],
  canundo: false,
  blunder: false,
  lastmove: null
};

const LocalPlayPage = ({ onBackToMenu }) => {
  const engine = useEngine();
  
  const [gameState, setGameState] = useState(initialGameState);
  const [moveHistory, setMoveHistory] = useState([]); // Client-side history cache
  const [selected, setSelected] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [promotion, setPromotion] = useState(null);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const mountedRef = useRef(true);
  const initRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Update game state from engine, preserving client history
  const updateGameState = useCallback((engineState, appendMove = null) => {
    if (!engineState) return;
    
    setGameState(prev => ({
      ...prev,
      ...engineState,
      // Don't overwrite with engine's truncated history
    }));
    
    // Append new move to client history if provided
    if (appendMove) {
      setMoveHistory(prev => [...prev, appendMove]);
    }
  }, []);

  // Sync history from engine (used after undo/restart)
  const syncHistoryFromEngine = useCallback((engineState) => {
    if (!engineState) return;
    
    // Engine sends last 20 moves, but we need to handle cases where
    // we have fewer than 20 moves total
    const engineHistory = engineState.history || [];
    const moveCount = engineState.movecount || 0;
    
    // If engine history matches expected count, use it directly
    if (engineHistory.length === moveCount) {
      setMoveHistory(engineHistory);
    } else {
      // Otherwise, we need to figure out the full history
      // This happens after undo - engine history is truncated
      // We'll use our cached history trimmed to moveCount
      setMoveHistory(prev => {
        if (moveCount <= prev.length) {
          return prev.slice(0, moveCount);
        }
        // Fallback: use engine history
        return engineHistory;
      });
    }
  }, []);

  // Initialize game
  useEffect(() => {
    if (!engine.connected || initRef.current) return;
    
    const init = async () => {
      initRef.current = true;
      try {
        await engine.newGame();
        const state = await engine.getGameState();
        if (state && mountedRef.current) {
          setGameState({
            ...initialGameState,
            ...state
          });
          setMoveHistory([]); // Fresh game, no history
          setInitialized(true);
        }
      } catch (err) {
        console.error('Failed to initialize game:', err);
        initRef.current = false;
      }
    };
    
    init();
  }, [engine.connected]);

  // Fetch legal moves
  const fetchLegalMoves = useCallback(async (row, col) => {
    if (!engine.connected) return [];
    
    const square = indexToSquare(rowColToIndex(row, col));
    try {
      const result = await engine.getLegalMoves(square);
      return result?.moves || [];
    } catch (err) {
      console.error('Failed to get legal moves:', err);
      return [];
    }
  }, [engine.connected, engine.getLegalMoves]);

  const handleSquareClick = useCallback(async (row, col) => {
    if (gameState.status !== 'ongoing' || promotion || loading) return;
    if (!engine.connected) return;

    const clickedSquare = indexToSquare(rowColToIndex(row, col));

    if (selected) {
      const [selRow, selCol] = selected;
      const fromSquare = indexToSquare(rowColToIndex(selRow, selCol));
      const moveStr = fromSquare + clickedSquare;

      // Check if valid move
      const isValidMove = legalMoves.some(m => m === moveStr || m.startsWith(moveStr));

      if (isValidMove) {
        // Check if promotion needed
        const promotionMoves = legalMoves.filter(m => m.startsWith(moveStr) && m.length > 4);
        
        if (promotionMoves.length > 0) {
          setPromotion({
            from: fromSquare,
            to: clickedSquare,
            color: gameState.turn === 'white' ? 'w' : 'b'
          });
          return;
        }

        // Execute move
        setLoading(true);
        try {
          const newState = await engine.makeMove(moveStr);
          if (newState && mountedRef.current) {
            updateGameState(newState, moveStr);
            setSelected(null);
            setLegalMoves([]);
          }
        } catch (err) {
          console.error('Move failed:', err);
        }
        setLoading(false);
        return;
      }

      // Check if clicked on own piece
      const moves = await fetchLegalMoves(row, col);
      if (moves.length > 0) {
        setSelected([row, col]);
        setLegalMoves(moves);
      } else {
        setSelected(null);
        setLegalMoves([]);
      }
    } else {
      // Try to select piece
      const moves = await fetchLegalMoves(row, col);
      if (moves.length > 0) {
        setSelected([row, col]);
        setLegalMoves(moves);
      }
    }
  }, [selected, legalMoves, gameState.status, gameState.turn, promotion, loading, 
      engine.connected, engine.makeMove, fetchLegalMoves, updateGameState]);

  const handlePromotion = useCallback(async (pieceType) => {
    if (!promotion || !engine.connected) return;

    const moveStr = promotion.from + promotion.to + pieceType;
    
    setLoading(true);
    try {
      const newState = await engine.makeMove(moveStr);
      if (newState && mountedRef.current) {
        updateGameState(newState, moveStr);
        setSelected(null);
        setLegalMoves([]);
        setPromotion(null);
      }
    } catch (err) {
      console.error('Promotion failed:', err);
    }
    setLoading(false);
  }, [promotion, engine.connected, engine.makeMove, updateGameState]);

  const handleUndo = useCallback(async () => {
    if (!gameState.canundo || !engine.connected || loading) return;

    setLoading(true);
    try {
      const newState = await engine.undoMove();
      if (newState && mountedRef.current) {
        // Pop the last move from client history
        setMoveHistory(prev => prev.slice(0, -1));
        updateGameState(newState);
        setSelected(null);
        setLegalMoves([]);
      }
    } catch (err) {
      console.error('Undo failed:', err);
    }
    setLoading(false);
  }, [gameState.canundo, loading, engine.connected, engine.undoMove, updateGameState]);

  const handleSurrender = useCallback(() => {
    setGameState(prev => ({
      ...prev,
      status: 'resignation',
      winner: prev.turn === 'white' ? 'black' : 'white'
    }));
  }, []);

  const handleRestart = useCallback(async () => {
    if (!engine.connected) return;
    
    setLoading(true);
    initRef.current = false; // Allow re-init
    
    try {
      await engine.newGame();
      const newState = await engine.getGameState();
      if (newState && mountedRef.current) {
        setGameState({
          ...initialGameState,
          ...newState
        });
        setMoveHistory([]); // Clear history for new game
        setSelected(null);
        setLegalMoves([]);
        setPromotion(null);
        setInitialized(true);
      }
    } catch (err) {
      console.error('Restart failed:', err);
    }
    setLoading(false);
  }, [engine.connected, engine.newGame, engine.getGameState]);

  // Calculate last move for highlighting
  const lastMove = gameState.lastmove ? (() => {
    const from = squareToIndex(gameState.lastmove.slice(0, 2));
    const to = squareToIndex(gameState.lastmove.slice(2, 4));
    if (from === -1 || to === -1) return null;
    return { from: indexToRowCol(from), to: indexToRowCol(to) };
  })() : null;

  // Convert legal moves to board coordinates for highlighting
  const selectedWithMoves = selected ? {
    row: selected[0],
    col: selected[1],
    moves: legalMoves.map(m => {
      const toIdx = squareToIndex(m.slice(2, 4));
      return toIdx !== -1 ? indexToRowCol(toIdx) : null;
    }).filter(Boolean)
  } : null;

  const gameOver = gameState.status !== 'ongoing';
  const winner = gameState.winner === 'none' ? null : gameState.winner;

  if (!engine.connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900">
        <div className="text-white text-xl mb-4">Connecting to engine...</div>
        {engine.error && <div className="text-red-400 mb-4">{engine.error}</div>}
        <button
          onClick={engine.reconnect}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Retry Connection
        </button>
        <button
          onClick={onBackToMenu}
          className="mt-4 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Back to Menu
        </button>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900">
        <div className="text-white text-xl">Initializing game...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 relative font-sans">
      <div className="absolute top-4 left-4">
        <button
          onClick={onBackToMenu}
          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 
            transition-all duration-200 shadow-md text-sm font-semibold"
        >
          ← Main Menu
        </button>
      </div>

      <div className="mb-6 text-center">
        <h1 className="text-4xl font-bold text-white mb-2">Local Play</h1>
        <div className="text-gray-400">Two Player Mode</div>
      </div>

      <div className="flex gap-6 items-start">
        <div className="space-y-4">
          <GameInfoPanel gameState={gameState} />
          <CapturedPieces
            capturedWhite={gameState.captured_white}
            capturedBlack={gameState.captured_black}
          />
        </div>

        <div className="flex flex-col items-center">
          <ChessBoard
            fen={gameState.fen}
            selected={selectedWithMoves}
            legalMoves={legalMoves}
            lastMove={lastMove}
            onSquareClick={handleSquareClick}
            flipped={gameState.turn === 'black'}
            disabled={loading || gameOver}
          />

          <div className="mt-6 flex gap-4">
            {!gameOver && !promotion && (
              <>
                <button
                  onClick={handleUndo}
                  disabled={!gameState.canundo || loading}
                  className={`px-6 py-3 rounded-lg transition-all text-lg font-semibold
                    ${gameState.canundo && !loading
                      ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                      : 'bg-gray-600 cursor-not-allowed text-gray-400'}`}
                >
                  ↶ Undo
                </button>
                
                <button
                  onClick={handleSurrender}
                  disabled={loading}
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg text-lg font-semibold"
                >
                  ⚑ Surrender
                </button>
              </>
            )}
          </div>
        </div>

        {/* Use client-cached history */}
        <MoveHistory history={moveHistory} />
      </div>

      <PromotionModal promotion={promotion} onPromotion={handlePromotion} />
      <GameOverModal gameOver={gameOver} winner={winner} onRestart={handleRestart} />
    </div>
  );
};

export default LocalPlayPage;