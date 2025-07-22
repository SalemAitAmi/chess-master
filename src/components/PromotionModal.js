import React from "react";
import { pieceIcons } from "../constants/gameConstants";

const PromotionModal = ({ promotion, onPromotion }) => {
  if (!promotion) return null;

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
        {["q", "r", "b", "n"].map((pieceType) => (
          <button
            key={pieceType}
            onClick={() => onPromotion(pieceType)}
            className="w-14 h-14 flex items-center justify-center bg-gray-800 
              rounded-lg hover:bg-gray-700 transition-all duration-200
              shadow-md hover:shadow-lg border border-gray-600"
          >
            <i
              className={`fas ${pieceIcons[pieceType]} 
                ${
                  promotion.color === "w"
                    ? "text-gray-100"
                    : "text-gray-900"
                } 
                text-3xl drop-shadow-md`}
            />
          </button>
        ))}
      </div>
    </div>
  );
};

export default PromotionModal;