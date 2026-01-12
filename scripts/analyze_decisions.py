#!/usr/bin/env python3
"""
Bot Decision Analysis Tool

This script analyzes JSON decision reports from the chess bot to identify
heuristics that are under or over contributing to move selection.

Usage:
    python analyze_decisions.py <decisions.json> [--output report.html]
    python analyze_decisions.py --help

The analysis includes:
1. Heuristic contribution analysis
2. Move quality assessment  
3. Time/depth analysis
4. Opening book usage patterns
5. Blunder/mistake pattern detection
6. Transposition table efficiency
7. Threat detection analysis
8. Move rank distribution
9. Contentious moves analysis
10. Draw condition tracking
"""

import json
import argparse
import sys
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Any, Optional, Tuple
import statistics

# Check required dependencies
try:
    import pandas as pd
except ImportError:
    print("Error: pandas is required but not installed.")
    print("Install it with: pip install pandas")
    sys.exit(1)

try:
    import matplotlib.pyplot as plt
    import matplotlib
    matplotlib.use('Agg')  # Use non-interactive backend
except ImportError:
    print("Error: matplotlib is required but not installed.")
    print("Install it with: pip install matplotlib")
    sys.exit(1)


class BotDecisionAnalyzer:
    """
    Comprehensive analyzer for bot decision reports.
    """
    
    def __init__(self, decisions: List[Dict[str, Any]]):
        self.decisions = decisions
        self.analysis_results = {}
        self.contentious_moves = []
        self.blunder_moves = []
        self.problematic_captures = []
        
    def run_full_analysis(self) -> Dict[str, Any]:
        """Run complete analysis suite."""
        print("=" * 60)
        print("BOT DECISION ANALYSIS REPORT")
        print("=" * 60)
        print(f"\nAnalyzing {len(self.decisions)} decisions...\n")
        
        results = {
            'summary': self._analyze_summary(),
            'heuristics': self._analyze_heuristics(),
            'search': self._analyze_search_performance(),
            'opening_book': self._analyze_opening_book(),
            'move_quality': self._analyze_move_quality(),
            'temporal': self._analyze_temporal_patterns(),
            'transposition_table': self._analyze_transposition_table(),
            'threat_detection': self._analyze_threat_detection(),
            'move_rank_distribution': self._analyze_move_rank_distribution(),
            'contentious_moves': self._analyze_contentious_moves(),
            'draw_conditions': self._analyze_draw_conditions(),
            'problematic_decisions': self._identify_problematic_decisions()
        }
        
        self.analysis_results = results
        return results
    
    def _analyze_summary(self) -> Dict[str, Any]:
        """Generate summary statistics."""
        print("-" * 40)
        print("SUMMARY STATISTICS")
        print("-" * 40)
        
        total_decisions = len(self.decisions)
        
        colors = [d.get('meta', {}).get('botColor') for d in self.decisions]
        white_count = colors.count('white')
        black_count = colors.count('black')
        
        difficulties = [d.get('meta', {}).get('difficulty') for d in self.decisions]
        difficulty_counts = defaultdict(int)
        for d in difficulties:
            if d:
                difficulty_counts[d] += 1
        
        # Game phases
        move_numbers = [d.get('meta', {}).get('moveNumber', 0) for d in self.decisions]
        phases = {'opening': 0, 'middlegame': 0, 'endgame': 0}
        for mn in move_numbers:
            if mn <= 15:
                phases['opening'] += 1
            elif mn <= 35:
                phases['middlegame'] += 1
            else:
                phases['endgame'] += 1
        
        summary = {
            'total_decisions': total_decisions,
            'white_decisions': white_count,
            'black_decisions': black_count,
            'difficulty_distribution': dict(difficulty_counts),
            'phase_distribution': phases
        }
        
        print(f"Total Decisions Analyzed: {total_decisions}")
        print(f"White Decisions: {white_count}")
        print(f"Black Decisions: {black_count}")
        print(f"Difficulty Distribution: {dict(difficulty_counts)}")
        print(f"Phase Distribution: {phases}")
        print()
        
        return summary
    
    def _analyze_heuristics(self) -> Dict[str, Any]:
        """Analyze heuristic contributions with variance analysis."""
        print("-" * 40)
        print("HEURISTIC ANALYSIS")
        print("-" * 40)
        
        heuristic_data = defaultdict(list)
        heuristic_by_move_rank = defaultdict(lambda: defaultdict(list))
        
        for decision in self.decisions:
            if 'moveAnalysis' not in decision:
                continue
                
            all_moves = decision.get('moveAnalysis', {}).get('allMoves', [])
            
            for rank, move in enumerate(all_moves):
                breakdown = move.get('breakdown', {})
                
                for heuristic_name, value in breakdown.items():
                    heuristic_data[heuristic_name].append(value)
                    heuristic_by_move_rank[heuristic_name][rank].append(value)
        
        # Calculate statistics
        heuristic_stats = {}
        total_abs_mean = 0
        
        for name, values in heuristic_data.items():
            if len(values) == 0:
                continue
            total_abs_mean += abs(statistics.mean(values))
        
        for name, values in heuristic_data.items():
            if len(values) == 0:
                continue
                
            mean_val = statistics.mean(values)
            std_val = statistics.stdev(values) if len(values) > 1 else 0
            
            # Calculate coefficient of variation
            cv = (std_val / abs(mean_val)) if mean_val != 0 else float('inf')
            
            stats = {
                'mean': mean_val,
                'median': statistics.median(values),
                'stdev': std_val,
                'min': min(values),
                'max': max(values),
                'count': len(values),
                'contribution_ratio': abs(mean_val) / max(1, total_abs_mean),
                'variance_to_mean_ratio': cv,
                'coefficient_of_variation': cv,
                'interquartile_range': self._calculate_iqr(values)
            }
            heuristic_stats[name] = stats
        
        issues = []
        
        print("\nHeuristic Statistics:")
        print("-" * 40)
        
        for name, stats in sorted(heuristic_stats.items(), key=lambda x: abs(x[1]['mean']), reverse=True):
            print(f"\n{name}:")
            print(f"  Mean: {stats['mean']:.2f}")
            print(f"  Median: {stats['median']:.2f}")
            print(f"  StdDev: {stats['stdev']:.2f}")
            print(f"  Range: [{stats['min']:.2f}, {stats['max']:.2f}]")
            print(f"  Contribution Ratio: {stats['contribution_ratio']:.2%}")
            print(f"  Coefficient of Variation: {stats['coefficient_of_variation']:.2f}")
            print(f"  IQR: {stats['interquartile_range']:.2f}")
            
            # Flag issues
            if stats['contribution_ratio'] > 0.4:
                issue = f"{name} OVER-contributing ({stats['contribution_ratio']:.1%})"
                issues.append(issue)
                print(f"  ⚠️  {issue}")
            elif stats['contribution_ratio'] < 0.05 and stats['mean'] != 0:
                issue = f"{name} UNDER-contributing ({stats['contribution_ratio']:.1%})"
                issues.append(issue)
                print(f"  ⚠️  {issue}")
            
            if stats['coefficient_of_variation'] > 1.5 and stats['mean'] != 0:
                issue = f"{name} HIGH VARIANCE (CV: {stats['coefficient_of_variation']:.2f})"
                issues.append(issue)
                print(f"  ⚠️  {issue}")
        
        top_move_analysis = self._analyze_top_move_heuristics(heuristic_by_move_rank)
        
        print()
        return {
            'statistics': heuristic_stats,
            'issues': issues,
            'top_move_analysis': top_move_analysis
        }
    
    def _calculate_iqr(self, values: List[float]) -> float:
        """Calculate interquartile range."""
        if len(values) < 4:
            return 0
        sorted_vals = sorted(values)
        q1_idx = len(sorted_vals) // 4
        q3_idx = 3 * len(sorted_vals) // 4
        return sorted_vals[q3_idx] - sorted_vals[q1_idx]
    
    def _analyze_top_move_heuristics(self, heuristic_by_move_rank: Dict) -> Dict:
        """Analyze which heuristics differentiate top moves."""
        print("\nTop Move Differentiators:")
        print("-" * 40)
        
        differentiators = {}
        
        for heuristic, rank_data in heuristic_by_move_rank.items():
            if 0 not in rank_data or len(rank_data[0]) < 5:
                continue
                
            top_move_avg = statistics.mean(rank_data[0])
            
            other_values = []
            for rank in range(5, 15):
                if rank in rank_data:
                    other_values.extend(rank_data[rank])
            
            if len(other_values) < 5:
                continue
                
            other_avg = statistics.mean(other_values)
            diff = top_move_avg - other_avg
            
            differentiators[heuristic] = {
                'top_move_avg': top_move_avg,
                'other_avg': other_avg,
                'difference': diff,
                'is_differentiator': abs(diff) > 20
            }
            
            if abs(diff) > 20:
                direction = "HIGHER" if diff > 0 else "LOWER"
                print(f"  {heuristic}: Top moves have {direction} scores (diff: {diff:.2f})")
        
        return differentiators
    
    def _analyze_search_performance(self) -> Dict[str, Any]:
        """Analyze search performance with search type breakdown."""
        print("\n" + "-" * 40)
        print("SEARCH PERFORMANCE")
        print("-" * 40)
        
        depths = []
        times = []
        positions = []
        nps_values = []
        quiescence_nodes = []
        cutoffs = []
        search_types = defaultdict(int)
        
        for decision in self.decisions:
            stats = decision.get('searchStats', {})
            if stats:
                depths.append(stats.get('maxDepthReached', 0))
                times.append(stats.get('timeSpentMs', 0))
                positions.append(stats.get('positionsEvaluated', 0))
                nps = stats.get('nodesPerSecond', 0)
                if nps > 0:
                    nps_values.append(nps)
                quiescence_nodes.append(stats.get('quiescenceNodes', 0))
                cutoffs.append(stats.get('cutoffs', 0))
                search_types[stats.get('searchType', 'unknown')] += 1
        
        if not depths:
            print("No search statistics available.")
            return {}
        
        results = {
            'depth': {
                'mean': statistics.mean(depths),
                'median': statistics.median(depths),
                'min': min(depths),
                'max': max(depths)
            },
            'time_ms': {
                'mean': statistics.mean(times),
                'median': statistics.median(times),
                'min': min(times),
                'max':max(times)
            },
            'positions': {
                'mean': statistics.mean(positions),
                'total': sum(positions)
            },
            'quiescence': {
                'mean': statistics.mean(quiescence_nodes) if quiescence_nodes else 0,
                'total': sum(quiescence_nodes)
            },
            'cutoffs': {
                'mean': statistics.mean(cutoffs) if cutoffs else 0,
                'total': sum(cutoffs)
            },
            'search_types': dict(search_types)
        }
        
        if nps_values:
            results['nps'] = {
                'mean': statistics.mean(nps_values),
                'median': statistics.median(nps_values)
            }
        
        print(f"\nSearch Depth:")
        print(f"  Mean: {results['depth']['mean']:.1f}")
        print(f"  Range: [{results['depth']['min']}, {results['depth']['max']}]")
        
        print(f"\nTime per Move:")
        print(f"  Mean: {results['time_ms']['mean']:.1f}ms")
        print(f"  Range: [{results['time_ms']['min']}ms, {results['time_ms']['max']}ms]")
        
        print(f"\nSearch Types:")
        for stype, count in search_types.items():
            pct = count / len(self.decisions) * 100
            print(f"  {stype}: {count} ({pct:.1f}%)")
        
        zero_time_count = sum(1 for t in times if t == 0)
        forced_count = search_types.get('forced', 0)
        
        if zero_time_count > forced_count:
            unexpected_zero = zero_time_count - forced_count
            print(f"\n⚠️  {unexpected_zero} decisions had 0ms search time unexpectedly")
        
        print()
        return results
    
    def _analyze_transposition_table(self) -> Dict[str, Any]:
        """Analyze transposition table efficiency."""
        print("-" * 40)
        print("TRANSPOSITION TABLE ANALYSIS")
        print("-" * 40)
        
        tt_hits = []
        tt_stores = []
        tt_hit_rates = []
        aspiration_researches = []
        
        for decision in self.decisions:
            stats = decision.get('searchStats', {})
            if stats:
                tt_hits.append(stats.get('transpositionTableHits', 0))
                tt_stores.append(stats.get('transpositionTableStores', 0))
                hit_rate_str = stats.get('transpositionTableHitRate', '0%')
                try:
                    hit_rate = float(hit_rate_str.replace('%', ''))
                    tt_hit_rates.append(hit_rate)
                except:
                    pass
                aspiration_researches.append(stats.get('aspirationWindowReSearches', 0))
        
        if not tt_hits or all(h == 0 for h in tt_hits):
            print("Transposition table not used or no data available.")
            return {}
        
        results = {
            'hits': {
                'mean': statistics.mean(tt_hits),
                'total': sum(tt_hits)
            },
            'stores': {
                'mean': statistics.mean(tt_stores),
                'total': sum(tt_stores)
            },
            'hit_rate': {
                'mean': statistics.mean(tt_hit_rates) if tt_hit_rates else 0
            },
            'aspiration_researches': {
                'mean': statistics.mean(aspiration_researches),
                'total': sum(aspiration_researches)
            }
        }
        
        print(f"TT Hits: {results['hits']['total']} (avg {results['hits']['mean']:.1f}/move)")
        print(f"TT Stores: {results['stores']['total']} (avg {results['stores']['mean']:.1f}/move)")
        print(f"Average Hit Rate: {results['hit_rate']['mean']:.1f}%")
        print(f"Aspiration Re-searches: {results['aspiration_researches']['total']}")
        print()
        
        return results
    
    def _analyze_threat_detection(self) -> Dict[str, Any]:
        """Analyze threat detection."""
        print("-" * 40)
        print("THREAT DETECTION ANALYSIS")
        print("-" * 40)
        
        threats_detected = []
        hanging_counts = []
        attacked_counts = []
        
        for decision in self.decisions:
            threat_info = decision.get('threatInfo', {})
            if threat_info:
                threats_detected.append(threat_info.get('threatsDetected', 0))
                hanging_counts.append(len(threat_info.get('hangingPieces', [])))
                attacked_counts.append(len(threat_info.get('attackedPieces', [])))
        
        if not threats_detected:
            print("No threat detection data available.")
            return {}
        
        results = {
            'threats_detected': {
                'mean': statistics.mean(threats_detected),
                'total': sum(threats_detected),
                'max': max(threats_detected) if threats_detected else 0
            },
            'hanging_pieces': {
                'mean': statistics.mean(hanging_counts),
                'total': sum(hanging_counts)
            },
            'attacked_pieces': {
                'mean': statistics.mean(attacked_counts),
                'total': sum(attacked_counts)
            }
        }
        
        print(f"Threats Detected: {results['threats_detected']['total']} (avg {results['threats_detected']['mean']:.2f}/move)")
        print(f"Hanging Pieces Found: {results['hanging_pieces']['total']}")
        print(f"Attacked Pieces Found: {results['attacked_pieces']['total']}")
        print()
        
        return results
    
    def _analyze_draw_conditions(self) -> Dict[str, Any]:
        """Analyze draw condition tracking."""
        print("-" * 40)
        print("DRAW CONDITION ANALYSIS")
        print("-" * 40)
        
        fifty_move_counters = []
        repetition_counts = []
        draw_positions = 0
        draw_reasons = defaultdict(int)
        
        for decision in self.decisions:
            draw_info = decision.get('drawInfo', {})
            if draw_info:
                fifty_move_counters.append(draw_info.get('fiftyMoveCounter', 0))
                repetition_counts.append(draw_info.get('repetitionCount', 0))
                if draw_info.get('isDrawPosition', False):
                    draw_positions += 1
                    reason = draw_info.get('drawReason', 'unknown')
                    draw_reasons[reason] += 1
        
        if not fifty_move_counters:
            print("No draw condition data available.")
            return {}
        
        results = {
            'fifty_move_counter': {
                'mean': statistics.mean(fifty_move_counters),
                'max': max(fifty_move_counters)
            },
            'repetition_counts': {
                'mean': statistics.mean(repetition_counts),
                'max': max(repetition_counts)
            },
            'draw_positions_detected': draw_positions,
            'draw_reasons': dict(draw_reasons)
        }
        
        print(f"50-Move Counter: max {results['fifty_move_counter']['max']}, avg {results['fifty_move_counter']['mean']:.1f}")
        print(f"Repetition Count: max {results['repetition_counts']['max']}, avg {results['repetition_counts']['mean']:.2f}")
        print(f"Draw Positions Detected: {draw_positions}")
        if draw_reasons:
            print(f"Draw Reasons: {dict(draw_reasons)}")
        
        if results['fifty_move_counter']['max'] >= 100:
            print("\n⚠️  50-move rule threshold reached but game continued!")
        if results['repetition_counts']['max'] >= 3:
            print("\n⚠️  Threefold repetition threshold reached but game continued!")
        
        print()
        return results
    
    def _analyze_contentious_moves(self) -> Dict[str, Any]:
        """Identify and analyze contentious moves."""
        print("-" * 40)
        print("CONTENTIOUS MOVES ANALYSIS")
        print("-" * 40)
        
        contentious_moves = []
        
        for decision in self.decisions:
            contention_info = decision.get('contentionInfo', {})
            meta = decision.get('meta', {})
            decision_info = decision.get('decision', {})
            
            is_contentious = contention_info.get('isContentious', False)
            score_gap = contention_info.get('scoreGap', 0)
            top_diff = contention_info.get('topMovesScoreDiff', 0)
            
            # Flag as contentious if:
            # 1. Multiple close alternatives exist
            # 2. Selected move was not rank 0
            # 3. Large score gap from best
            
            selected_rank = decision_info.get('selectedRank', 0)
            imperfection = decision_info.get('imperfection', {})
            
            if is_contentious or selected_rank > 2 or score_gap > 50:
                move_info = {
                    'move_number': meta.get('moveNumber', 0),
                    'fen': meta.get('fen', ''),
                    'bot_color': meta.get('botColor', ''),
                    'selected_move': decision_info.get('selectedMove', {}),
                    'selected_rank': selected_rank,
                    'score_gap': score_gap,
                    'top_moves_diff': top_diff,
                    'is_contentious': is_contentious,
                    'imperfection_type': imperfection.get('type'),
                    'alternatives': contention_info.get('alternativesConsidered', 0)
                }
                contentious_moves.append(move_info)
        
        self.contentious_moves = contentious_moves
        
        results = {
            'total_contentious': len(contentious_moves),
            'contentious_percentage': len(contentious_moves) / max(1, len(self.decisions)) * 100,
            'moves': contentious_moves[:20]  # Top 20 most contentious
        }
        
        print(f"Contentious Decisions: {len(contentious_moves)} ({results['contentious_percentage']:.1f}%)")
        
        if contentious_moves:
            print("\nMost Contentious Moves:")
            sorted_contentious = sorted(contentious_moves, key=lambda x: x['score_gap'], reverse=True)[:10]
            for i, move in enumerate(sorted_contentious):
                print(f"\n  {i+1}. Move {move['move_number']} ({move['bot_color']})")
                if move['selected_move']:
                    print(f"      Selected: {move['selected_move'].get('algebraic', 'N/A')}")
                print(f"      Rank: {move['selected_rank']}, Gap: {move['score_gap']:.1f}")
                if move['imperfection_type']:
                    print(f"      Imperfection: {move['imperfection_type']}")
        
        print()
        return results
    
    def _identify_problematic_decisions(self) -> Dict[str, Any]:
        """Identify specific problematic decisions for debugging."""
        print("-" * 40)
        print("PROBLEMATIC DECISIONS")
        print("-" * 40)
        
        problems = {
            'high_rank_selections': [],
            'blunders': [],
            'missed_threats': [],
            'bad_captures': []
        }
        
        for decision in self.decisions:
            meta = decision.get('meta', {})
            decision_info = decision.get('decision', {})
            move_analysis = decision.get('moveAnalysis', {})
            threat_info = decision.get('threatInfo', {})
            
            selected_rank = decision_info.get('selectedRank', 0)
            imperfection = decision_info.get('imperfection', {})
            all_moves = move_analysis.get('allMoves', [])
            
            # High rank selections (not due to imperfection)
            if selected_rank > 5 and not imperfection.get('type'):
                problems['high_rank_selections'].append({
                    'move_number': meta.get('moveNumber'),
                    'fen': meta.get('fen'),
                    'selected_rank': selected_rank,
                    'selected_move': decision_info.get('selectedMove'),
                    'best_move': all_moves[0] if all_moves else None
                })
            
            # Blunders
            if imperfection.get('type') == 'blunder':
                problems['blunders'].append({
                    'move_number': meta.get('moveNumber'),
                    'fen': meta.get('fen'),
                    'original_move': imperfection.get('originalMove'),
                    'played_move': decision_info.get('finalMove')
                })
            
            # Missed threats (had hanging pieces but still lost material)
            hanging = threat_info.get('hangingPieces', [])
            if hanging and selected_rank > 0:
                # Check if we addressed the threat
                selected_move = decision_info.get('selectedMove', {})
                problems['missed_threats'].append({
                    'move_number': meta.get('moveNumber'),
                    'hanging_pieces': hanging,
                    'selected_move': selected_move
                })
            
            # Bad captures (captured piece but may have lost more)
            selected = decision_info.get('selectedMove', {})
            if selected and selected.get('capture'):
                # Find this move in all_moves
                for move in all_moves:
                    if move.get('move', {}).get('algebraic') == selected.get('algebraic'):
                        if move.get('rank', 0) > 3:
                            problems['bad_captures'].append({
                                'move_number': meta.get('moveNumber'),
                                'capture': selected.get('algebraic'),
                                'rank': move.get('rank'),
                                'score': move.get('score')
                            })
                        break
        
        # Print summary
        print(f"\nHigh Rank Selections (rank > 5): {len(problems['high_rank_selections'])}")
        for p in problems['high_rank_selections'][:5]:
            print(f"  Move {p['move_number']}: Rank {p['selected_rank']}")
            
        print(f"\nBlunders: {len(problems['blunders'])}")
        for p in problems['blunders'][:5]:
            print(f"  Move {p['move_number']}: {p.get('original_move', {}).get('algebraic')} -> {p.get('played_move', {}).get('algebraic')}")
        
        print(f"\nMissed Threats: {len(problems['missed_threats'])}")
        print(f"\nBad Captures (rank > 3): {len(problems['bad_captures'])}")
        for p in problems['bad_captures'][:5]:
            print(f"  Move {p['move_number']}: {p['capture']} (rank {p['rank']}, score {p['score']:.1f})")
        
        print()
        return problems
    
    def _analyze_move_rank_distribution(self) -> Dict[str, Any]:
        """Analyze move rank distribution."""
        print("-" * 40)
        print("MOVE RANK DISTRIBUTION")
        print("-" * 40)
        
        selected_ranks = []
        
        for decision in self.decisions:
            decision_info = decision.get('decision', {})
            rank = decision_info.get('selectedRank')
            if rank is not None:
                selected_ranks.append(rank)
        
        if not selected_ranks:
            print("No move rank data available.")
            return {}
        
        rank_distribution = defaultdict(int)
        for r in selected_ranks:
            rank_distribution[r] += 1
        
        results = {
            'distribution': dict(rank_distribution),
            'mean_rank': statistics.mean(selected_ranks),
            'median_rank': statistics.median(selected_ranks),
            'max_rank': max(selected_ranks),
            'top_choice_percentage': rank_distribution.get(0, 0) / len(selected_ranks) * 100,
            'top_3_percentage': sum(rank_distribution.get(i, 0) for i in range(3)) / len(selected_ranks) * 100,
            'top_5_percentage': sum(rank_distribution.get(i, 0) for i in range(5)) / len(selected_ranks) * 100
        }
        
        print(f"Mean Selected Rank: {results['mean_rank']:.2f}")
        print(f"Median Selected Rank: {results['median_rank']:.1f}")
        print(f"Max Selected Rank: {results['max_rank']}")
        print(f"Top Choice (Rank 0): {results['top_choice_percentage']:.1f}%")
        print(f"Top 3 (Rank 0-2): {results['top_3_percentage']:.1f}%")
        print(f"Top 5 (Rank 0-4): {results['top_5_percentage']:.1f}%")
        
        print("\nRank Distribution:")
        for rank in range(min(15, max(selected_ranks) + 1)):
            count = rank_distribution.get(rank, 0)
            pct = count / len(selected_ranks) * 100
            bar = "█" * int(pct / 2)
            print(f"  Rank {rank:2d}: {count:4d} ({pct:5.1f}%) {bar}")
        
        if results['max_rank'] > 10:
            print(f"\n⚠️  Warning: Move as low as rank {results['max_rank']} was selected!")
        
        if results['top_choice_percentage'] < 50:
            print(f"\n⚠️  Warning: Top choice selected only {results['top_choice_percentage']:.1f}% of the time.")
        
        print()
        return results
    
    def _analyze_opening_book(self) -> Dict[str, Any]:
        """Analyze opening book usage."""
        print("-" * 40)
        print("OPENING BOOK ANALYSIS")
        print("-" * 40)
        
        book_tried = 0
        book_found = 0
        book_integrated = 0
        
        for decision in self.decisions:
            book_info = decision.get('openingBook', {})
            if book_info.get('tried', False):
                book_tried += 1
                if book_info.get('found', False):
                    book_found += 1
                if book_info.get('integratedIntoSearch', False):
                    book_integrated += 1
        
        results = {
            'attempts': book_tried,
            'found': book_found,
            'integrated': book_integrated,
            'hit_rate': book_found / max(1, book_tried),
            'integration_rate': book_integrated / max(1, book_found) if book_found > 0 else 0
        }
        
        print(f"Book Lookup Attempts: {book_tried}")
        print(f"Book Moves Found: {book_found} ({results['hit_rate']:.1%} hit rate)")
        print(f"Moves Integrated: {book_integrated}")
        print()
        
        return results
    
    def _analyze_move_quality(self) -> Dict[str, Any]:
        """Analyze move quality."""
        print("-" * 40)
        print("MOVE QUALITY ANALYSIS")
        print("-" * 40)
        
        selected_ranks = []
        score_gaps = []
        imperfections = defaultdict(int)
        
        for decision in self.decisions:
            move_analysis = decision.get('moveAnalysis', {})
            all_moves = move_analysis.get('allMoves', [])
            decision_info = decision.get('decision', {})
            selected_move = decision_info.get('selectedMove', {})
            
            if not all_moves or not selected_move:
                continue
            
            selected_algebraic = selected_move.get('algebraic')
            for rank, move in enumerate(all_moves):
                if move.get('move', {}).get('algebraic') == selected_algebraic:
                    selected_ranks.append(rank)
                    
                    if rank > 0 and len(all_moves) > 0:
                        best_score = all_moves[0].get('score', 0)
                        selected_score = move.get('score', 0)
                        score_gaps.append(best_score - selected_score)
                    break
            
            imperf = decision_info.get('imperfection', {})
            if imperf.get('type'):
                imperfections[imperf['type']] += 1
        
        results = {
            'rank_distribution': {},
            'score_gaps': {},
            'imperfections': dict(imperfections)
        }
        
        if selected_ranks:
            rank_dist = defaultdict(int)
            for r in selected_ranks:
                rank_dist[r] += 1
            results['rank_distribution'] = dict(rank_dist)
            
            top_choice_pct = rank_dist.get(0, 0) / len(selected_ranks) * 100
            top3_pct = sum(rank_dist.get(i, 0) for i in range(3)) / len(selected_ranks) * 100
            
            print(f"Selected Move Rank Distribution:")
            print(f"  Top Choice: {top_choice_pct:.1f}%")
            print(f"  Top 3: {top3_pct:.1f}%")
        
        if score_gaps:
            results['score_gaps'] = {
                'mean': statistics.mean(score_gaps),
                'median': statistics.median(score_gaps),
                'max': max(score_gaps)
            }
            print(f"\nScore Gap from Best Move:")
            print(f"  Mean: {results['score_gaps']['mean']:.1f}")
            print(f"  Median: {results['score_gaps']['median']:.1f}")
            print(f"  Max: {results['score_gaps']['max']:.1f}")
        
        if imperfections:
            print(f"\nImperfections Applied:")
            for imp_type, count in imperfections.items():
                print(f"  {imp_type}: {count}")
        
        print()
        return results
    
    def _analyze_temporal_patterns(self) -> Dict[str, Any]:
        """Analyze temporal patterns."""
        print("-" * 40)
        print("TEMPORAL PATTERNS")
        print("-" * 40)
        
        phases = {
            'opening': (1, 15),
            'middlegame': (16, 35),
            'endgame': (36, 500)
        }
        
        phase_data = {phase: [] for phase in phases}
        
        for decision in self.decisions:
            move_num = decision.get('meta', {}).get('moveNumber', 0)
            stats = decision.get('searchStats', {})
            
            for phase, (start, end) in phases.items():
                if start <= move_num <= end:
                    phase_data[phase].append({
                        'depth': stats.get('maxDepthReached', 0),
                        'time': stats.get('timeSpentMs', 0),
                        'positions': stats.get('positionsEvaluated', 0)
                    })
                    break
        
        results = {}
        for phase, data in phase_data.items():
            if data:
                results[phase] = {
                    'count': len(data),
                    'avg_depth': statistics.mean([d['depth'] for d in data]),
                    'avg_time': statistics.mean([d['time'] for d in data]),
                    'avg_positions': statistics.mean([d['positions'] for d in data])
                }
        
        print("Performance by Game Phase:")
        for phase, stats in results.items():
            print(f"\n  {phase.title()}:")
            print(f"    Decisions: {stats['count']}")
            print(f"    Avg Depth: {stats['avg_depth']:.1f}")
            print(f"    Avg Time: {stats['avg_time']:.1f}ms")
        
        print()
        return results
    
    def generate_visualizations(self, output_dir: str):
        """Generate visualization charts."""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        if 'heuristics' in self.analysis_results:
            self._plot_heuristic_contributions(output_path)
        
        self._plot_search_depths(output_path)
        self._plot_move_rank_distribution(output_path)
        self._plot_contentious_moves(output_path)
        
        print(f"Visualizations saved to {output_path}")
    
    def _plot_heuristic_contributions(self, output_path: Path):
        """Plot heuristic contributions."""
        stats = self.analysis_results.get('heuristics', {}).get('statistics', {})
        if not stats:
            return
        
        names = list(stats.keys())
        means = [stats[n]['mean'] for n in names]
        stds = [stats[n]['stdev'] for n in names]
        
        fig, ax = plt.subplots(figsize=(10, 6))
        bars = ax.barh(names, means, xerr=stds, capsize=5)
        ax.set_xlabel('Mean Contribution')
        ax.set_title('Heuristic Contributions to Evaluation')
        ax.axvline(x=0, color='gray', linestyle='--', linewidth=0.5)
        
        plt.tight_layout()
        plt.savefig(output_path / 'heuristic_contributions.png', dpi=150)
        plt.close()
    
    def _plot_search_depths(self, output_path: Path):
        """Plot search depth distribution."""
        depths = []
        for decision in self.decisions:
            depth = decision.get('searchStats', {}).get('maxDepthReached', 0)
            depths.append(depth)
        
        if not depths:
            return
        
        fig, ax = plt.subplots(figsize=(8, 5))
        ax.hist(depths, bins=range(max(depths) + 2), edgecolor='black', alpha=0.7)
        ax.set_xlabel('Search Depth')
        ax.set_ylabel('Frequency')
        ax.set_title('Search Depth Distribution')
        
        plt.tight_layout()
        plt.savefig(output_path / 'search_depth_distribution.png', dpi=150)
        plt.close()
    
    def _plot_move_rank_distribution(self, output_path: Path):
        """Plot move rank distribution."""
        ranks = []
        for decision in self.decisions:
            rank = decision.get('decision', {}).get('selectedRank')
            if rank is not None:
                ranks.append(rank)
        
        if not ranks:
            return
        
        fig, ax = plt.subplots(figsize=(10, 5))
        max_rank = min(max(ranks) + 1, 20)
        ax.hist(ranks, bins=range(max_rank + 1), edgecolor='black', alpha=0.7, color='steelblue')
        ax.set_xlabel('Move Rank')
        ax.set_ylabel('Frequency')
        ax.set_title('Distribution of Selected Move Ranks')
        ax.set_xticks(range(max_rank))
        
        plt.tight_layout()
        plt.savefig(output_path / 'move_rank_distribution.png', dpi=150)
        plt.close()
    
    def _plot_contentious_moves(self, output_path: Path):
        """Plot contentious moves over time."""
        if not self.contentious_moves:
            return
        
        move_numbers = [m['move_number'] for m in self.contentious_moves]
        score_gaps = [m['score_gap'] for m in self.contentious_moves]
        
        fig, ax = plt.subplots(figsize=(12, 5))
        ax.scatter(move_numbers, score_gaps, alpha=0.6, c='red')
        ax.set_xlabel('Move Number')
        ax.set_ylabel('Score Gap from Best')
        ax.set_title('Contentious Moves Throughout Game')
        ax.axhline(y=50, color='orange', linestyle='--', label='Threshold')
        ax.legend()
        
        plt.tight_layout()
        plt.savefig(output_path / 'contentious_moves.png', dpi=150)
        plt.close()
    
    def export_dataframe(self) -> Optional[pd.DataFrame]:
        """Export decision data as DataFrame."""
        rows = []
        for decision in self.decisions:
            row = {
                'timestamp': decision.get('meta', {}).get('timestamp'),
                'bot_color': decision.get('meta', {}).get('botColor'),
                'difficulty': decision.get('meta', {}).get('difficulty'),
                'move_number': decision.get('meta', {}).get('moveNumber'),
                'half_move_clock': decision.get('meta', {}).get('halfMoveClock'),
                'fen': decision.get('meta', {}).get('fen'),
                'legal_moves': decision.get('moveAnalysis', {}).get('totalLegalMoves'),
                'depth_reached': decision.get('searchStats', {}).get('maxDepthReached'),
                'time_ms': decision.get('searchStats', {}).get('timeSpentMs'),
                'positions_evaluated': decision.get('searchStats', {}).get('positionsEvaluated'),
                'quiescence_nodes': decision.get('searchStats', {}).get('quiescenceNodes'),
                'cutoffs': decision.get('searchStats', {}).get('cutoffs'),
                'search_type': decision.get('searchStats', {}).get('searchType'),
                'tt_hits': decision.get('searchStats', {}).get('transpositionTableHits'),
                'tt_stores': decision.get('searchStats', {}).get('transpositionTableStores'),
                'book_found': decision.get('openingBook', {}).get('found'),
                'selected_score': decision.get('decision', {}).get('selectedScore'),
                'selected_rank': decision.get('decision', {}).get('selectedRank'),
                'imperfection_type': decision.get('decision', {}).get('imperfection', {}).get('type'),
                'threats_detected': decision.get('threatInfo', {}).get('threatsDetected', 0),
                'is_contentious': decision.get('contentionInfo', {}).get('isContentious', False),
                'score_gap': decision.get('contentionInfo', {}).get('scoreGap', 0),
                'fifty_move_counter': decision.get('drawInfo', {}).get('fiftyMoveCounter', 0),
                'repetition_count': decision.get('drawInfo', {}).get('repetitionCount', 0),
                'is_draw_position': decision.get('drawInfo', {}).get('isDrawPosition', False)
            }
            
            all_moves = decision.get('moveAnalysis', {}).get('allMoves', [])
            if all_moves:
                breakdown = all_moves[0].get('breakdown', {})
                for heuristic, value in breakdown.items():
                    row[f'h_{heuristic}'] = value
            
            rows.append(row)
        
        return pd.DataFrame(rows)
    
    def export_contentious_moves(self, output_path: Path):
        """Export contentious moves to separate file."""
        if not self.contentious_moves:
            return
        
        with open(output_path / 'contentious_moves.json', 'w') as f:
            json.dump(self.contentious_moves, f, indent=2)
        
        print(f"Contentious moves exported to {output_path / 'contentious_moves.json'}")


def main():
    parser = argparse.ArgumentParser(
        description='Analyze bot decision JSON reports',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('input', help='Input JSON file with decision reports')
    parser.add_argument('--output', '-o', help='Output directory', default='./analysis')
    parser.add_argument('--visualize', '-v', action='store_true', help='Generate charts')
    parser.add_argument('--csv', action='store_true', help='Export CSV')
    
    args = parser.parse_args()
    
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}")
        sys.exit(1)
    
    print(f"Loading decisions from: {input_path}")
    
    with open(input_path, 'r') as f:
        data = json.load(f)
    
    if isinstance(data, dict):
        decisions = [data]
    else:
        decisions = data
    
    print(f"Loaded {len(decisions)} decision(s)")
    print()
    
    analyzer = BotDecisionAnalyzer(decisions)
    results = analyzer.run_full_analysis()
    
    output_path = Path(args.output)
    output_path.mkdir(parents=True, exist_ok=True)
    
    results_file = output_path / 'analysis_results.json'
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"Results saved to: {results_file}")
    
    analyzer.export_contentious_moves(output_path)
    
    if args.visualize:
        analyzer.generate_visualizations(output_path)
    
    if args.csv:
        df = analyzer.export_dataframe()
        if df is not None:
            csv_file = output_path / 'decisions_data.csv'
            df.to_csv(csv_file, index=False)
            print(f"CSV exported to: {csv_file}")
    
    print("\nAnalysis complete!")


if __name__ == '__main__':
    main()