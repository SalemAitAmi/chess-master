import { getPieceAt } from "../utils/chessUtils";
import { getValidMoves, simulateMove, isInCheck, hasValidMoves } from "../utils/chessLogic";
import { PIECES, SQUARE_NAMES } from "../constants/gameConstants";
import { rowColToIndex, indexToRowCol } from "../utils/bitboard";
import { HumanPlayer } from '../players/Player';
import { BotPlayer, DIFFICULTY } from '../players/BotPlayer';

// Store players outside the handler to persist across re-renders
let gamePlayersRef = {
  white: null,
  black: null,
  initialized: false,
  currentBoardId: null  // Track which board instance we're using
};

// Flag to prevent multiple simultaneous bot moves
let isBotMoving = false;

// Generate a unique ID for each board instance
function getBoardId(board) {
  return board.gameState.zobrist_key?.toString() || 'initial';
}

export const createGameHandlers = (gameState) => {
  const {
    boardObj,
    setBoard,
    selected,
    setSelected,
    gameOver,
    setGameOver,
    setWinner,
    setLastMove,
    promotion,
    setPromotion,
    gameMode,
    setIsThinking,
    playerColor,
    difficulty,
  } = gameState;

  const initializePlayers = () => {
    // console.log('Initializing players for mode:', gameMode, 'playerColor:', playerColor, 'difficulty:', difficulty);
    
    // Always create new player instances with the current board
    if (gameMode === 'local') {
      gamePlayersRef.white = new HumanPlayer("white", boardObj);
      gamePlayersRef.black = new HumanPlayer("black", boardObj);
    } else if (gameMode === 'vs-computer') {
      const botDifficulty = difficulty || DIFFICULTY.CASUAL;
      if (playerColor === "white") {
        gamePlayersRef.white = new HumanPlayer("white", boardObj);
        gamePlayersRef.black = new BotPlayer("black", boardObj, botDifficulty);
      } else {
        gamePlayersRef.white = new BotPlayer("white", boardObj, botDifficulty);
        gamePlayersRef.black = new HumanPlayer("black", boardObj);
      }
    }
    gamePlayersRef.initialized = true;
    gamePlayersRef.currentBoardId = getBoardId(boardObj);
    isBotMoving = false;
  };

  const resetPlayers = () => {
    gamePlayersRef.white = null;
    gamePlayersRef.black = null;
    gamePlayersRef.initialized = false;
    gamePlayersRef.currentBoardId = null;
    isBotMoving = false;
  };

  const handlePromotion = (pieceType) => {
    if (!promotion) return;

    const { fromRow, fromCol, toRow, toCol, board: promotionBoard } = promotion;
    const fromIndex = rowColToIndex(fromRow, fromCol);
    const toIndex = rowColToIndex(toRow, toCol);
    
    // Map piece type character to PIECES constant
    const pieceMap = {
      'q': PIECES.QUEEN,
      'r': PIECES.ROOK,
      'b': PIECES.BISHOP,
      'n': PIECES.KNIGHT
    };
    
    const newBoard = promotionBoard.clone();
    newBoard.makeMove(fromIndex, toIndex, pieceMap[pieceType]);

    setBoard(newBoard);
    setSelected(null);
    setPromotion(null);

    const nextTurnColor = newBoard.gameState.active_color;
    
    const opponentInCheck = isInCheck(newBoard, nextTurnColor);
    const opponentHasMoves = hasValidMoves(nextTurnColor, newBoard);

    if (!opponentHasMoves) {
      setGameOver(true);
      if (opponentInCheck) {
        setWinner(nextTurnColor === "white" ? "black" : "white");
      } else {
        setWinner("draw");
      }
    } else if (gameMode === "vs-computer") {
      // Check if it's the bot's turn after promotion
      const isPlayerTurn = nextTurnColor === playerColor;
      if (!isPlayerTurn) {
        // Schedule bot move
        setTimeout(() => triggerBotMove(newBoard), 500);
      }
    }
  };

  const triggerBotMove = async (currentBoard) => {
    // Prevent multiple simultaneous bot moves
    if (isBotMoving) {
      console.log('Bot is already moving, skipping...');
      return;
    }
    
    const currentColor = currentBoard.gameState.active_color;
    const computerPlayer = currentColor === "white" ? gamePlayersRef.white : gamePlayersRef.black;

    if (!computerPlayer || !(computerPlayer instanceof BotPlayer)) {
      console.log('No bot player for color:', currentColor);
      return;
    }
    
    // Double-check it's actually the bot's turn
    if (currentColor === playerColor) {
      console.log('It is the player\'s turn, not the bot\'s');
      return;
    }
    
    isBotMoving = true;
    setIsThinking(true);
    
    try {
      computerPlayer.updateBoard(currentBoard);
      const move = await computerPlayer.makeMove();
      
      if (move) {
        executeBotMove(move.from[0], move.from[1], move.to[0], move.to[1], currentBoard);
      }
    } catch (err) {
      console.error('Bot move error:', err);
    } finally {
      isBotMoving = false;
      setIsThinking(false);
    }
  };

  const executeBotMove = (fromRow, fromCol, toRow, toCol, currentBoard) => {
    const piece = getPieceAt(currentBoard, fromRow, fromCol);
    if (!piece) return;

    const currentColor = currentBoard.gameState.active_color;

    console.log(`Bot making move: ${SQUARE_NAMES[7-fromRow][fromCol]} to ${SQUARE_NAMES[7-toRow][toCol]}`);

    const result = simulateMove(fromRow, fromCol, toRow, toCol, currentBoard);

    if (result.needsPromotion) {
      // Bot always promotes to queen
      const fromIndex = rowColToIndex(fromRow, fromCol);
      const toIndex = rowColToIndex(toRow, toCol);
      
      const newBoard = currentBoard.clone();
      newBoard.makeMove(fromIndex, toIndex, PIECES.QUEEN);
      
      setBoard(newBoard);
      setLastMove({ from: [fromRow, fromCol], to: [toRow, toCol] });
      setSelected(null);

      // Check for checkmate or stalemate
      const nextTurnColor = newBoard.gameState.active_color;
      const opponentInCheck = isInCheck(newBoard, nextTurnColor);
      const opponentHasMoves = hasValidMoves(nextTurnColor, newBoard);

      if (!opponentHasMoves) {
        setGameOver(true);
        if (opponentInCheck) {
          setWinner(currentColor);
        } else {
          setWinner("draw");
        }
      }
    } else {
      const fromIndex = rowColToIndex(fromRow, fromCol);
      const toIndex = rowColToIndex(toRow, toCol);
      
      const newBoard = currentBoard.clone();
      newBoard.makeMove(fromIndex, toIndex);
      
      setBoard(newBoard);
      setLastMove({ from: [fromRow, fromCol], to: [toRow, toCol] });
      setSelected(null);

      // Check for checkmate or stalemate
      const nextTurnColor = newBoard.gameState.active_color;
      const opponentInCheck = isInCheck(newBoard, nextTurnColor);
      const opponentHasMoves = hasValidMoves(nextTurnColor, newBoard);

      if (!opponentHasMoves) {
        setGameOver(true);
        if (opponentInCheck) {
          setWinner(currentColor);
        } else {
          setWinner("draw");
        }
      }
    }
  };

  const makeMove = (fromRow, fromCol, toRow, toCol) => {
    const piece = getPieceAt(boardObj, fromRow, fromCol);
    if (!piece) return;

    const currentColor = boardObj.gameState.active_color;

    console.log(`Making move: ${SQUARE_NAMES[7-fromRow][fromCol]} to ${SQUARE_NAMES[7-toRow][toCol]}`);

    const result = simulateMove(fromRow, fromCol, toRow, toCol, boardObj);

    if (result.needsPromotion) {
      setPromotion({
        board: result.board,
        fromRow,
        fromCol,
        toRow,
        toCol,
        color: piece.color === "white" ? "w" : "b" // For the modal
      });
    } else {
      const fromIndex = rowColToIndex(fromRow, fromCol);
      const toIndex = rowColToIndex(toRow, toCol);
      
      const newBoard = boardObj.clone();
      newBoard.makeMove(fromIndex, toIndex);
      
      setBoard(newBoard);
      setLastMove({ from: [fromRow, fromCol], to: [toRow, toCol] });
      setSelected(null);

      // Check for checkmate or stalemate
      const nextTurnColor = newBoard.gameState.active_color;
      const opponentInCheck = isInCheck(newBoard, nextTurnColor);
      const opponentHasMoves = hasValidMoves(nextTurnColor, newBoard);

      if (!opponentHasMoves) {
        setGameOver(true);
        if (opponentInCheck) {
          setWinner(currentColor);
        } else {
          setWinner("draw");
        }
      } else if (gameMode === "vs-computer") {
        // Check if it's the bot's turn after the player moved
        const isPlayerTurn = nextTurnColor === playerColor;
        if (!isPlayerTurn) {
          // Schedule bot move with the new board state
          setTimeout(() => triggerBotMove(newBoard), 500);
        }
      }
    }
  };

  const makeComputerMove = async () => {
    // This is called from App.js for initial bot move when bot plays first
    if (gameOver) return;
    
    const currentColor = boardObj.gameState.active_color;
    
    // Make sure it's actually the bot's turn
    if (currentColor === playerColor) {
      console.log('makeComputerMove called but it is the player\'s turn');
      return;
    }
    
    await triggerBotMove(boardObj);
  };

  const handleSquareClick = (row, col) => {
    if (gameOver || promotion) return;
    
    // Don't allow interaction while bot is thinking
    if (isBotMoving) return;
    
    const piece = getPieceAt(boardObj, row, col);
    const currentColor = boardObj.gameState.active_color;

    // In vs-computer mode, check if it's the human player's turn
    if (gameMode === "vs-computer" && currentColor !== playerColor) return;

    if (selected) {
      const [selectedRow, selectedCol] = selected;
      const selectedPiece = getPieceAt(boardObj, selectedRow, selectedCol);
      
      if (selectedPiece && selectedPiece.color === currentColor) {
        const moves = getValidMoves(selectedRow, selectedCol, boardObj, true);
        
        const validMove = moves.find(([r, c]) => r === row && c === col);
        
        if (validMove) {
          const result = simulateMove(selectedRow, selectedCol, row, col, boardObj);
          
          if (!isInCheck(result.board, currentColor)) {
            makeMove(selectedRow, selectedCol, row, col);
            return;
          }
        }
      }
      
      if (piece && piece.color === currentColor) {
        setSelected([row, col]);
      } else {
        setSelected(null);
      }
    } else {
      if (piece && piece.color === currentColor) {
        setSelected([row, col]);
      }
    }
  };

  const handleUndo = () => {
    if (boardObj.canUndo()) {
      boardObj.undoMove();
      setBoard(boardObj.clone()); // Force re-render
      setSelected(null);
      
      // Update last move display
      const lastMove = boardObj.getLastMove();
      if (lastMove) {
        const fromRowCol = indexToRowCol(lastMove.from);
        const toRowCol = indexToRowCol(lastMove.to);
        setLastMove({ from: fromRowCol, to: toRowCol });
      } else {
        setLastMove(null);
      }
    }
  };

  return {
    handleSquareClick,
    handlePromotion,
    handleUndo,
    initializePlayers,
    resetPlayers,
    makeComputerMove,
  };
};
