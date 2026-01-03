import { useEffect, useState, useRef, useCallback } from "react";
import { useGameState } from "./hooks/useGameState";
import { createGameHandlers } from "./handlers/gameHandlers";
import { isInCheck, getValidMoves, simulateMove, hasValidMoves } from "./utils/chessLogic";
import { getPieceAt, boardToFen } from "./utils/chessUtils";
import { SQUARE_NAMES, PIECES } from "./constants/gameConstants";
import { DIFFICULTY, downloadReport, downloadAllReports, getLatestReport, getReportHistory, clearReportHistory, BotPlayer } from "./players/BotPlayer";
import { rowColToIndex } from "./utils/bitboard";
import ChessBoard from "./components/ChessBoard";
import PromotionModal from "./components/PromotionModal";
import GameOverModal from "./components/GameOverModal";
import MainMenu from "./components/MainMenu";

const DIFFICULTY_NAMES = {
  [DIFFICULTY.ROOKIE]: 'Rookie',
  [DIFFICULTY.CASUAL]: 'Casual',
  [DIFFICULTY.STRATEGIC]: 'Strategic',
  [DIFFICULTY.MASTER]: 'Master'
};

const ChessApp = () => {
  const gameState = useGameState();
  const [isThinking, setIsThinking] = useState(false);
  const [playerColor, setPlayerColor] = useState("white");
  const [difficulty, setDifficulty] = useState(DIFFICULTY.CASUAL);
  const [gamesPlayed, setGamesPlayed] = useState(0);
  const [playersInitialized, setPlayersInitialized] = useState(false);
  
  // Colosseum state
  const [colosseumConfig, setColosseumConfig] = useState(null);
  const [colosseumResults, setColosseumResults] = useState([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [colosseumBots, setColosseumBots] = useState({ white: null, black: null });
  const colosseumRunning = useRef(false);
  const colosseumMoveTimeout = useRef(null);
  
  const {
    boardObj,
    setBoard,
    selected,
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
  } = gameState;

  // Add isThinking, playerColor, and difficulty to gameState for handlers
  const enhancedGameState = { ...gameState, setIsThinking, playerColor, difficulty };

  const handlers = createGameHandlers(enhancedGameState);
  const { handleSquareClick, handlePromotion, handleUndo, initializePlayers, resetPlayers, makeComputerMove } = handlers;

  // Calculate valid moves when a piece is selected
  const [selectedWithMoves, setSelectedWithMoves] = useState(null);
  
  // Use a ref to track the previous selected value
  const prevSelectedRef = useRef();
  
  // Track if initial bot move has been triggered
  const initialBotMoveDone = useRef(false);
  
  useEffect(() => {
    // Only recalculate if selected actually changed
    if (prevSelectedRef.current === selected) {
      return;
    }
    prevSelectedRef.current = selected;
    
    if (selected) {
      const [row, col] = selected;
      const piece = getPieceAt(boardObj, row, col);
      
      if (piece) {
        console.log(`Calculating moves for selected piece at ${SQUARE_NAMES[7-row][col]}`);
        const moves = getValidMoves(row, col, boardObj);
        
        // Filter out moves that would leave the king in check
        const currentColor = boardObj.gameState.active_color;
        const validMoves = moves.filter(([toRow, toCol]) => {
          const result = simulateMove(row, col, toRow, toCol, boardObj);
          return !isInCheck(result.board, currentColor);
        });
        
        setSelectedWithMoves({
          row,
          col,
          moves: validMoves
        });
      }
    } else {
      setSelectedWithMoves(null);
    }
  }, [selected, boardObj.gameState.active_color, boardObj]);

  // Initialize players when game mode changes
  useEffect(() => {
    if (gameMode && gameMode !== 'colosseum') {
      initializePlayers();
      setPlayersInitialized(true);
      initialBotMoveDone.current = false;
    } else if (!gameMode) {
      resetPlayers();
      setPlayersInitialized(false);
      initialBotMoveDone.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameMode, playerColor, difficulty]);

  // Make computer move when it's bot's turn at game start
  useEffect(() => {
    if (!gameMode || gameMode !== 'vs-computer' || !playersInitialized || gameOver) {
      return;
    }
    
    // Bot plays first (player is black)
    if (playerColor === "black" && turn === "white" && !initialBotMoveDone.current) {
      initialBotMoveDone.current = true;
      // Small delay to ensure everything is initialized
      const timer = setTimeout(() => {
        makeComputerMove();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [gameMode, playerColor, turn, playersInitialized, gameOver, makeComputerMove]);

  // Colosseum bot move execution
  const executeColosseumBotMove = useCallback(async (currentBoard, botPlayer) => {
    botPlayer.updateBoard(currentBoard);
    const move = await botPlayer.makeMove();
    return move;
  }, []);

  // Colosseum game loop
  useEffect(() => {
    if (gameMode !== 'colosseum' || !colosseumConfig || gameOver || !colosseumBots.white || !colosseumBots.black) {
      return;
    }

    if (!colosseumRunning.current) return;

    const currentColor = boardObj.gameState.active_color;
    const currentBot = currentColor === 'white' ? colosseumBots.white : colosseumBots.black;
    
    setIsThinking(true);

    colosseumMoveTimeout.current = setTimeout(async () => {
      try {
        const move = await executeColosseumBotMove(boardObj, currentBot);
        
        if (move && colosseumRunning.current) {
          const fromIndex = rowColToIndex(move.from[0], move.from[1]);
          const toIndex = rowColToIndex(move.to[0], move.to[1]);
          
          const newBoard = boardObj.clone();
          const piece = newBoard.pieceList[fromIndex];
          
          // Check for promotion
          const isPromotion = piece === PIECES.PAWN && 
            ((currentColor === 'white' && move.to[0] === 0) || 
             (currentColor === 'black' && move.to[0] === 7));
          
          if (isPromotion) {
            newBoard.makeMove(fromIndex, toIndex, PIECES.QUEEN);
          } else {
            newBoard.makeMove(fromIndex, toIndex);
          }
          
          setBoard(newBoard);
          setLastMove({ from: move.from, to: move.to });
          
          // Check for game over
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
          }
        }
      } catch (err) {
        console.error('Colosseum bot move error:', err);
      } finally {
        setIsThinking(false);
      }
    }, 100);

    return () => {
      if (colosseumMoveTimeout.current) {
        clearTimeout(colosseumMoveTimeout.current);
      }
    };
  }, [gameMode, colosseumConfig, boardObj, colosseumBots, gameOver, executeColosseumBotMove, setBoard, setLastMove, setGameOver, setWinner]);

  // Handle colosseum game over
  useEffect(() => {
    if (gameMode !== 'colosseum' || !colosseumConfig || !gameOver) return;

    // Record result
    const result = {
      round: currentRound + 1,
      winner: winner,
      whiteBotDifficulty: currentRound % 2 === 0 ? colosseumConfig.whiteBot : colosseumConfig.blackBot,
      blackBotDifficulty: currentRound % 2 === 0 ? colosseumConfig.blackBot : colosseumConfig.whiteBot,
      moves: boardObj.history.moves.length,
      fen: boardToFen(boardObj)
    };
    
    setColosseumResults(prev => [...prev, result]);
    
    // Check if more rounds to play
    if (currentRound + 1 < colosseumConfig.maxRounds) {
      // Schedule next round with color swap
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
    
    // Swap colors every round
    const swapped = nextRound % 2 === 1;
    const whiteDifficulty = swapped ? colosseumConfig.blackBot : colosseumConfig.whiteBot;
    const blackDifficulty = swapped ? colosseumConfig.whiteBot : colosseumConfig.blackBot;
    
    // Create new bots for the new board
    setTimeout(() => {
      const newBoard = gameState.boardObj;
      setColosseumBots({
        white: new BotPlayer('white', newBoard, whiteDifficulty),
        black: new BotPlayer('black', newBoard, blackDifficulty)
      });
    }, 100);
  }, [currentRound, colosseumConfig, resetGame, setGameOver, setWinner, gameState.boardObj]);

  const handleColosseumStart = (config) => {
    clearReportHistory();
    setColosseumConfig(config);
    setColosseumResults([]);
    setCurrentRound(0);
    setGameMode('colosseum');
    colosseumRunning.current = true;
    
    // Initialize bots after a short delay to ensure board is ready
    setTimeout(() => {
      const newBoard = gameState.boardObj;
      setColosseumBots({
        white: new BotPlayer('white', newBoard, config.whiteBot),
        black: new BotPlayer('black', newBoard, config.blackBot)
      });
    }, 100);
  };

  const stopColosseum = () => {
    colosseumRunning.current = false;
    if (colosseumMoveTimeout.current) {
      clearTimeout(colosseumMoveTimeout.current);
    }
  };

  // Show main menu if no game mode is selected
  if (!gameMode) {
    return (
      <MainMenu 
        onGameStart={(mode) => {
          setGameMode(mode);
        }}
        playerColor={playerColor}
        setPlayerColor={setPlayerColor}
        difficulty={difficulty}
        setDifficulty={setDifficulty}
        onColosseumStart={handleColosseumStart}
      />
    );
  }

  const handleSurrender = () => {
    // Set winner to the opponent
    const gameWinner = turn === "white" ? "black" : "white";
    gameState.setWinner(gameWinner);
    gameState.setGameOver(true);
  };

  const handleRestart = () => {
    // Swap colors after each game
    setGamesPlayed(prev => prev + 1);
    if (gameMode === 'vs-computer') {
      setPlayerColor(prev => prev === "white" ? "black" : "white");
    }
    initialBotMoveDone.current = false;
    resetGame();
  };

  const handleBackToMenu = () => {
    // Stop colosseum if running
    stopColosseum();
    // Reset everything when going back to menu
    setGamesPlayed(0);
    setPlayerColor("white");
    setPlayersInitialized(false);
    initialBotMoveDone.current = false;
    setColosseumConfig(null);
    setColosseumResults([]);
    setCurrentRound(0);
    setColosseumBots({ white: null, black: null });
    resetPlayers();
    resetToMenu();
  };

  // Determine if the board should be flipped
  const shouldFlipBoard = () => {
    if (gameMode === 'local') {
      // In local play, flip board to show current player's perspective
      return turn === "black";
    } else if (gameMode === 'vs-computer') {
      // In vs computer, always show from human player's perspective
      return playerColor === "black";
    } else if (gameMode === 'colosseum') {
      // In colosseum, alternate view each round
      return currentRound % 2 === 1;
    }
    return false;
  };

  // Colosseum summary component
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

  // Get the mode-specific subtitle
  const getModeSubtitle = () => {
    if (gameMode === 'vs-computer') {
      return `Playing vs ${DIFFICULTY_NAMES[difficulty]} Bot as ${playerColor}`;
    } else if (gameMode === 'colosseum' && colosseumConfig) {
      const swapped = currentRound % 2 === 1;
      const whiteName = DIFFICULTY_NAMES[swapped ? colosseumConfig.blackBot : colosseumConfig.whiteBot];
      const blackName = DIFFICULTY_NAMES[swapped ? colosseumConfig.whiteBot : colosseumConfig.blackBot];
      return `${whiteName} (White) vs ${blackName} (Black) - Round ${currentRound + 1}/${colosseumConfig.maxRounds}`;
    }
    return 'Local Two Player';
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 relative font-sans">
      <div className="absolute top-4 left-4">
        <button
          onClick={handleBackToMenu}
          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 
            transition-all duration-200 shadow-md hover:shadow-lg text-sm font-semibold"
        >
          <i className="fas fa-arrow-left mr-2"></i>
          Main Menu
        </button>
      </div>

      <div className="mb-8 text-center">
        <h1 className="text-5xl font-bold text-white mb-4 drop-shadow-lg">
          {gameMode === 'colosseum' ? '⚔️ Colosseum ⚔️' : 'Chess Game'}
        </h1>
        <div className="text-xl text-gray-300">
          {getModeSubtitle()}
        </div>
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
        {(gameMode === 'vs-computer' || gameMode === 'colosseum') && isThinking && (
          <p className="mt-2 text-gray-300 text-sm animate-pulse">
            {gameMode === 'colosseum' 
              ? `${turn === 'white' ? 'White' : 'Black'} Bot is thinking...`
              : `${DIFFICULTY_NAMES[difficulty]} Bot is thinking...`
            }
          </p>
        )}
      </div>

      <ChessBoard
        boardObj={boardObj}
        selected={selectedWithMoves}
        lastMove={lastMove}
        onSquareClick={gameMode === 'colosseum' ? () => {} : handleSquareClick}
        flipped={shouldFlipBoard()}
      />

      <PromotionModal promotion={promotion} onPromotion={handlePromotion} />

      <GameOverModal
        gameOver={gameOver}
        winner={winner}
        onRestart={gameMode === 'colosseum' ? null : handleRestart}
      />

      {/* Colosseum Summary */}
      {gameMode === 'colosseum' && <ColosseumSummary />}

      <div className="mt-6 flex gap-4">
        {!gameOver && !promotion && gameMode !== 'colosseum' && (
          <>
            <button
              onClick={handleUndo}
              disabled={!boardObj.canUndo() || isThinking}
              className={`px-6 py-3 ${boardObj.canUndo() && !isThinking ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-600 cursor-not-allowed'} 
                text-white rounded-lg transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold`}
            >
              Undo Move
            </button>
            
            <button
              onClick={handleSurrender}
              disabled={isThinking}
              className={`px-6 py-3 ${isThinking ? 'bg-gray-600 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'} text-white rounded-lg 
                transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold`}
            >
              Surrender
            </button>
          </>
        )}
        
        {gameMode === 'colosseum' && colosseumRunning.current && !gameOver && (
          <button
            onClick={stopColosseum}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg 
              transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold"
          >
            Stop Match
          </button>
        )}
      </div>
      
      {/* Bot Analysis Download Buttons */}
      {(gameMode === 'vs-computer' || gameMode === 'colosseum') && (
        <div className="mt-4 flex flex-wrap gap-2 justify-center">
          <button
            onClick={() => downloadReport('txt')}
            disabled={!getLatestReport()}
            className={`px-4 py-2 text-sm ${getLatestReport() ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-600 cursor-not-allowed'} 
              text-white rounded-lg transition-all duration-200 shadow-md`}
          >
            Download Last Decision (TXT)
          </button>
          <button
            onClick={() => downloadReport('json')}
            disabled={!getLatestReport()}
            className={`px-4 py-2 text-sm ${getLatestReport() ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-600 cursor-not-allowed'} 
              text-white rounded-lg transition-all duration-200 shadow-md`}
          >
            Download Last Decision (JSON)
          </button>
          <button
            onClick={() => downloadAllReports('json')}
            disabled={!getLatestReport()}
            className={`px-4 py-2 text-sm ${getLatestReport() ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-600 cursor-not-allowed'} 
              text-white rounded-lg transition-all duration-200 shadow-md`}
          >
            Download All Decisions (JSON)
          </button>
          <button
            onClick={() => downloadAllReports('txt')}
            disabled={!getLatestReport()}
            className={`px-4 py-2 text-sm ${getLatestReport() ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-600 cursor-not-allowed'} 
              text-white rounded-lg transition-all duration-200 shadow-md`}
          >
            Download All Decisions (TXT)
          </button>
        </div>
      )}
    </div>
  );
};

export default ChessApp;
