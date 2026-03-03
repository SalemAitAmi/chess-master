import { useEffect, useState, useRef, useCallback } from "react";
import { useGameState } from "./hooks/useGameState";
import { useEngine, LOG_CATEGORY } from "./hooks/useEngine";
import { createGameHandlers } from "./handlers/gameHandlers";
import { isInCheck, getValidMoves, simulateMove, hasValidMoves } from "./utils/chessLogic";
import { getPieceAt, boardToFen } from "./utils/chessUtils";
import { PIECES } from "./constants/gameConstants";
import { rowColToIndex, indexToRowCol, indexToSquare } from "./utils/bitboard";
import ChessBoard from "./components/ChessBoard";
import PromotionModal from "./components/PromotionModal";
import GameOverModal from "./components/GameOverModal";
import MainMenu from "./components/MainMenu";

const DIFFICULTY_DEPTHS = {
  1: 4,   // Rookie
  2: 6,   // Casual
  3: 8,   // Strategic
  4: 12   // Master
};

const DIFFICULTY_NAMES = {
  1: 'Rookie',
  2: 'Casual',
  3: 'Strategic',
  4: 'Master'
};

const ChessApp = () => {
  const gameState = useGameState();
  const engine = useEngine('ws://localhost:8080');

  const [playerColor, setPlayerColor] = useState("white");
  const [difficulty, setDifficulty] = useState(2);
  const [gamesPlayed, setGamesPlayed] = useState(0);

  // Colosseum state
  const [colosseumConfig, setColosseumConfig] = useState(null);
  const [colosseumResults, setColosseumResults] = useState([]);
  const [currentRound, setCurrentRound] = useState(0);
  const colosseumRunning = useRef(false);
  
  // Track if we're waiting for engine move
  const waitingForEngine = useRef(false);

  const {
    boardObj,
    setBoard,
    selected,
    setSelected,
    turn,
    gameOver,
    winner,
    lastMove,
    setLastMove,
    promotion,
    gameMode,
    setGameMode,
    setGameOver,
    setWinner,
    resetGame,
    resetToMenu,
    addMove,
  } = gameState;

  // Determine if it's the player's turn
  const isPlayerTurn = useCallback(() => {
    if (gameMode === 'local') return true;
    if (gameMode === 'vs-computer') return turn === playerColor;
    if (gameMode === 'colosseum') return false; // Never player's turn in colosseum
    return true;
  }, [gameMode, turn, playerColor]);

  // Check if interaction should be blocked
  const isInteractionBlocked = useCallback(() => {
    if (gameOver) return true;
    if (promotion) return false; // Allow promotion selection
    if (engine.thinking) return true;
    if (waitingForEngine.current) return true;
    if (!isPlayerTurn()) return true;
    return false;
  }, [gameOver, promotion, engine.thinking, isPlayerTurn]);

  // Calculate valid moves for selected piece
  const [selectedWithMoves, setSelectedWithMoves] = useState(null);
  const prevSelectedRef = useRef();

  useEffect(() => {
    if (prevSelectedRef.current === selected) return;
    prevSelectedRef.current = selected;

    if (selected && !isInteractionBlocked()) {
      const [row, col] = selected;
      const piece = getPieceAt(boardObj, row, col);

      if (piece) {
        const moves = getValidMoves(row, col, boardObj);
        const currentColor = boardObj.gameState.active_color;
        const validMoves = moves.filter(([toRow, toCol]) => {
          const result = simulateMove(row, col, toRow, toCol, boardObj);
          return !isInCheck(result.board, currentColor);
        });

        setSelectedWithMoves({ row, col, moves: validMoves });
      }
    } else {
      setSelectedWithMoves(null);
    }
  }, [selected, boardObj, isInteractionBlocked]);

  // Make engine move
  const makeEngineMove = useCallback(async (currentBoard) => {
    if (!engine.connected || gameOver) return;
    if (waitingForEngine.current) return; // Prevent duplicate calls

    waitingForEngine.current = true;

    try {
      const fen = boardToFen(currentBoard);
      const depth = DIFFICULTY_DEPTHS[difficulty] || 6;

      const result = await engine.findBestMove(fen, { depth });

      if (result?.move && result.move !== '(none)') {
        applyEngineMove(result.move, currentBoard);
      }
    } catch (err) {
      console.error('Engine move error:', err);
    } finally {
      waitingForEngine.current = false;
    }
  }, [engine, gameOver, difficulty]);

  const applyEngineMove = useCallback((moveStr, currentBoard) => {
    const from = moveStr.slice(0, 2);
    const to = moveStr.slice(2, 4);
    const promo = moveStr.length > 4 ? moveStr[4] : null;

    const fromIndex = squareToIndex(from);
    const toIndex = squareToIndex(to);
    const [fromRow, fromCol] = indexToRowCol(fromIndex);
    const [toRow, toCol] = indexToRowCol(toIndex);

    const currentColor = currentBoard.gameState.active_color;
    const newBoard = currentBoard.clone();

    const pieceMap = { 'q': PIECES.QUEEN, 'r': PIECES.ROOK, 'b': PIECES.BISHOP, 'n': PIECES.KNIGHT };
    newBoard.makeMove(fromIndex, toIndex, promo ? pieceMap[promo] : null);

    setBoard(newBoard);
    setLastMove({ from: [fromRow, fromCol], to: [toRow, toCol] });
    setSelected(null);
    addMove(moveStr);

    // Check for game end
    const nextColor = newBoard.gameState.active_color;
    const opponentInCheck = isInCheck(newBoard, nextColor);
    const opponentHasMoves = hasValidMoves(nextColor, newBoard);

    if (!opponentHasMoves) {
      setGameOver(true);
      if (opponentInCheck) {
        setWinner(currentColor);
      } else {
        setWinner("draw");
      }
    } else if (gameMode === 'colosseum' && colosseumRunning.current) {
      // Continue colosseum game
      setTimeout(() => makeEngineMove(newBoard), 100);
    }
  }, [setBoard, setLastMove, setSelected, addMove, setGameOver, setWinner, gameMode, makeEngineMove]);

  // Handle move completion (for triggering engine response)
  const handleMoveComplete = useCallback(async (newBoard, moveStr) => {
    if (gameMode !== 'vs-computer' && gameMode !== 'colosseum') return;
    if (gameOver) return;

    const nextColor = newBoard.gameState.active_color;

    // In vs-computer, trigger engine if it's not player's turn
    if (gameMode === 'vs-computer' && nextColor !== playerColor) {
      await makeEngineMove(newBoard);
    }
  }, [gameMode, playerColor, gameOver, makeEngineMove]);

  const handlers = createGameHandlers(gameState, { onMoveComplete: handleMoveComplete });
  const { handlePromotion, handleUndo } = handlers;

  // Custom square click handler that checks if interaction is allowed
  const handleSquareClick = useCallback((row, col) => {
    // Block all interaction when not player's turn or engine is thinking
    if (isInteractionBlocked()) {
      console.log('Interaction blocked:', { 
        gameOver, 
        thinking: engine.thinking, 
        waitingForEngine: waitingForEngine.current,
        isPlayerTurn: isPlayerTurn() 
      });
      return;
    }

    const piece = getPieceAt(boardObj, row, col);
    const currentColor = boardObj.gameState.active_color;

    if (selected) {
      const [selectedRow, selectedCol] = selected;
      const selectedPiece = getPieceAt(boardObj, selectedRow, selectedCol);

      if (selectedPiece && selectedPiece.color === currentColor) {
        const moves = getValidMoves(selectedRow, selectedCol, boardObj, true);
        const validMove = moves.find(([r, c]) => r === row && c === col);

        if (validMove) {
          const result = simulateMove(selectedRow, selectedCol, row, col, boardObj);
          if (!isInCheck(result.board, currentColor)) {
            // Make the move
            handlers.makeMove(selectedRow, selectedCol, row, col);
            return;
          }
        }
      }

      // Select different piece or deselect
      if (piece && piece.color === currentColor) {
        setSelected([row, col]);
      } else {
        setSelected(null);
      }
    } else {
      // Select a piece
      if (piece && piece.color === currentColor) {
        setSelected([row, col]);
      }
    }
  }, [isInteractionBlocked, boardObj, selected, setSelected, handlers, gameOver, engine.thinking, isPlayerTurn]);

  // Initial bot move for vs-computer when bot plays white
  useEffect(() => {
    if (gameMode !== 'vs-computer' || gameOver) return;
    if (!engine.connected) return;
    if (engine.thinking || waitingForEngine.current) return;

    if (playerColor === "black" && turn === "white") {
      const timer = setTimeout(() => makeEngineMove(boardObj), 500);
      return () => clearTimeout(timer);
    }
  }, [gameMode, playerColor, turn, engine.connected, engine.thinking, gameOver, boardObj, makeEngineMove]);

  // Start new game with engine
  useEffect(() => {
    if (gameMode && engine.connected) {
      engine.newGame();
    }
  }, [gameMode, engine.connected, engine.newGame]);

  // Colosseum game loop
  useEffect(() => {
    if (gameMode !== 'colosseum' || !colosseumConfig || gameOver) return;
    if (!engine.connected || !colosseumRunning.current) return;

    // Start the colosseum game
    if (!engine.thinking && !waitingForEngine.current) {
      makeEngineMove(boardObj);
    }
  }, [gameMode, colosseumConfig, engine.connected, engine.thinking, gameOver, boardObj, makeEngineMove]);

  // Handle colosseum game over
  useEffect(() => {
    if (gameMode !== 'colosseum' || !colosseumConfig || !gameOver) return;

    const result = {
      round: currentRound + 1,
      winner,
      moves: boardObj.history?.moves?.length || 0,
      fen: boardToFen(boardObj)
    };

    setColosseumResults(prev => [...prev, result]);

    if (currentRound + 1 < colosseumConfig.maxRounds) {
      setTimeout(() => {
        startNextColosseumRound();
      }, 2000);
    } else {
      colosseumRunning.current = false;
    }
  }, [gameOver, gameMode, colosseumConfig, currentRound, winner, boardObj]);

  const startNextColosseumRound = useCallback(() => {
    const nextRound = currentRound + 1;
    setCurrentRound(nextRound);
    resetGame();
    setGameOver(false);
    setWinner(null);

    // Swap difficulty each round
    const swapped = nextRound % 2 === 1;
    if (swapped) {
      setDifficulty(colosseumConfig.blackBot);
    } else {
      setDifficulty(colosseumConfig.whiteBot);
    }

    if (engine.connected) {
      engine.newGame();
    }
  }, [currentRound, colosseumConfig, resetGame, setGameOver, setWinner, engine]);

  const handleColosseumStart = (config) => {
    setColosseumConfig(config);
    setColosseumResults([]);
    setCurrentRound(0);
    setDifficulty(config.whiteBot);
    setGameMode('colosseum');
    colosseumRunning.current = true;
  };

  const stopColosseum = () => {
    colosseumRunning.current = false;
    engine.stop();
    waitingForEngine.current = false;
  };

  // Main menu
  if (!gameMode) {
    return (
      <MainMenu
        onGameStart={(mode) => setGameMode(mode)}
        playerColor={playerColor}
        setPlayerColor={setPlayerColor}
        difficulty={difficulty}
        setDifficulty={setDifficulty}
        onColosseumStart={handleColosseumStart}
        engineConnected={engine.connected}
        engineError={engine.error}
        onReconnect={engine.reconnect}
      />
    );
  }

  const handleSurrender = () => {
    const gameWinner = turn === "white" ? "black" : "white";
    setWinner(gameWinner);
    setGameOver(true);
  };

  const handleRestart = () => {
    waitingForEngine.current = false;
    setGamesPlayed(prev => prev + 1);
    if (gameMode === 'vs-computer') {
      setPlayerColor(prev => prev === "white" ? "black" : "white");
    }
    resetGame();
    if (engine.connected) {
      engine.newGame();
    }
  };

  const handleBackToMenu = () => {
    stopColosseum();
    waitingForEngine.current = false;
    setGamesPlayed(0);
    setPlayerColor("white");
    setColosseumConfig(null);
    setColosseumResults([]);
    setCurrentRound(0);
    resetToMenu();
  };

  const shouldFlipBoard = () => {
    if (gameMode === 'local') return turn === "black";
    if (gameMode === 'vs-computer') return playerColor === "black";
    if (gameMode === 'colosseum') return currentRound % 2 === 1;
    return false;
  };

  const getModeSubtitle = () => {
    if (gameMode === 'vs-computer') {
      return `Playing vs ${DIFFICULTY_NAMES[difficulty]} Bot as ${playerColor}`;
    }
    if (gameMode === 'colosseum' && colosseumConfig) {
      const whiteName = DIFFICULTY_NAMES[currentRound % 2 === 0 ? colosseumConfig.whiteBot : colosseumConfig.blackBot];
      const blackName = DIFFICULTY_NAMES[currentRound % 2 === 0 ? colosseumConfig.blackBot : colosseumConfig.whiteBot];
      return `${whiteName} (White) vs ${blackName} (Black) - Round ${currentRound + 1}/${colosseumConfig.maxRounds}`;
    }
    return 'Local Two Player';
  };

  const ColosseumSummary = () => {
    if (colosseumResults.length === 0) return null;

    const whiteWins = colosseumResults.filter(r => r.winner === 'white').length;
    const blackWins = colosseumResults.filter(r => r.winner === 'black').length;
    const draws = colosseumResults.filter(r => r.winner === 'draw').length;

    return (
      <div className="mt-4 p-4 bg-gray-700 rounded-lg max-w-md">
        <h3 className="text-lg font-bold text-white mb-2">Match Results</h3>
        <div className="grid grid-cols-3 gap-4 text-center mb-3">
          <div>
            <div className="text-2xl font-bold text-yellow-300">{whiteWins}</div>
            <div className="text-sm text-gray-400">White Wins</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-400">{draws}</div>
            <div className="text-sm text-gray-400">Draws</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-300">{blackWins}</div>
            <div className="text-sm text-gray-400">Black Wins</div>
          </div>
        </div>
        <div className="text-xs text-gray-500 max-h-32 overflow-y-auto">
          {colosseumResults.map((r, i) => (
            <div key={i} className="py-1 border-b border-gray-600">
              Round {r.round}: {r.winner === 'draw' ? 'Draw' : `${r.winner} wins`} ({r.moves} moves)
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Determine if board should show as disabled
  const isBoardDisabled = isInteractionBlocked() && !promotion;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 relative font-sans">
      <div className="absolute top-4 left-4">
        <button
          onClick={handleBackToMenu}
          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all duration-200 shadow-md hover:shadow-lg text-sm font-semibold"
        >
          <i className="fas fa-arrow-left mr-2"></i>
          Main Menu
        </button>
      </div>

      {/* Engine status indicator */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${engine.connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
        <span className={`text-sm ${engine.connected ? 'text-green-400' : 'text-red-400'}`}>
          {engine.connected ? 'Engine Connected' : 'Engine Disconnected'}
        </span>
        {!engine.connected && (
          <button
            onClick={engine.reconnect}
            className="ml-2 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded"
          >
            Reconnect
          </button>
        )}
      </div>

      <div className="mb-8 text-center">
        <h1 className="text-5xl font-bold text-white mb-4 drop-shadow-lg">
          {gameMode === 'colosseum' ? '⚔️ Colosseum ⚔️' : 'Chess Game'}
        </h1>
        <div className="text-xl text-gray-300">{getModeSubtitle()}</div>
        {gameMode === 'vs-computer' && gamesPlayed > 0 && (
          <div className="text-sm text-gray-400 mt-2">
            Game #{gamesPlayed + 1} - Colors swapped
          </div>
        )}
      </div>

      <div className="mb-6 px-6 py-3 bg-gray-700 rounded-lg shadow-lg">
        <p className="text-xl font-semibold text-white">
          Current Turn:{" "}
          <span className={`${turn === "white" ? "text-yellow-300" : "text-gray-400"}`}>
            {turn === "white" ? "White" : "Black"}
          </span>
          {isInCheck(boardObj, boardObj.gameState.active_color) && (
            <span className="ml-2 text-red-500 font-bold animate-pulse">Check!</span>
          )}
        </p>
        {gameMode === 'local' && (
          <p className="mt-2 text-gray-300 text-sm">
            Board view: {shouldFlipBoard() ? "Black's perspective" : "White's perspective"}
          </p>
        )}
        {/* Show thinking indicator */}
        {(gameMode === 'vs-computer' || gameMode === 'colosseum') && (engine.thinking || waitingForEngine.current) && (
          <div className="mt-2 text-gray-300 text-sm animate-pulse">
            <span>🤔 Engine is thinking...</span>
            {engine.searchInfo && (
              <span className="ml-2">
                (Depth: {engine.searchInfo.depth}{engine.searchInfo.score !== undefined ? `, Score: ${engine.searchInfo.score}` : ''})
              </span>
            )}
          </div>
        )}
        {/* Show whose turn it is in vs-computer */}
        {gameMode === 'vs-computer' && !engine.thinking && !waitingForEngine.current && (
          <p className="mt-2 text-gray-300 text-sm">
            {isPlayerTurn() ? "Your turn" : "Engine's turn"}
          </p>
        )}
      </div>

      {/* Add visual indicator when board is disabled */}
      <div className={`relative ${isBoardDisabled ? 'cursor-not-allowed' : ''}`}>
        {isBoardDisabled && gameMode !== 'colosseum' && (
          <div className="absolute inset-0 bg-black bg-opacity-10 z-10 pointer-events-none rounded-lg" />
        )}
        <ChessBoard
          boardObj={boardObj}
          selected={selectedWithMoves}
          lastMove={lastMove}
          onSquareClick={handleSquareClick}
          flipped={shouldFlipBoard()}
        />
      </div>

      <PromotionModal promotion={promotion} onPromotion={handlePromotion} />
      <GameOverModal gameOver={gameOver} winner={winner} onRestart={gameMode === 'colosseum' ? null : handleRestart} />

      {gameMode === 'colosseum' && <ColosseumSummary />}

      <div className="mt-6 flex gap-4">
        {!gameOver && !promotion && gameMode !== 'colosseum' && (
          <>
            <button
              onClick={handleUndo}
              disabled={!boardObj.canUndo() || engine.thinking || waitingForEngine.current || !isPlayerTurn()}
              className={`px-6 py-3 ${boardObj.canUndo() && !engine.thinking && !waitingForEngine.current && isPlayerTurn() 
                ? 'bg-blue-600 hover:bg-blue-700' 
                : 'bg-gray-600 cursor-not-allowed'} 
                text-white rounded-lg transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold`}
            >
              Undo Move
            </button>

            <button
              onClick={handleSurrender}
              disabled={engine.thinking || waitingForEngine.current}
              className={`px-6 py-3 ${engine.thinking || waitingForEngine.current 
                ? 'bg-gray-600 cursor-not-allowed' 
                : 'bg-red-600 hover:bg-red-700'} text-white rounded-lg 
                transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold`}
            >
              Surrender
            </button>
          </>
        )}

        {gameMode === 'colosseum' && colosseumRunning.current && !gameOver && (
          <button
            onClick={stopColosseum}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold"
          >
            Stop Match
          </button>
        )}
      </div>
    </div>
  );
};

// Helper function
function squareToIndex(square) {
  if (typeof square === 'string' && square.length === 2) {
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = parseInt(square[1]) - 1;
    return rank * 8 + file;
  }
  return -1;
}

export default ChessApp;