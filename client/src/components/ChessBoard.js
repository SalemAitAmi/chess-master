import { pieceIcons, PIECES } from "../constants/gameConstants";
import { getPieceColor } from "../utils/bitboard";

const ChessBoard = ({ boardObj, selected, lastMove, onSquareClick, flipped = false }) => {
  // Create visual representation from pieceList
  const renderSquares = () => {
    const squares = [];
    
    // When rendering the board, we iterate through display positions
    for (let displayRow = 0; displayRow < 8; displayRow++) {
      for (let displayCol = 0; displayCol < 8; displayCol++) {
        // Calculate the actual board position based on flip
        // Only flip the row (rank), not the column (file)
        const actualRow = flipped ? 7 - displayRow : displayRow;
        const actualCol = displayCol; // Don't flip columns to keep pieces on correct files
        
        // Convert row/col to bitboard index
        // Remember: row 0 = rank 8, row 7 = rank 1
        const rank = 7 - actualRow;
        const file = actualCol;
        const squareIndex = rank * 8 + file;
        
        const piece = boardObj.pieceList[squareIndex];
        const pieceColor = piece !== PIECES.NONE ? getPieceColor(boardObj.bbSide, squareIndex) : null;
        
        const isSelected =
          selected && selected.row === actualRow && selected.col === actualCol;
        const isValidMove =
          selected &&
          selected.moves.some(([mr, mc]) => mr === actualRow && mc === actualCol);
        const isLastMove =
          lastMove &&
          ((lastMove.from[0] === actualRow && lastMove.from[1] === actualCol) ||
            (lastMove.to[0] === actualRow && lastMove.to[1] === actualCol));

        // Determine square color based on display position
        let squareClass = (displayRow + displayCol) % 2 === 0 ? "bg-amber-100" : "bg-amber-700";
        
        if (isSelected) {
          squareClass = "bg-blue-400 shadow-inner";
        } else if (isValidMove) {
          squareClass = "bg-green-400 shadow-inner";
        } else if (isLastMove) {
          squareClass = "bg-yellow-300 shadow-inner";
        }

        squares.push(
          <div
            key={`${displayRow}-${displayCol}`}
            style={{
              gridRow: displayRow + 1,
              gridColumn: displayCol + 1
            }}
            className={`flex items-center justify-center w-[64px] h-[64px] cursor-pointer border border-gray-600
              transition-all duration-200 ease-in-out
              ${squareClass}
              hover:${isValidMove ? "bg-green-500" : "brightness-110"}`}
            onClick={() => onSquareClick(actualRow, actualCol)}
          >
            {piece !== PIECES.NONE && pieceColor && (
              <i
                className={`fas ${pieceIcons[piece]} 
                  ${pieceColor === "white" ? "text-gray-100" : "text-gray-900"} 
                  text-4xl drop-shadow-md transition-transform duration-200
                  hover:scale-110`}
              />
            )}
          </div>
        );
      }
    }
    
    return squares;
  };

  // Add file and rank labels
  const renderFileLabels = () => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const displayFiles = files;
    
    return (
      <div className="flex">
        <div className="w-9"></div> {/* Spacer for rank labels */}
        {displayFiles.map((file, index) => (
          <div key={file} className="w-[64px] text-center text-gray-400 text-sm font-semibold">
            {file}
          </div>
        ))}
      </div>
    );
  };

  const renderRankLabels = () => {
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    const displayRanks = flipped ? [...ranks].reverse() : ranks;
    
    return (
      <div className="flex flex-col">
        {displayRanks.map((rank) => (
          <div key={rank} className="h-[64px] flex items-center justify-center text-gray-400 text-sm font-semibold w-8">
            {rank}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col">
      <div className="flex">
        {renderRankLabels()}
        <div className="grid grid-cols-8 gap-0 w-[520px] h-[520px] border-4 border-gray-700 bg-gray-700 rounded-lg shadow-2xl p-1">
          {renderSquares()}
        </div>
      </div>
      {renderFileLabels()}
    </div>
  );
};

export default ChessBoard;