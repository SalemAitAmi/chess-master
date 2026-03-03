import { getPieceAt } from "../utils/chessUtils";
import { getValidMoves, simulateMove, isInCheck, hasValidMoves } from "../utils/chessLogic";
import { PIECES, SQUARE_NAMES } from "../constants/gameConstants";
import { rowColToIndex, indexToRowCol, indexToSquare } from "../utils/bitboard";

export const createGameHandlers = (gameState, engineCallbacks = {}) => {
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
    addMove,
  } = gameState;

  const { onMoveComplete } = engineCallbacks;

  const handlePromotion = (pieceType) => {
    if (!promotion) return;

    const { fromRow, fromCol, toRow, toCol, board: promotionBoard } = promotion;
    const fromIndex = rowColToIndex(fromRow, fromCol);
    const toIndex = rowColToIndex(toRow, toCol);

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
    setLastMove({ from: [fromRow, fromCol], to: [toRow, toCol] });

    // Record move
    const moveStr = indexToSquare(fromIndex) + indexToSquare(toIndex) + pieceType;
    addMove(moveStr);

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
    } else if (onMoveComplete) {
      onMoveComplete(newBoard, moveStr);
    }
  };

  const makeMove = (fromRow, fromCol, toRow, toCol, promotionPiece = null) => {
    const piece = getPieceAt(boardObj, fromRow, fromCol);
    if (!piece) return false;

    const currentColor = boardObj.gameState.active_color;
    const fromIndex = rowColToIndex(fromRow, fromCol);
    const toIndex = rowColToIndex(toRow, toCol);

    console.log(`Making move: ${SQUARE_NAMES[7-fromRow][fromCol]} to ${SQUARE_NAMES[7-toRow][toCol]}`);

    const result = simulateMove(fromRow, fromCol, toRow, toCol, boardObj);

    if (result.needsPromotion && !promotionPiece) {
      setPromotion({
        board: result.board,
        fromRow,
        fromCol,
        toRow,
        toCol,
        color: piece.color === "white" ? "w" : "b"
      });
      return true;
    }

    const newBoard = boardObj.clone();
    const pieceValue = promotionPiece ? 
      { 'q': PIECES.QUEEN, 'r': PIECES.ROOK, 'b': PIECES.BISHOP, 'n': PIECES.KNIGHT }[promotionPiece] :
      null;
    
    newBoard.makeMove(fromIndex, toIndex, pieceValue);

    setBoard(newBoard);
    setLastMove({ from: [fromRow, fromCol], to: [toRow, toCol] });
    setSelected(null);

    // Record move
    let moveStr = indexToSquare(fromIndex) + indexToSquare(toIndex);
    if (promotionPiece) moveStr += promotionPiece;
    addMove(moveStr);

    // Check for game end
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
    } else if (onMoveComplete) {
      onMoveComplete(newBoard, moveStr);
    }

    return true;
  };

  const applyEngineMove = (moveStr) => {
    if (!moveStr || moveStr === '(none)') return false;

    const from = moveStr.slice(0, 2);
    const to = moveStr.slice(2, 4);
    const promotion = moveStr.length > 4 ? moveStr[4] : null;

    const fromIndex = squareToIndex(from);
    const toIndex = squareToIndex(to);
    const [fromRow, fromCol] = indexToRowCol(fromIndex);
    const [toRow, toCol] = indexToRowCol(toIndex);

    return makeMove(fromRow, fromCol, toRow, toCol, promotion);
  };

  const handleSquareClick = (row, col) => {
    if (gameOver || promotion) return;

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
      setBoard(boardObj.clone());
      setSelected(null);

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
    makeMove,
    applyEngineMove,
  };
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