const DRAW_HEADLINES = {
  stalemate: 'Stalemate — Draw!',
  threefold: 'Threefold Repetition — Draw!',
  fifty_move: '50-Move Rule — Draw!',
  'fifty-move': '50-Move Rule — Draw!',
  insufficient_material: 'Insufficient Material — Draw!',
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** `winnerName` names the SIDE (Player 1, Computer, Engine A); colour is secondary. */
const GameOverModal = ({ gameOver, winner, winnerName = null, status, onRestart }) => {
  if (!gameOver) return null;
  const hasWinner = winner && winner !== 'none' && winner !== 'draw';
  const resigned = status === 'resignation' ? ' (resignation)' : '';
  const headline = hasWinner
    ? `${winnerName ?? cap(winner)} wins!${resigned}`
    : DRAW_HEADLINES[status] ?? 'Game Over — Draw!';
  return (
    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2
      bg-gray-900 bg-opacity-95 rounded-xl p-8 shadow-2xl text-center border-2 border-gray-700
      backdrop-blur-sm animate-pop-centered z-50">
      <h2 className="text-3xl font-bold mb-2 text-gray-100 drop-shadow-md">{headline}</h2>
      {hasWinner && winnerName && <div className="text-gray-400 mb-6">as {cap(winner)}</div>}
      {!(hasWinner && winnerName) && <div className="mb-4" />}
      <button onClick={onRestart}
        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700
          transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold">
        Start New Game
      </button>
    </div>
  );
};
export default GameOverModal;