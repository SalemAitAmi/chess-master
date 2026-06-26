const GameOverModal = ({ gameOver, winner, status, onRestart }) => {
  if (!gameOver) return null;

  const headline = winner
    ? `${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`
    : status === 'stalemate' ? 'Stalemate — Draw!'
    : status === 'threefold' ? 'Threefold Repetition — Draw!'
    : status === 'fifty_move' || status === 'fifty-move' ? '50-Move Rule — Draw!'
    : status === 'insufficient_material' ? 'Insufficient Material — Draw!'
    : 'Game Over — Draw!';

  return (
    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2
      bg-gray-900 bg-opacity-95 rounded-xl p-8 shadow-2xl text-center border-2 border-gray-700
      backdrop-blur-sm animate-fade-in z-50">
      <h2 className="text-3xl font-bold mb-6 text-gray-100 drop-shadow-md">{headline}</h2>
      <button onClick={onRestart}
        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700
          transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold">
        Start New Game
      </button>
    </div>
  );
};

export default GameOverModal;