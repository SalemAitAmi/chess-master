# Threefold Repetition Implementation Documentation

## Overview
This document describes the implementation of the threefold repetition rule in the chess application. The threefold repetition rule is one of the standard draw conditions in chess, triggered when the same board position occurs three times during a game.

## Implementation Details

### 1. Zobrist Hashing

#### What is Zobrist Hashing?
Zobrist hashing is a technique used in chess programming to efficiently compute a unique hash value for each board position. It uses XOR operations with pre-computed random values to create position identifiers.

#### Why Use Zobrist Hashing?
- **Efficiency**: O(1) position comparison instead of comparing entire board states
- **Uniqueness**: Very low probability of hash collisions with 64-bit values
- **Incremental Updates**: Can be updated incrementally with each move (though we chose full recalculation for reliability)
- **Standard Practice**: Widely used in chess engines for transposition tables and repetition detection

### 2. Components Modified

#### A. GameState Class (`/src/utils/boardStructure.js`)
- **Added Field**: `zobrist_key` (BigInt) - stores the Zobrist hash of the current position
- **Initialization**: Set to 0n initially, then calculated when board is created
- **Cloning**: The zobrist_key is preserved when cloning game states

#### B. Board Class (`/src/utils/boardStructure.js`)
- **New Method**: `zobrist(gameState)` - calculates the Zobrist hash for a position
- **Constructor Update**: Calculates initial Zobrist key after board initialization
- **makeMove Update**: Recalculates Zobrist key after each move

#### C. Player Class (`/src/players/Player.js`)
- **Updated Method**: `isDraw()` - now includes threefold repetition check
- **New Method**: `hasThreefoldRepetition()` - detects threefold repetition

### 3. Zobrist Hash Calculation

The Zobrist hash includes:
1. **Piece Positions**: XOR seeds for each piece type on each square
2. **Side to Move**: Different seed for white vs black to move
3. **Castling Rights**: 16 possible combinations (4 bits)
4. **En Passant Square**: File-based seeds (0-7) plus no-en-passant seed

```javascript
zobrist(gameState) {
  let hash = 0n;
  
  // Hash all pieces on the board
  for (let color = 0; color <= 1; color++) {
    for (let pieceType = PIECES.KING; pieceType <= PIECES.PAWN; pieceType++) {
      const pieceBB = this.bbPieces[color][pieceType].clone();
      while (!pieceBB.isEmpty()) {
        const square = pieceBB.popLSB();
        hash ^= ZOBRIST_SEEDS.pieces[color][pieceType][square];
      }
    }
  }
  
  // Hash castling rights
  hash ^= ZOBRIST_SEEDS.castling[gameState.castling];
  
  // Hash side to move
  if (gameState.active_color === "black") {
    hash ^= ZOBRIST_SEEDS.sides[1];
  } else {
    hash ^= ZOBRIST_SEEDS.sides[0];
  }
  
  // Hash en passant square
  if (gameState.en_passant_sq !== -1) {
    const enPassantFile = gameState.en_passant_sq % 8;
    hash ^= ZOBRIST_SEEDS.en_passant[enPassantFile + 1];
  } else {
    hash ^= ZOBRIST_SEEDS.en_passant[0];
  }
  
  return hash;
}
```

### 4. Threefold Repetition Detection

The detection algorithm:
1. Counts the current position as 1 occurrence
2. Looks through the game history
3. Only checks positions with the same player to move (every other position)
4. Optimizes by only looking back to the last irreversible move
5. Returns true if 3 or more identical positions are found

```javascript
hasThreefoldRepetition() {
  const currentZobrist = this.board.gameState.zobrist_key;
  let count = 1; // Current position
  
  const historyLength = this.board.history.states.length;
  const maxLookback = Math.min(historyLength, this.board.gameState.half_move_clock);
  
  // Check every other position (same player to move)
  for (let i = historyLength - 2; i >= Math.max(0, historyLength - maxLookback); i -= 2) {
    if (this.board.history.states[i].zobrist_key === currentZobrist) {
      count++;
      if (count >= 3) {
        console.log("Threefold repetition detected!");
        return true;
      }
    }
  }
  
  return false;
}
```

### 5. Conditions for Threefold Repetition

For two positions to be considered identical, they must have:
- **Same pieces on same squares**: All pieces in exact same positions
- **Same player to move**: White or black's turn must match
- **Same castling rights**: Available castling moves must be identical
- **Same en passant possibilities**: En passant capture availability must match

All these conditions are encoded in the Zobrist hash, making comparison efficient.

## Design Decisions

### 1. Full Recalculation vs Incremental Updates
**Decision**: Recalculate Zobrist hash completely after each move
**Justification**: 
- Simpler and more reliable implementation
- Avoids bugs from complex incremental update logic with special moves
- Performance impact negligible for interactive play
- Easier to maintain and debug

### 2. Using Existing ZOBRIST_SEEDS
**Decision**: Use pre-generated Zobrist seeds from gameConstants.js
**Justification**:
- Seeds were generated with proper hamming distance considerations
- Ensures minimal collision probability
- Maintains consistency with potential future features

### 3. BigInt for Hash Values
**Decision**: Use JavaScript BigInt for 64-bit hash values
**Justification**:
- Provides full 64-bit precision without floating point issues
- Native support in modern JavaScript
- Proper XOR operations on full 64-bit values

### 4. Optimization with half_move_clock
**Decision**: Limit lookback based on half_move_clock
**Justification**:
- Positions before the last pawn move or capture cannot repeat
- Reduces unnecessary comparisons
- Standard optimization in chess engines

## Testing Considerations

1. **Basic Repetition**: Knight moves back and forth
2. **With Captures**: Ensure positions after captures are different
3. **Castling Rights**: Different castling rights mean different positions
4. **En Passant**: Different en passant squares mean different positions
5. **Side to Move**: Same position with different player to move is not a repetition

## Future Enhancements

1. **Incremental Updates**: Could optimize by updating hash incrementally
2. **Move Generation Cache**: Could cache move generation using Zobrist keys
3. **Opening Book**: Could use Zobrist keys for opening book lookups
4. **Transposition Table**: Could implement for computer player evaluation

## Conclusion

The threefold repetition implementation successfully integrates with the existing chess application architecture. It uses industry-standard Zobrist hashing for efficient position comparison and correctly implements all aspects of the threefold repetition rule as defined in chess regulations.