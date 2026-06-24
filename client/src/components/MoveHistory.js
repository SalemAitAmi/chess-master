import React, { useEffect, useRef } from 'react';

const MoveHistory = ({ history, currentMove }) => {
  const scrollRef = useRef(null);

  // Auto-scroll to bottom when moves are added
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history.length]);

  // Group moves into pairs (white, black)
  const movePairs = [];
  for (let i = 0; i < history.length; i += 2) {
    movePairs.push({
      number: Math.floor(i / 2) + 1,
      white: history[i],
      black: history[i + 1] || null
    });
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 shadow-lg w-64">
      <h3 className="text-lg font-bold text-white mb-4 border-b border-gray-600 pb-2">
        Move History
      </h3>

      <div 
        ref={scrollRef}
        className="max-h-80 overflow-y-auto space-y-1 font-mono text-sm"
      >
        {movePairs.length === 0 ? (
          <div className="text-gray-500 text-center py-4">
            No moves yet
          </div>
        ) : (
          movePairs.map((pair, idx) => (
            <div 
              key={pair.number}
              className={`flex items-center py-1 px-2 rounded ${
                idx === movePairs.length - 1 ? 'bg-gray-700' : ''
              }`}
            >
              <span className="text-gray-500 w-8">{pair.number}.</span>
              <span className="text-white w-16">{pair.white}</span>
              <span className="text-gray-300 w-16">{pair.black || ''}</span>
            </div>
          ))
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-4 pt-2 border-t border-gray-600">
          <div className="text-gray-400 text-xs">
            Total moves: {history.length}
          </div>
        </div>
      )}
    </div>
  );
};

export default MoveHistory;