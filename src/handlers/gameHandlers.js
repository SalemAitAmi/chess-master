import { getPieceAt } from "../utils/chessUtils";
import { getValidMoves, simulateMove, isInCheck, hasValidMoves } from "../utils/chessLogic";
import { PIECES, SQUARE_NAMES } from "../constants/gameConstants";
import { rowColToIndex, indexToRowCol } from "../utils/bitboard";
import { HumanPlayer, ComputerPlayer } from '../players/Player';

export const createGameHandlers = (gameState) => {
  const {
    boardObj,
    setBoard,
    selected,
    setSelected,
    turn,
    setTurn,
    gameOver,
    setGameOver,
    setWinner,
    setLastMove,
    promotion,
    setPromotion,
    gameMode,
    setIsThinking,
    resetGame,
    resetToMenu,
    playerColor,
  } = gameState;

  // Initialize players based on game mode
  let whitePlayer = null;
  let blackPlayer = null;

  const initializePlayers = () => {
    if (gameMode === 'local') {
      whitePlayer = new HumanPlayer("white", boardObj);
      blackPlayer = new HumanPlayer("black", boardObj);
    } else if (gameMode === 'vs-computer') {
      if (playerColor === "white") {
        whitePlayer = new HumanPlayer("white", boardObj);
        blackPlayer = new ComputerPlayer("black", boardObj);
      } else {
        whitePlayer = new ComputerPlayer("white", boardObj);
        blackPlayer = new HumanPlayer("black", boardObj);
      }
    }
  };

  // Call this when game mode is set
  if (gameMode) {
    initializePlayers();
  }

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
    } else if (gameMode === "vs-computer" && 
               ((nextTurnColor === "black" && playerColor === "white") ||
                (nextTurnColor === "white" && playerColor === "black"))) {
      setTimeout(makeComputerMove, 500);
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
      } else if (gameMode === "vs-computer" && 
                 ((nextTurnColor === "black" && playerColor === "white") ||
                  (nextTurnColor === "white" && playerColor === "black"))) {
        setTimeout(makeComputerMove, 500);
      }
    }
  };

  const makeComputerMove = async () => {
    const computerPlayer = boardObj.gameState.active_color === "white" ? whitePlayer : blackPlayer;

    if (!computerPlayer || !(computerPlayer instanceof ComputerPlayer)) return;
    
    setIsThinking(true);
    computerPlayer.updateBoard(boardObj);
    
    const move = await computerPlayer.makeMove();
    
    if (move) {
      makeMove(move.from[0], move.from[1], move.to[0], move.to[1]);
    }
    
    setIsThinking(false);
  };

  const handleSquareClick = (row, col) => {
    if (gameOver || promotion) return;
    
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
  };
};