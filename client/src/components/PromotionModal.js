import { pieceIcons, PIECES } from "../constants/gameConstants";

const PromotionModal = ({ promotion, onPromotion }) => {
  if (!promotion) return null;

  const promotionOptions = [
    { type: PIECES.QUEEN, notation: 'q' },
    { type: PIECES.ROOK, notation: 'r' },
    { type: PIECES.BISHOP, notation: 'b' },
    { type: PIECES.KNIGHT, notation: 'n' }
  ];

  return (
    <div
      className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 
      bg-gray-900 bg-opacity-95 rounded-xl p-6 shadow-2xl border-2 border-gray-700
      backdrop-blur-sm animate-fade-in flex flex-col items-center gap-4"
    >
      <div className="text-gray-100 text-lg font-semibold mb-2">
        Promote Pawn
      </div>
      <div className="flex gap-4">
        {promotionOptions.map(({ type, notation }) => (
          <button
            key={type}
            onClick={() => onPromotion(notation)}
            className="w-14 h-14 flex items-center justify-center bg-gray-800 
              rounded-lg hover:bg-gray-700 transition-all duration-200
              shadow-md hover:shadow-lg border border-gray-600"
          >
            <i
              className={`fas ${pieceIcons[type]} 
                ${promotion.color === "w" ? "text-gray-100" : "text-gray-900"} 
                text-3xl drop-shadow-md`}
            />
          </button>
        ))}
      </div>
    </div>
  );
};

export default PromotionModal;