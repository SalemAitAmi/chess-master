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
"""

import json
import argparse
import sys
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Any, Optional
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
    
    Analyzes JSON decision data to identify patterns, strengths, and weaknesses
    in the bot's heuristic evaluation system.
    """
    
    def __init__(self, decisions: List[Dict[str, Any]]):
        """
        Initialize analyzer with decision data.
        
        Args:
            decisions: List of decision report dictionaries
        """
        self.decisions = decisions
        self.analysis_results = {}
        
    def run_full_analysis(self) -> Dict[str, Any]:
        """
        Run complete analysis suite.
        
        Returns:
            Dictionary containing all analysis results
        """
        print("=" * 60)
        print("BOT DECISION ANALYSIS REPORT")
        print("=" * 60)
        print()
        
        results = {
            'summary': self._analyze_summary(),
            'heuristics': self._analyze_heuristics(),
            'search': self._analyze_search_performance(),
            'opening_book': self._analyze_opening_book(),
            'move_quality': self._analyze_move_quality(),
            'temporal': self._analyze_temporal_patterns()
        }
        
        self.analysis_results = results
        return results
    
    def _analyze_summary(self) -> Dict[str, Any]:
        """Generate summary statistics."""
        print("-" * 40)
        print("SUMMARY STATISTICS")
        print("-" * 40)
        
        total_decisions = len(self.decisions)
        
        # Bot colors
        colors = [d['meta']['botColor'] for d in self.decisions if 'meta' in d]
        white_count = colors.count('white')
        black_count = colors.count('black')
        
        # Difficulties
        difficulties = [d['meta']['difficulty'] for d in self.decisions if 'meta' in d]
        difficulty_counts = defaultdict(int)
        for d in difficulties:
            difficulty_counts[d] += 1
        
        summary = {
            'total_decisions': total_decisions,
            'white_decisions': white_count,
            'black_decisions': black_count,
            'difficulty_distribution': dict(difficulty_counts)
        }
        
        print(f"Total Decisions Analyzed: {total_decisions}")
        print(f"White Decisions: {white_count}")
        print(f"Black Decisions: {black_count}")
        print(f"Difficulty Distribution: {dict(difficulty_counts)}")
        print()
        
        return summary
    
    def _analyze_heuristics(self) -> Dict[str, Any]:
        """
        Analyze heuristic contributions.
        
        This is the core analysis that identifies which heuristics are
        over or under contributing to move selection.
        """
        print("-" * 40)
        print("HEURISTIC ANALYSIS")
        print("-" * 40)
        
        heuristic_data = defaultdict(list)
        heuristic_by_move_rank = defaultdict(lambda: defaultdict(list))
        
        for decision in self.decisions:
            if 'moveAnalysis' not in decision:
                continue
                
            all_moves = decision['moveAnalysis'].get('allMoves', [])
            
            for rank, move in enumerate(all_moves):
                breakdown = move.get('breakdown', {})
                score = move.get('score', 0)
                
                for heuristic_name, value in breakdown.items():
                    heuristic_data[heuristic_name].append(value)
                    heuristic_by_move_rank[heuristic_name][rank].append(value)
        
        # Calculate statistics for each heuristic
        heuristic_stats = {}
        for name, values in heuristic_data.items():
            if len(values) == 0:
                continue
                
            stats = {
                'mean': statistics.mean(values),
                'median': statistics.median(values),
                'stdev': statistics.stdev(values) if len(values) > 1 else 0,
                'min': min(values),
                'max': max(values),
                'count': len(values),
                'contribution_ratio': abs(statistics.mean(values)) / max(1, sum(abs(statistics.mean(v)) for v in heuristic_data.values()) / len(heuristic_data))
            }
            heuristic_stats[name] = stats
        
        # Identify over/under contributing heuristics
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
            
            # Flag potential issues
            if stats['contribution_ratio'] > 0.5:
                issue = f"{name} may be OVER-contributing (ratio: {stats['contribution_ratio']:.2%})"
                issues.append(issue)
                print(f"  ⚠️  {issue}")
            elif stats['contribution_ratio'] < 0.05 and stats['mean'] != 0:
                issue = f"{name} may be UNDER-contributing (ratio: {stats['contribution_ratio']:.2%})"
                issues.append(issue)
                print(f"  ⚠️  {issue}")
            
            # Check for high variance
            if stats['stdev'] > abs(stats['mean']) * 2 and stats['mean'] != 0:
                issue = f"{name} has HIGH VARIANCE relative to mean"
                issues.append(issue)
                print(f"  ⚠️  {issue}")
        
        # Analyze correlation between heuristics for top moves vs other moves
        top_move_correlation = self._analyze_top_move_heuristics(heuristic_by_move_rank)
        
        print()
        return {
            'statistics': heuristic_stats,
            'issues': issues,
            'top_move_analysis': top_move_correlation
        }
    
    def _analyze_top_move_heuristics(self, heuristic_by_move_rank: Dict) -> Dict:
        """Analyze which heuristics differentiate top moves."""
        print("\nTop Move Differentiators:")
        print("-" * 40)
        
        differentiators = {}
        
        for heuristic, rank_data in heuristic_by_move_rank.items():
            if 0 not in rank_data or len(rank_data[0]) < 5:
                continue
                
            top_move_avg = statistics.mean(rank_data[0])
            
            # Compare to average of moves ranked 5-10
            other_values = []
            for rank in range(5, 11):
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
                'is_differentiator': abs(diff) > 10
            }
            
            if abs(diff) > 10:
                direction = "HIGHER" if diff > 0 else "LOWER"
                print(f"  {heuristic}: Top moves have {direction} scores (diff: {diff:.2f})")
        
        return differentiators
    
    def _analyze_search_performance(self) -> Dict[str, Any]:
        """Analyze search depth and time performance."""
        print("\n" + "-" * 40)
        print("SEARCH PERFORMANCE")
        print("-" * 40)
        
        depths = []
        times = []
        positions = []
        nps_values = []
        
        for decision in self.decisions:
            stats = decision.get('searchStats', {})
            if stats:
                depths.append(stats.get('maxDepthReached', 0))
                times.append(stats.get('timeSpentMs', 0))
                positions.append(stats.get('positionsEvaluated', 0))
                nps = stats.get('nodesPerSecond', 0)
                if nps > 0:
                    nps_values.append(nps)
        
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
                'max': max(times)
            },
            'positions': {
                'mean': statistics.mean(positions),
                'total': sum(positions)
            }
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
        
        print(f"\nPositions Evaluated:")
        print(f"  Mean per Move: {results['positions']['mean']:.0f}")
        print(f"  Total: {results['positions']['total']}")
        
        if 'nps' in results:
            print(f"\nNodes per Second:")
            print(f"  Mean: {results['nps']['mean']:.0f}")
        
        # Check for potential issues
        zero_time_count = sum(1 for t in times if t == 0)
        if zero_time_count > 0:
            pct = zero_time_count / len(times) * 100
            print(f"\n⚠️  {zero_time_count} decisions ({pct:.1f}%) had 0ms search time")
            print("    This may indicate opening book moves not being integrated into search.")
        
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
            'integration_rate': book_integrated / max(1, book_found)
        }
        
        print(f"Book Lookup Attempts: {book_tried}")
        print(f"Book Moves Found: {book_found} ({results['hit_rate']:.1%} hit rate)")
        print(f"Moves Integrated into Search: {book_integrated}")
        
        if book_found > 0 and book_integrated < book_found:
            not_integrated = book_found - book_integrated
            print(f"\n⚠️  {not_integrated} book moves were NOT integrated into search")
            print("    These moves bypassed the normal evaluation process.")
        
        print()
        return results
    
    def _analyze_move_quality(self) -> Dict[str, Any]:
        """Analyze the quality of selected moves."""
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
            
            # Find rank of selected move
            selected_algebraic = selected_move.get('algebraic')
            for rank, move in enumerate(all_moves):
                if move.get('move', {}).get('algebraic') == selected_algebraic:
                    selected_ranks.append(rank)
                    
                    # Calculate score gap from best move
                    if rank > 0 and len(all_moves) > 0:
                        best_score = all_moves[0].get('score', 0)
                        selected_score = move.get('score', 0)
                        score_gaps.append(best_score - selected_score)
                    break
            
            # Track imperfections
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
            
            # Show distribution
            for rank in range(min(5, max(selected_ranks) + 1)):
                count = rank_dist.get(rank, 0)
                pct = count / len(selected_ranks) * 100
                bar = "█" * int(pct / 5)
                print(f"  Rank {rank}: {count:4d} ({pct:5.1f}%) {bar}")
        
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
        """Analyze how bot behavior changes over game phases."""
        print("-" * 40)
        print("TEMPORAL PATTERNS")
        print("-" * 40)
        
        # Group by move number ranges
        phases = {
            'opening': (1, 10),
            'early_middle': (11, 20),
            'late_middle': (21, 35),
            'endgame': (36, 100)
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
            print(f"\n  {phase.replace('_', ' ').title()}:")
            print(f"    Decisions: {stats['count']}")
            print(f"    Avg Depth: {stats['avg_depth']:.1f}")
            print(f"    Avg Time: {stats['avg_time']:.1f}ms")
        
        print()
        return results
    
    def generate_visualizations(self, output_dir: str):
        """Generate visualization charts."""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        # Heuristic contribution chart
        if 'heuristics' in self.analysis_results:
            self._plot_heuristic_contributions(output_path)
        
        # Search depth distribution
        self._plot_search_depths(output_path)
        
        print(f"Visualizations saved to {output_path}")
    
    def _plot_heuristic_contributions(self, output_path: Path):
        """Plot heuristic contribution chart."""
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
    
    def export_dataframe(self) -> Optional[pd.DataFrame]:
        """Export decision data as a pandas DataFrame for further analysis."""
        rows = []
        for decision in self.decisions:
            row = {
                'timestamp': decision.get('meta', {}).get('timestamp'),
                'bot_color': decision.get('meta', {}).get('botColor'),
                'difficulty': decision.get('meta', {}).get('difficulty'),
                'move_number': decision.get('meta', {}).get('moveNumber'),
                'fen': decision.get('meta', {}).get('fen'),
                'legal_moves': decision.get('moveAnalysis', {}).get('totalLegalMoves'),
                'depth_reached': decision.get('searchStats', {}).get('maxDepthReached'),
                'time_ms': decision.get('searchStats', {}).get('timeSpentMs'),
                'positions_evaluated': decision.get('searchStats', {}).get('positionsEvaluated'),
                'book_found': decision.get('openingBook', {}).get('found'),
                'book_integrated': decision.get('openingBook', {}).get('integratedIntoSearch'),
                'selected_score': decision.get('decision', {}).get('selectedScore'),
                'imperfection_type': decision.get('decision', {}).get('imperfection', {}).get('type')
            }
            
            # Add heuristic breakdowns from top move
            all_moves = decision.get('moveAnalysis', {}).get('allMoves', [])
            if all_moves:
                breakdown = all_moves[0].get('breakdown', {})
                for heuristic, value in breakdown.items():
                    row[f'h_{heuristic}'] = value
            
            rows.append(row)
        
        return pd.DataFrame(rows)


def main():
    parser = argparse.ArgumentParser(
        description='Analyze bot decision JSON reports',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python analyze_decisions.py game_decisions.json
  python analyze_decisions.py game_decisions.json --output ./analysis
  python analyze_decisions.py game_decisions.json --visualize
        """
    )
    parser.add_argument('input', help='Input JSON file with decision reports')
    parser.add_argument('--output', '-o', help='Output directory for reports', default='./analysis')
    parser.add_argument('--visualize', '-v', action='store_true', help='Generate visualization charts')
    parser.add_argument('--csv', action='store_true', help='Export data as CSV (requires pandas)')
    
    args = parser.parse_args()
    
    # Load decision data
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}")
        sys.exit(1)
    
    print(f"Loading decisions from: {input_path}")
    
    with open(input_path, 'r') as f:
        data = json.load(f)
    
    # Handle both single decision and array of decisions
    if isinstance(data, dict):
        decisions = [data]
    else:
        decisions = data
    
    print(f"Loaded {len(decisions)} decision(s)")
    print()
    
    # Run analysis
    analyzer = BotDecisionAnalyzer(decisions)
    results = analyzer.run_full_analysis()
    
    # Create output directory
    output_path = Path(args.output)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Save JSON results
    results_file = output_path / 'analysis_results.json'
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"Results saved to: {results_file}")
    
    # Generate visualizations
    if args.visualize:
        analyzer.generate_visualizations(output_path)
    
    # Export CSV
    if args.csv:
        df = analyzer.export_dataframe()
        if df is not None:
            csv_file = output_path / 'decisions_data.csv'
            df.to_csv(csv_file, index=False)
            print(f"CSV exported to: {csv_file}")
    
    print("\nAnalysis complete!")


if __name__ == '__main__':
    main()
