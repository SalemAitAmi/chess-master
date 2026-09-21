#!/usr/bin/env python3
"""
Chess-oriented statistical analysis of engine NDJSON logs.

    python tools/analyze_logs.py engine/logs                       # newest session
    python tools/analyze_logs.py engine/logs/<session> -o out
    python tools/analyze_logs.py <session> --blunder-cp 250 --blunder-wp 0.20

Input (see engine/src/logging/logger.js):

    <session>/instances.ndjson      engine instance -> profile + resolved config
    <session>/boot/*.ndjson         pre-game records (ignored by turn analysis)
    <session>/game-N/*.ndjson       per-game records, all engine instances

Every record carries `seq` (operation order within the game, across all files
and all engines), `t` (half-move index), `eng` (engine instance id), and an
event label: `msg`, or `cmd` in uci.ndjson.

POLICY
  * Mate scores (|cp| > MATE_THRESHOLD) are EXCLUDED from every statistic and
    every figure. They are counted separately. A mate is worth 50000cp; the
    heuristics this pipeline exists to study move the needle by 10-80cp.
  * Quality is measured in win probability, not centipawns: bounded, so one
    tactical spike cannot dominate a mean.
  * Blunder thresholds are CONVENTIONS passed on the command line, not
    discovered breakpoints. The full loss distribution is always reported
    alongside the thresholded rate.

This script organises data and annotates how to read it. It draws no
conclusions about any particular run.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

MATE_THRESHOLD = 49000
CATEGORIES = ["search", "eval", "order", "tt", "uci", "book",
              "heuristics", "moves", "pv", "time", "stage"]
PIECE_GROUP = {"Q": "heavy", "R": "heavy", "B": "minor", "N": "minor",
               "P": "pawn", "K": "king"}
STAGE_ORDER = ["opening", "early_middle", "middle", "late_middle", "endgame"]


# ══════════════════════════════════════════════════════════════════════════
# Annotations — rendered into report.md beside each artefact.
# ══════════════════════════════════════════════════════════════════════════
NOTES = {
 # ── figures ──
 "score_trajectory.png":
  "Search score over the game, white POV, mate scores removed. Read the SHAPE, "
  "not the level: a staircase means material is changing; a flat line near zero "
  "across many plies means the evaluation has stopped distinguishing positions. "
  "Sudden vertical jumps that are not followed by a matching material step are "
  "search instability, not a real swing — cross-check the same turn in "
  "pv_divergence.png. The shaded band is the inter-quartile range across games; "
  "a band that collapses to a line means every game is following the same script.",
 "score_volatility.png":
  "Left: per-move change in score. A symmetric, tight distribution is a stable "
  "evaluation; heavy symmetric tails mean the two sides disagree about the same "
  "position (each refutes the other's optimism). An ASYMMETRIC distribution is "
  "the interesting failure: it means one side systematically over- or "
  "under-estimates. Right: lag autocorrelation. Values near zero mean each "
  "move's error is independent (noise); strongly negative lag-1 means the score "
  "oscillates every ply, which is the signature of a tempo/parity term leaking "
  "into the leaf evaluation.",
 "wp_loss.png":
  "Self-reported win-probability loss per move: how much the engine's own "
  "assessment fell two plies later, measured in win probability so it is "
  "bounded and comparable across positions. This is not ground truth; it is "
  "internal consistency. The bulk should sit near zero with a thin right tail. "
  "A fat right tail means the search is regularly surprised by its own "
  "continuation — shorten the horizon hypothesis by checking whether the same "
  "turns appear in the anomaly table with high `rootChanges`.",
 "blunder_rate_by_depth.png":
  "Fraction of moves exceeding the loss threshold, binned by completed depth. "
  "n is printed on every bar — ignore bars with small n. The expected shape is "
  "monotonically decreasing. A FLAT profile means depth is not buying accuracy "
  "(ordering or pruning problem, not a depth problem). An INCREASING profile at "
  "high depth means deep searches are reached only in sharp positions, i.e. the "
  "depth variable is confounded with position difficulty — check against the "
  "stage breakdown before reading anything into it.",
 "effort_vs_quality.png":
  "Nodes searched (log) against win-probability loss, as a density. The red "
  "line is the median loss per node-decile. A flat median means extra effort is "
  "not buying quality in this regime. Points in the upper-right — maximum "
  "effort, maximum loss — are the most valuable anomalies: the engine worked "
  "hard and still got it wrong. Those turns are listed in the anomaly table.",
 "pv_divergence.png":
  "Per turn: bars are how many times the root best move changed during "
  "iterative deepening; the line is discovery latency, the fraction of total "
  "search time that had already elapsed when the final move last became best. "
  "Latency near 0 means the move was found immediately and the rest of the "
  "search was confirmation; near 1 means it was found at the buzzer and a "
  "slightly shorter search would have played something else. Clusters of high "
  "bars AND high latency mark positions where the result is time-dependent — "
  "these are the turns that will become non-deterministic under SMP.",
 "discovery_latency.png":
  "Distribution of discovery latency by completed depth. A healthy profile is "
  "concentrated low with a tail. If the mass shifts right as depth increases, "
  "the last iteration is routinely overturning the previous one, which means "
  "the iteration-to-iteration score is not converging and aspiration windows "
  "are probably thrashing (cross-check aspLow/aspHigh in the search tables).",
 "ordering_quality.png":
  "Top: first-move cutoff rate — the fraction of beta cutoffs achieved by the "
  "FIRST move tried. This is the single best health metric for move ordering; "
  "strong engines sit high and stable. Bottom: the rank, in the initial root "
  "ordering, of the move eventually chosen. Rank 0 means ordering already knew "
  "the answer. A heavy tail means the root ordering heuristics are mis-ranking "
  "the positions where it matters. Watch for divergence BETWEEN engines here: "
  "that is a direct readout of the config difference.",
 "tt_health.png":
  "Aggregated across games (median line, IQR band) rather than one line per "
  "game, which was unreadable. Left axis: hit rate. Right axis: mean AGE of the "
  "entries that hit, in search generations. Age climbing while hit rate holds "
  "means the table is serving mostly stale entries — useful, but a sign the "
  "replacement policy is favouring depth over freshness. Age near zero with a "
  "low hit rate means the table is being thrashed and should be larger.",
 "tt_age_vs_quality.png":
  "Win-probability loss grouped by mean TT hit age. If loss rises with age, "
  "stale cached valuations are actively steering moves — the mechanism behind "
  "'cached principal valuations force identical lines'. If it is flat, age is "
  "harmless and the table can be left alone. Bin counts are printed; disregard "
  "bins with few samples.",
 "pruning_mix.png":
  "One panel per pruning/reduction mechanism, rolling median of events per 1000 "
  "nodes, one line per engine. Separated into panels because the rates differ "
  "by two orders of magnitude and shared axes smudged everything below t=150. "
  "Look for: a mechanism whose rate collapses at a particular game stage "
  "(it has stopped contributing), and differences between engines that do not "
  "correspond to a config difference (that is a bug, not a setting).",
 "eval_components.png":
  "One panel per evaluation term, each with its OWN axis — a shared axis is "
  "useless here because material spans +-1000 while every other term spans "
  "+-100. Read each panel for spread and skew, not for level. A term whose "
  "distribution is a spike at zero is not contributing and can be removed or "
  "re-weighted. A term that is always the same sign is a constant offset, not "
  "an evaluation.",
 "component_corr_by_stage.png":
  "Spearman correlation between evaluation terms and the total, one matrix per "
  "game stage. Material dominating the total column is expected. The useful "
  "reading is the OFF-DIAGONAL: two terms correlated above ~0.7 are measuring "
  "the same thing twice and are double-counted in the total. Also compare a "
  "term's correlation with the total ACROSS stages — a term that only "
  "correlates in the opening is a development term regardless of its name.",
 "capture_cadence.png":
  "Left: distribution of the gap, in plies, between consecutive captures. A "
  "sharp mode at small gaps is a liquidation pattern (captures arriving in "
  "bursts, i.e. forced sequences resolving). A long flat tail is a manoeuvring "
  "game. Right: which pieces are being captured, by group, per engine. Compare "
  "the heavy-piece bars between engines — this is the most direct measurement "
  "of a trade bias that a log can produce.",
 "material_timeline.png":
  "Material balance with captures marked. Legend labels every game. Staircases "
  "that descend and re-ascend in lockstep are mutual liqu1idation (both sides "
  "trading back immediately); a staircase on one side only is real material "
  "gain. Compare the horizontal distance between paired steps: paired steps "
  "one or two plies apart are recaptures, paired steps ten plies apart mean the "
  "engine accepted material loss and won it back elsewhere.",
 "shuffle_map.png":
  "Detected move repetition: a move whose from/to is the exact reverse of the "
  "same engine's move two of its own turns earlier. Dense vertical runs are "
  "shuffling — the engine has no plan and is burning the 50-move clock. Check "
  "whether the score is flat through the run (no plan) or oscillating (the "
  "engine thinks the two positions differ, which points at a parity bug).",
 "anomaly_map.png":
  "Composite robust z-score per turn across effort, instability, quality loss, "
  "decision margin and ordering rank. Scale is MAD-based, so it is insensitive "
  "to the long tails that defeat standard deviations. Height is not severity in "
  "any absolute sense; it is distance from this run's own typical behaviour. "
  "Labelled points are in the anomaly table with their FEN.",
 # ── tables ──
 "engine_profiles":
  "The config actually in force for each engine instance, with its hash. Every "
  "other table is grouped by `eng`; this is where you find out what `eng` means. "
  "Two rows with the same configHash are the same engine and must not be "
  "compared as if they were different.",
 "move_quality_by_engine":
  "Primary comparison table. Read median win-probability loss first (robust), "
  "then the blunder rate (threshold-dependent, see the header), then ordering "
  "quality. Differences smaller than the bootstrap spread of a single game are "
  "not differences; check n before concluding anything.",
 "blunder_by_depth / blunder_by_stage":
  "Rates with the n of each cell. The stage view is usually more informative "
  "than the depth view, because depth is confounded with position sharpness.",
 "ordering_by_engine":
  "First-move cutoff rate, rank-0 rate and the rank distribution. These are the "
  "cheapest-to-improve numbers in the engine: a low first-move cutoff rate "
  "multiplies the cost of every other feature.",
 "tt_by_age_bucket":
  "Hit rate and quality conditioned on table age. Used together with "
  "tt_age_vs_quality.png.",
 "capture_profile":
  "Capture counts by piece group and the inter-capture gap distribution, per "
  "engine. The heavy-piece row is the trade-behaviour readout.",
 "stage_profile":
  "Effort, depth, branching and quality per game stage, per engine. The "
  "endgame row is where shuffling and 50-move draws show up as high n, low "
  "effort and near-zero score movement.",
 "search_stability":
  "Root changes, discovery latency, aspiration re-searches and decision margin. "
  "High values across all four at once identify positions whose result depends "
  "on the time control — exactly the turns that will diverge under SMP.",
 "anomalies":
  "Top turns by composite robust z-score, with FEN, chosen move, PV and the "
  "contributing signals. Paste the FEN into a board to review the move. The "
  "`signals` column names which components drove the score.",
 "mate_summary":
  "Mate scores seen, excluded everywhere else. If this count is large relative "
  "to the number of turns, the cp-based statistics are describing a small "
  "subset of the game and should be read with that in mind.",
}

# ══════════════════════════════════════════════════════════════════════════
# Glossary — rendered as the last section of report.md and as glossary.md.
#
# Two kinds of entry:
#   LOG KEY      a field the engine writes (engine/src/search/search.py's
#                `turn` / `iteration` records, eval leaves, TT stats)
#   DERIVED      computed by this script in build_turns / aggregate
# Every derived entry states its FORMULA, because the number is meaningless
# without it (wp_loss in particular is self-reported, not ground truth).
# ══════════════════════════════════════════════════════════════════════════
GLOSSARY = {
 # ── record identity ──
 "seq":      ("LOG KEY", "Monotonic operation counter within a game, shared by every "
                         "file and every engine instance. Sorting a game by `seq` "
                         "replays the exact interleaving of UCI, ordering, search and eval."),
 "t":        ("LOG KEY", "Half-move (ply) index of the POSITION: (fullmove-1)*2 + (black to move). "
                         "Frozen at the root for the duration of a search, so every line "
                         "emitted anywhere in the tree is attributed to the turn being decided."),
 "eng":      ("LOG KEY", "Engine instance id. One instance = one socket = one config set = "
                         "one transposition table. Resolve it via instances.ndjson."),
 "game":     ("DERIVED", "Index parsed from the game-N directory name."),
 "label":    ("DERIVED", "Event name: the `msg` field, or `cmd` in uci.ndjson."),

 # ── turn record: choice ──
 "best":     ("LOG KEY", "Move actually played, UCI."),
 "cp":       ("LOG KEY", "Score of the played move, centipawns, MOVER's point of view."),
 "mate":     ("LOG KEY", "Distance to mate in moves when |cp| > 49000, else null."),
 "bestCp":   ("LOG KEY", "Score of the highest-scoring root move after verification."),
 "secondCp": ("LOG KEY", "Score of the runner-up root move."),
 "margin":   ("LOG KEY", "bestCp - secondCp. Small = the decision was close; a close "
                         "decision is a decision that can flip under SMP or a different time control."),
 "qual":     ("LOG KEY", "cp - bestCp. Non-zero only when a root-policy override fired "
                         "(repetition avoidance or the EXACT-tie tension tie-break)."),
 "bestRank": ("LOG KEY", "0-based rank of the played move in the final root score ordering."),
 "rootN":    ("LOG KEY", "Legal root moves."),
 "rootCaps": ("LOG KEY", "Captures among the root moves."),
 "fen":      ("LOG KEY", "Root FEN. Paste into a board to review the decision."),
 "stage":    ("LOG KEY", "Game stage from utils/gameStage.js (opening … endgame)."),
 "bal":      ("LOG KEY", "Material balance in cp, WHITE's point of view, pieces only."),
 "phase":    ("LOG KEY", "Material phase 0-100. 100 = full middlegame material."),
 "cap":      ("LOG KEY", "Piece captured by the played move (K/Q/R/B/N/P), else null."),
 "capSee":   ("LOG KEY", "SEE of the played move. >0 wins material, ~0 even, <0 loses."),
 "promo":    ("LOG KEY", "1 when the played move promotes."),

 # ── turn record: effort ──
 "depth":    ("LOG KEY", "Last COMPLETED iterative-deepening depth."),
 "seldepth": ("LOG KEY", "Deepest ply reached anywhere, including quiescence."),
 "nodes":    ("LOG KEY", "Total nodes searched this turn."),
 "qnodes":   ("LOG KEY", "Quiescence entry nodes."),
 "ms":       ("LOG KEY", "Wall-clock ms for the whole turn."),
 "staticCp": ("LOG KEY", "Static evaluation of the root, before any search."),

 # ── turn record: stability ──
 "firstSeenMs":    ("LOG KEY", "ms elapsed when the FINAL move last became root-best."),
 "firstSeenDepth": ("LOG KEY", "Depth at which the final move last became root-best."),
 "rootChanges":    ("LOG KEY", "Times the root best move changed across iterations."),
 "pv":             ("LOG KEY", "Principal variation, space-separated UCI."),
 "pvLen":          ("LOG KEY", "PV length in plies."),
 "aspLow":         ("LOG KEY", "Aspiration-window fail-lows (re-searches with a lower alpha)."),
 "aspHigh":        ("LOG KEY", "Aspiration-window fail-highs."),
 "rootVerified":   ("LOG KEY", "Root moves re-searched with an open window to get an EXACT score."),
 "repetitionAvoided": ("LOG KEY", "Times the best move was rejected because it walked into a threefold."),

 # ── turn record: ordering / pruning / TT ──
 "cutoffs":         ("LOG KEY", "Beta cutoffs this turn."),
 "firstMoveCutoffs":("LOG KEY", "Cutoffs achieved by the FIRST move tried at a node."),
 "ttHit":           ("LOG KEY", "Transposition table hits (entry found AND deep enough)."),
 "ttCut":           ("LOG KEY", "TT hits whose stored bound allowed an immediate return."),
 "ttAgeAvg":        ("LOG KEY", "Mean age, in search generations, of the entries that hit."),
 "ttDepthAvg":      ("LOG KEY", "Mean stored depth of the entries that hit."),
 "ttFill":          ("LOG KEY", "Table occupancy in permille, sampled."),
 "nullMoveCutoffs": ("LOG KEY", "Null-move pruning cutoffs."),
 "futilityCutoffs": ("LOG KEY", "Moves skipped by futility pruning."),
 "seePrunes":       ("LOG KEY", "Captures skipped by SEE pruning."),
 "lmrSearches":     ("LOG KEY", "Moves searched at reduced depth (late move reduction)."),
 "lmrResearches":   ("LOG KEY", "Reduced searches that beat alpha and had to be redone at full depth."),
 "pvsResearches":   ("LOG KEY", "Null-window PVS probes that had to be re-searched."),

 # ── iteration record ──
 "d":        ("LOG KEY", "Iteration depth (search.ndjson label=iteration)."),
 "changed":  ("LOG KEY", "1 when this iteration changed the root best move."),

 # ── eval leaf record ──
 "s":        ("LOG KEY", "Total leaf evaluation, cp, mover's point of view."),
 "ph":       ("LOG KEY", "Game phase at the leaf, 0 (endgame) … 1 (middlegame)."),
 "material": ("LOG KEY", "Material + piece-square-table term."),
 "centerControl": ("LOG KEY", "Center-control term."),
 "development":   ("LOG KEY", "Development term (opening only)."),
 "pawnStructure": ("LOG KEY", "Doubled / isolated / backward / connected / passed / islands."),
 "kingSafety":    ("LOG KEY", "Pawn shield and open files near the king, scaled by enemy heavy pressure."),
 "initiative":    ("LOG KEY", "King-zone attack potential, queen asymmetry, tempo."),
 "mopUp":         ("LOG KEY", "Corral term; non-zero only with a lone enemy king."),

 # ── derived metrics ──
 "wp_mover":  ("DERIVED", "Win probability of the mover: 1/(1+10^(-cp/400))."),
 "cp_eff":    ("DERIVED", "cp with mate scores (|cp| > 49000) set to NaN, so they are "
                          "excluded from every statistic rather than dominating it."),
 "cp_white":  ("DERIVED", "cp_eff re-signed to WHITE's point of view."),
 "cp_next_own": ("DERIVED", "This engine's own cp two of ITS plies later (shift(-2) within game+eng)."),
 "eval_drop": ("DERIVED", "cp_eff - cp_next_own. Centipawn version of self-reported loss."),
 "wp_loss":   ("DERIVED", "max(0, wp_mover - wp(cp_next_own)). SELF-REPORTED quality: how far "
                          "the engine's own assessment fell two of its own plies later. "
                          "Bounded, so one tactical spike cannot dominate a mean. NOT strength "
                          "against an oracle — it measures internal consistency."),
 "blunder_wp":("DERIVED", "wp_loss >= --blunder-wp. A CONVENTION, not a discovered breakpoint."),
 "blunder_cp":("DERIVED", "eval_drop >= --blunder-cp. Same caveat."),
 "nps":       ("DERIVED", "nodes / ms * 1000."),
 "qnode_share": ("DERIVED", "qnodes / nodes. High = the position is tactically unresolved at the horizon."),
 "ebf":       ("DERIVED", "Effective branching factor: nodes ** (1/depth). Lower is better ordering."),
 "fmc_rate":  ("DERIVED", "firstMoveCutoffs / cutoffs. The single best move-ordering health metric."),
 "rank0":     ("DERIVED", "1 when bestRank == 0, i.e. root ordering already knew the answer."),
 "latency":   ("DERIVED", "firstSeenMs / ms, clipped to [0,1]. Discovery latency: ~0 means the move "
                          "was found immediately and the rest of the search was confirmation; ~1 means "
                          "it was found at the buzzer and a shorter search would have played something else."),
 "search_minus_static": ("DERIVED", "cp_eff - staticCp. How much the search disagreed with the static eval."),
 "capture_gap": ("DERIVED", "Plies since the previous capture in the same game."),
 "cap_group":   ("DERIVED", "Captured piece grouped as heavy (Q,R) / minor (B,N) / pawn / king."),
 "shuffle":     ("DERIVED", "True when a move exactly reverses the SAME engine's move two of its own "
                            "turns earlier. Dense runs = no plan, burning the 50-move clock."),
 "anomaly_score": ("DERIVED", "Sum of MAD-scaled robust z-scores over quality, effort, time, instability, "
                              "latency, closeness, misordering, override and divergence, +3 for a shuffle. "
                              "Distance from THIS RUN's typical behaviour — not absolute severity."),
 "_pk suffix":  ("DERIVED", "Event rate per 1000 nodes, e.g. futilityCutoffs_pk. Normalises a raw "
                            "count so two engines with different node budgets are comparable."),
}

# ══════════════════════════════════════════════════════════════════════════
# Replay export
#
# Per-game, per-turn records in the order they were DECIDED, shaped for a
# navigable client. Deliberately one file per game plus an index: a replay UI
# loads one game at a time, and the per-turn `iterations` array is what a
# debugger-style stepper needs (score and best move after each depth, so the
# user can scrub the search as well as the game).
#
# `seq` is carried on every record so a future UI can cross-reference the raw
# NDJSON (ordering snapshots, eval leaves) for the same decision without
# re-deriving anything.
# ══════════════════════════════════════════════════════════════════════════
REPLAY_TURN_FIELDS = [
    "t", "seq", "eng", "color", "stage", "fen", "best", "cp", "mate", "bestCp",
    "secondCp", "margin", "qual", "bestRank", "rootN", "rootCaps", "depth",
    "seldepth", "nodes", "qnodes", "ms", "firstSeenMs", "firstSeenDepth",
    "rootChanges", "latency", "pv", "pvLen", "staticCp", "search_minus_static",
    "ttHit", "ttCut", "ttAgeAvg", "ttDepthAvg", "ttFill", "fmc_rate",
    "cap", "capSee", "promo", "bal", "phase", "wp_mover", "wp_loss",
    "eval_drop", "is_mate", "shuffle",
]


def export_replay(turns, iters, instances, out):
    """Write out/replay/index.json + out/replay/game-N.json."""
    if turns.empty:
        return []
    rdir = out / "replay"
    rdir.mkdir(parents=True, exist_ok=True)

    engines = {}
    if not instances.empty and "eng" in instances.columns:
        for _, r in instances.drop_duplicates("eng").iterrows():
            engines[r["eng"]] = {
                k: (None if pd.isna(r.get(k)) else r.get(k))
                for k in ("profile", "label", "configHash", "description", "tt")
                if k in instances.columns
            }

    index = []
    for game, sub in turns.groupby("game"):
        sub = sub.sort_values("seq")
        cols = [c for c in REPLAY_TURN_FIELDS if c in sub.columns]
        records = json.loads(sub[cols].to_json(orient="records"))

        # Attach the iteration trace so a replay UI can scrub the SEARCH too,
        # not just the game.
        if not iters.empty:
            itg = iters[iters["game"] == game]
            by_turn = {}
            for (eng, t), isub in itg.groupby(["eng", "t"]):
                by_turn[(eng, t)] = json.loads(
                    isub.sort_values("d")[[c for c in ("d", "cp", "changed", "nodes",
                                                       "qnodes", "ms", "seldepth")
                                           if c in isub.columns]].to_json(orient="records"))
            for rec in records:
                rec["iterations"] = by_turn.get((rec.get("eng"), rec.get("t")), [])

        payload = {
            "game": int(game),
            "engines": engines,
            "turns": records,
            "turnCount": len(records),
        }
        name = f"game-{int(game)}.json"
        (rdir / name).write_text(json.dumps(payload), encoding="utf-8")
        index.append({"game": int(game), "file": f"replay/{name}",
                      "turns": len(records),
                      "engines": sorted(sub["eng"].dropna().unique().tolist())})

    (rdir / "index.json").write_text(
        json.dumps({"games": index, "engines": engines}, indent=2), encoding="utf-8")
    return index

# ══════════════════════════════════════════════════════════════════════════
# Loading
# ══════════════════════════════════════════════════════════════════════════
def read_ndjson(path: Path) -> pd.DataFrame:
    rows, bad = [], 0
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                bad += 1
    if bad:
        print(f"  [{path.name}] skipped {bad} malformed line(s)", file=sys.stderr)
    return pd.DataFrame(rows)


def newest_session(root: Path) -> Path:
    cands = [p for p in root.iterdir() if p.is_dir() and
             (any(p.glob("game-*")) or (p / "boot").exists())]
    if not cands:
        raise SystemExit(f"no session directories under {root}")
    return max(cands, key=lambda p: p.name)


def load_session(session: Path):
    games = sorted((p for p in session.glob("game-*") if p.is_dir()),
                   key=lambda p: int(p.name.split("-")[1]))
    if not games:
        raise SystemExit(f"no game-* directories in {session}")

    frames = {c: [] for c in CATEGORIES}
    for g in games:
        idx = int(g.name.split("-")[1])
        for cat in CATEGORIES:
            f = g / f"{cat}.ndjson"
            if not f.exists():
                continue
            df = read_ndjson(f)
            if df.empty:
                continue
            label = "cmd" if "cmd" in df.columns else "msg"
            df = df.rename(columns={label: "label"})
            df.insert(0, "game", idx)
            if "eng" not in df.columns:
                df["eng"] = "e0"
            frames[cat].append(df)

    merged = {c: pd.concat(v, ignore_index=True, sort=False)
              for c, v in frames.items() if v}

    inst_path = session / "instances.ndjson"
    instances = read_ndjson(inst_path) if inst_path.exists() else pd.DataFrame()
    return merged, instances


# ══════════════════════════════════════════════════════════════════════════
# Derivation
# ══════════════════════════════════════════════════════════════════════════
def numeric(df, cols):
    for c in cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def win_prob(cp):
    """Standard logistic centipawn -> win probability. Bounded, so a single
    tactical spike cannot dominate an average the way raw cp does."""
    return 1.0 / (1.0 + np.power(10.0, -np.asarray(cp, dtype=float) / 400.0))


TURN_NUM = ["t", "seq", "cp", "bestCp", "secondCp", "margin", "qual", "bestRank",
            "rootN", "rootCaps", "depth", "seldepth", "nodes", "qnodes", "ms",
            "firstSeenMs", "firstSeenDepth", "rootChanges", "pvLen", "staticCp",
            "ttHit", "ttCut", "ttAgeAvg", "ttDepthAvg", "ttFill", "capSee",
            "promo", "bal", "phase", "mate", "cutoffs", "firstMoveCutoffs",
            "aspLow", "aspHigh", "ttHits", "ttCutoffs", "nullMoveCutoffs",
            "futilityCutoffs", "lmrSearches", "lmrResearches", "pvsResearches",
            "seePrunes", "repetitionAvoided", "rootVerified"]


def build_turns(search):
    if search is None or search.empty:
        return pd.DataFrame()
    t = search[search["label"] == "turn"].copy()
    if t.empty:
        return t
    t = t[t["t"] >= 0]
    t = numeric(t, TURN_NUM)

    # ── Mate handling: excluded from every statistic, counted separately. ──
    t["is_mate"] = t["cp"].abs() > MATE_THRESHOLD
    t["cp_eff"] = t["cp"].where(~t["is_mate"])
    t["cp_white"] = np.where(t["color"].eq("white"), t["cp_eff"], -t["cp_eff"])
    t["wp_mover"] = win_prob(t["cp_eff"])

    # Effort
    t["nps"] = t["nodes"] / t["ms"].replace(0, np.nan) * 1000.0
    t["qnode_share"] = t["qnodes"] / t["nodes"].replace(0, np.nan)
    t["ebf"] = np.where(t["depth"] > 0, t["nodes"] ** (1.0 / t["depth"].clip(lower=1)), np.nan)

    # Ordering / stability / discovery
    t["fmc_rate"] = t["firstMoveCutoffs"] / t["cutoffs"].replace(0, np.nan)
    t["latency"] = (t["firstSeenMs"] / t["ms"].replace(0, np.nan)).clip(0, 1)
    t["rank0"] = (t["bestRank"] == 0).astype(float)
    t["search_minus_static"] = t["cp_eff"] - t["staticCp"]

    for c in ("futilityCutoffs", "nullMoveCutoffs", "seePrunes",
              "lmrSearches", "lmrResearches", "ttCutoffs"):
        if c in t.columns:
            t[f"{c}_pk"] = t[c] / t["nodes"].replace(0, np.nan) * 1000.0

    t = t.sort_values(["game", "t"]).reset_index(drop=True)

    # ── Quality: the engine's OWN score two of its own plies later, same POV.
    #    Self-consistency, not ground truth — see the note in report.md. ──
    g = t.groupby(["game", "eng"])
    t["cp_next_own"] = g["cp_eff"].shift(-2)
    t["eval_drop"] = t["cp_eff"] - t["cp_next_own"]
    t["wp_loss"] = (t["wp_mover"] - win_prob(t["cp_next_own"])).clip(lower=0)

    # ── Capture cadence ──
    t["is_capture"] = t["cap"].notna() if "cap" in t.columns else False
    t["cap_group"] = t["cap"].map(PIECE_GROUP) if "cap" in t.columns else None
    gap = []
    for _, sub in t.groupby("game"):
        last = None
        for tt_, iscap in zip(sub["t"], sub["is_capture"]):
            gap.append(np.nan if (not iscap or last is None) else tt_ - last)
            if iscap:
                last = tt_
    t["capture_gap"] = gap

    # ── Shuffle detection: this engine's move reverses its own move 2 turns ago
    t["shuffle"] = False
    for (gm, eng), sub in t.groupby(["game", "eng"]):
        mv = sub["best"].fillna("")
        prev = mv.shift(1)
        rev = prev.str[2:4] + prev.str[0:2]
        t.loc[sub.index, "shuffle"] = (mv.str[:4] == rev) & (mv.str.len() >= 4)

    return t


def build_iterations(search):
    if search is None or search.empty:
        return pd.DataFrame()
    it = search[search["label"] == "iteration"].copy()
    if it.empty:
        return it
    it = numeric(it, ["t", "seq", "d", "cp", "nodes", "qnodes", "ms", "changed", "seldepth"])
    it["is_mate"] = it["cp"].abs() > MATE_THRESHOLD
    it["cp_eff"] = it["cp"].where(~it["is_mate"])
    it = it.sort_values(["game", "eng", "t", "d"])
    grp = it.groupby(["game", "eng", "t"])
    it["nodes_step"] = grp["nodes"].diff().fillna(it["nodes"])
    it["growth"] = grp["nodes"].transform(lambda s: s / s.shift())
    it["cp_step"] = grp["cp_eff"].diff()
    return it


def build_leaf(ev, turns):
    if ev is None or ev.empty:
        return pd.DataFrame()
    leaf = ev[ev["label"] == "leaf"].copy()
    if leaf.empty:
        return leaf
    leaf = leaf[leaf["t"] >= 0]
    comps = [c for c in ("material", "centerControl", "development", "pawnStructure",
                         "kingSafety", "initiative", "mopUp") if c in leaf.columns]
    leaf = numeric(leaf, ["t", "seq", "s", "ph"] + comps)
    leaf = leaf[leaf["s"].abs() <= MATE_THRESHOLD]
    # Stage comes from the turn record; join on (game, t).
    if not turns.empty and "stage" in turns.columns:
        key = turns[["game", "t", "stage"]].drop_duplicates(["game", "t"])
        leaf = leaf.merge(key, on=["game", "t"], how="left")
    leaf.attrs["components"] = comps
    return leaf


# ══════════════════════════════════════════════════════════════════════════
# Chess-oriented aggregates
# ══════════════════════════════════════════════════════════════════════════
def robust_z(s):
    s = pd.to_numeric(s, errors="coerce")
    med = s.median()
    mad = (s - med).abs().median()
    scale = 1.4826 * mad if mad and mad > 0 else (s.std() or 1.0)
    return (s - med) / scale


def rate_table(df, by, flag, extra=None):
    agg = {"n": (flag, "size"), "rate": (flag, "mean")}
    if extra:
        agg.update(extra)
    return df.groupby(by, observed=False).agg(**agg)


def aggregate(turns, iters, leaf, instances, args):
    out = {}

    if not instances.empty:
        cols = [c for c in ("eng", "profile", "label", "configHash", "description")
                if c in instances.columns]
        out["engine_profiles"] = instances[cols].drop_duplicates("eng").set_index("eng")

    if turns.empty:
        return out

    t = turns
    out["mate_summary"] = pd.DataFrame([{
        "turns_total": len(t),
        "mate_scores": int(t["is_mate"].sum()),
        "mate_fraction": float(t["is_mate"].mean()),
        "games": int(t["game"].nunique()),
        "engines": int(t["eng"].nunique()),
    }])

    t = t.assign(
        blunder_cp=(t["eval_drop"] >= args.blunder_cp),
        blunder_wp=(t["wp_loss"] >= args.blunder_wp),
    )

    out["move_quality_by_engine"] = t.groupby("eng").agg(
        moves=("t", "size"),
        wp_loss_median=("wp_loss", "median"),
        wp_loss_p90=("wp_loss", lambda s: s.quantile(0.90)),
        eval_drop_median=("eval_drop", "median"),
        blunder_rate_cp=("blunder_cp", "mean"),
        blunder_rate_wp=("blunder_wp", "mean"),
        abs_cp_median=("cp_eff", lambda s: s.abs().median()),
        capture_share=("is_capture", "mean"),
        shuffle_share=("shuffle", "mean"),
        depth_median=("depth", "median"),
        nodes_median=("nodes", "median"),
        ms_median=("ms", "median"),
    )

    out["ordering_by_engine"] = t.groupby("eng").agg(
        fmc_rate_median=("fmc_rate", "median"),
        rank0_rate=("rank0", "mean"),
        rank_median=("bestRank", "median"),
        rank_p90=("bestRank", lambda s: s.quantile(0.90)),
        root_moves_median=("rootN", "median"),
        margin_median=("margin", "median"),
    )

    out["search_stability"] = t.groupby("eng").agg(
        root_changes_mean=("rootChanges", "mean"),
        root_changes_p90=("rootChanges", lambda s: s.quantile(0.90)),
        latency_median=("latency", "median"),
        latency_p90=("latency", lambda s: s.quantile(0.90)),
        asp_low_mean=("aspLow", "mean"),
        asp_high_mean=("aspHigh", "mean"),
        margin_p10=("margin", lambda s: s.quantile(0.10)),
        search_minus_static_median=("search_minus_static", "median"),
    )

    out["blunder_by_depth"] = rate_table(
        t, "depth", "blunder_wp",
        {"wp_loss_median": ("wp_loss", "median"), "nodes_median": ("nodes", "median")})
    if "stage" in t.columns:
        out["blunder_by_stage"] = rate_table(
            t, ["stage", "eng"], "blunder_wp",
            {"wp_loss_median": ("wp_loss", "median")})
        out["stage_profile"] = t.groupby(["stage", "eng"], observed=False).agg(
            moves=("t", "size"),
            depth_median=("depth", "median"),
            nodes_median=("nodes", "median"),
            ebf_median=("ebf", "median"),
            wp_loss_median=("wp_loss", "median"),
            abs_cp_median=("cp_eff", lambda s: s.abs().median()),
            capture_share=("is_capture", "mean"),
            qnode_share_median=("qnode_share", "median"),
        )

    # TT usefulness vs age — deciles of mean hit age, not fixed buckets.
    if t["ttAgeAvg"].notna().any():
        t2 = t.dropna(subset=["ttAgeAvg"]).copy()
        t2["age_bin"] = pd.qcut(t2["ttAgeAvg"], q=min(8, t2["ttAgeAvg"].nunique()),
                                duplicates="drop")
        out["tt_by_age_bucket"] = t2.groupby("age_bin", observed=False).agg(
            moves=("t", "size"),
            tt_hits_median=("ttHit", "median"),
            tt_cut_median=("ttCut", "median"),
            wp_loss_median=("wp_loss", "median"),
            rank0_rate=("rank0", "mean"),
            depth_median=("depth", "median"),
        )

    # Capture profile: the trade-behaviour readout.
    cap = t[t["is_capture"]]
    if not cap.empty:
        grp = cap.pivot_table(index="eng", columns="cap_group", values="t",
                              aggfunc="size", fill_value=0)
        gapstats = t.groupby("eng")["capture_gap"].agg(
            gap_median="median", gap_p90=lambda s: s.quantile(0.90),
            gap_max="max", captures="count")
        out["capture_profile"] = grp.join(gapstats, how="outer")

    # Per-stage heuristic correlation with the total.
    if not leaf.empty and "stage" in leaf.columns:
        comps = leaf.attrs.get("components", [])
        rows = []
        for stage, sub in leaf.groupby("stage", observed=False):
            if len(sub) < 30:
                continue
            c = sub[comps + ["s"]].corr(method="spearman")["s"].drop("s")
            rows.append(pd.Series(c, name=stage))
        if rows:
            out["component_corr_with_total_by_stage"] = pd.DataFrame(rows)

    if not iters.empty:
        out["iteration_growth_by_depth"] = iters.groupby("d").agg(
            n=("ms", "size"),
            ms_median=("ms", "median"),
            growth_median=("growth", "median"),
            changed_rate=("changed", "mean"),
        )

    out["anomalies"] = detect_anomalies(t, args)
    return out


def detect_anomalies(t, args):
    """
    Composite robust z-score over signals that each independently indicate
    'this decision did not behave like the others'. MAD-scaled, so the long
    tails that defeat standard deviations do not swallow the signal.
    """
    sig = pd.DataFrame(index=t.index)
    sig["quality"]   = robust_z(t["wp_loss"]).clip(lower=0)
    sig["effort"]    = robust_z(np.log1p(t["nodes"])).abs()
    sig["time"]      = robust_z(np.log1p(t["ms"])).clip(lower=0)
    sig["unstable"]  = robust_z(t["rootChanges"]).clip(lower=0)
    sig["late"]      = robust_z(t["latency"]).clip(lower=0)
    sig["close"]     = (-robust_z(t["margin"])).clip(lower=0)
    sig["misorder"]  = robust_z(t["bestRank"]).clip(lower=0)
    sig["override"]  = robust_z(-t["qual"].fillna(0)).clip(lower=0)
    sig["divergent"] = robust_z(t["search_minus_static"].abs()).clip(lower=0)
    sig["shuffle"]   = t["shuffle"].astype(float) * 3.0

    score = sig.fillna(0).sum(axis=1)
    names = sig.columns.to_numpy()

    def top_signals(i):
        row = sig.loc[i].fillna(0)
        idx = np.argsort(-row.to_numpy())[:3]
        return ",".join(f"{names[j]}={row.iloc[j]:.1f}" for j in idx if row.iloc[j] > 1)

    out = t.loc[score.sort_values(ascending=False).index[:args.top_anomalies],
                [c for c in ("game", "eng", "t", "seq", "stage", "best", "cap", "capSee",
                             "cp", "bestCp", "margin", "qual", "bestRank", "depth",
                             "nodes", "ms", "rootChanges", "latency", "wp_loss",
                             "eval_drop", "pv", "fen") if c in t.columns]].copy()
    out.insert(0, "anomaly_score", score.loc[out.index].round(2))
    out["signals"] = [top_signals(i) for i in out.index]
    return out.reset_index(drop=True)


# ══════════════════════════════════════════════════════════════════════════
# Figures
# ══════════════════════════════════════════════════════════════════════════
def rlim(series, lo=1, hi=99, pad=0.08):
    s = pd.to_numeric(series, errors="coerce").dropna()
    if s.empty:
        return None
    a, b = np.percentile(s, [lo, hi])
    if a == b:
        a, b = a - 1, b + 1
    m = (b - a) * pad
    return a - m, b + m


def save(fig, figdir, name):
    fig.tight_layout()
    fig.savefig(figdir / name, dpi=130)
    plt.close(fig)
    return name


def band_plot(ax, df, xcol, ycol, group, label_prefix=""):
    """Median + IQR band across `group`, plus thin per-group lines."""
    for key, sub in df.groupby(group):
        ax.plot(sub[xcol], sub[ycol], lw=0.5, alpha=0.22, color="0.5")
    piv = df.pivot_table(index=xcol, values=ycol, aggfunc=["median", lambda s: s.quantile(.25),
                                                           lambda s: s.quantile(.75)])
    piv.columns = ["med", "q25", "q75"]
    piv = piv.sort_index()
    ax.fill_between(piv.index, piv["q25"], piv["q75"], alpha=0.25, label=f"{label_prefix}IQR")
    ax.plot(piv.index, piv["med"], lw=1.6, label=f"{label_prefix}median")


def make_figures(turns, iters, leaf, figdir, args):
    figdir.mkdir(parents=True, exist_ok=True)
    names = []
    if turns.empty:
        return names
    t = turns
    engines = sorted(t["eng"].dropna().unique())

    # 1 ── score trajectory
    fig, ax = plt.subplots(figsize=(11, 4.4))
    band_plot(ax, t.dropna(subset=["cp_white"]), "t", "cp_white", "game")
    ax.axhline(0, color="k", lw=0.6)
    ax.set_ylim(*(rlim(t["cp_white"]) or (-500, 500)))
    ax.set_xlabel("half-move (t)"); ax.set_ylabel("score, cp (white POV)")
    ax.set_title("Search score trajectory (mate scores excluded)")
    ax.legend(loc="upper right", fontsize=8)
    names.append(save(fig, figdir, "score_trajectory.png"))

    # 2 ── volatility
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    d = t.groupby(["game", "eng"])["cp_eff"].diff().dropna()
    lim = rlim(d, 1, 99)
    axes[0].hist(d.clip(*lim) if lim else d, bins=60)
    axes[0].set_xlabel("Δ score vs previous turn, cp"); axes[0].set_ylabel("turns")
    axes[0].set_title("Score volatility (1–99 pct clipped)")
    lags = range(1, 13)
    for eng in engines:
        s = t[t["eng"] == eng]["cp_eff"].dropna()
        axes[1].plot(list(lags), [s.autocorr(l) for l in lags], marker="o", ms=3, label=eng)
    axes[1].axhline(0, color="k", lw=0.6)
    axes[1].set_xlabel("lag (turns)"); axes[1].set_ylabel("autocorrelation")
    axes[1].set_title("Score autocorrelation"); axes[1].legend(fontsize=8, title="engine")
    names.append(save(fig, figdir, "score_volatility.png"))

    # 3 ── win-probability loss
    fig, ax = plt.subplots(figsize=(8, 4.2))
    for eng in engines:
        s = t[t["eng"] == eng]["wp_loss"].dropna()
        ax.hist(s, bins=np.linspace(0, 1, 41), histtype="step", lw=1.6, label=f"{eng} (n={len(s)})")
    ax.set_yscale("log")
    ax.set_xlabel("self-reported win-probability loss"); ax.set_ylabel("moves (log)")
    ax.set_title("Move quality: win-probability loss")
    ax.legend(fontsize=8, title="engine")
    names.append(save(fig, figdir, "wp_loss.png"))

    # 4 ── blunder rate by depth
    by = t.groupby("depth").agg(n=("t", "size"),
                                rate=("wp_loss", lambda s: (s >= args.blunder_wp).mean()))
    by = by[by["n"] >= args.min_bin]
    if not by.empty:
        fig, ax = plt.subplots(figsize=(8, 4))
        bars = ax.bar(by.index.astype(int), by["rate"])
        for b, n in zip(bars, by["n"]):
            ax.text(b.get_x() + b.get_width() / 2, b.get_height(), f"n={int(n)}",
                    ha="center", va="bottom", fontsize=7)
        ax.set_xlabel("completed depth"); ax.set_ylabel(f"P(wp loss ≥ {args.blunder_wp})")
        ax.set_title("Blunder rate by depth")
        names.append(save(fig, figdir, "blunder_rate_by_depth.png"))

    # 5 ── effort vs quality
    m = t.dropna(subset=["nodes", "wp_loss"])
    if len(m) > 20:
        fig, ax = plt.subplots(figsize=(7.5, 5))
        hb = ax.hexbin(np.log10(m["nodes"].clip(lower=1)), m["wp_loss"],
                       gridsize=40, mincnt=1, bins="log", cmap="viridis")
        fig.colorbar(hb, ax=ax, label="log10 count")
        dec = pd.qcut(m["nodes"], 10, duplicates="drop")
        med = m.groupby(dec, observed=False).agg(x=("nodes", "median"), y=("wp_loss", "median"))
        ax.plot(np.log10(med["x"]), med["y"], "r-o", ms=4, lw=1.6, label="median per node-decile")
        ax.set_xlabel("log10 nodes"); ax.set_ylabel("win-probability loss")
        ax.set_title("Search effort vs move quality"); ax.legend(fontsize=8)
        names.append(save(fig, figdir, "effort_vs_quality.png"))

    # 6 ── PV divergence / discovery timeline
    sub = t[t["game"] == t["game"].min()]
    fig, ax = plt.subplots(figsize=(11, 4.2))
    ax.bar(sub["t"], sub["rootChanges"], width=0.8, alpha=0.6, label="root best-move changes")
    ax2 = ax.twinx()
    ax2.plot(sub["t"], sub["latency"], color="crimson", lw=1.2, label="discovery latency")
    ax2.set_ylim(0, 1.05); ax2.set_ylabel("first-seen ms / total ms")
    ax.set_xlabel("half-move (t)"); ax.set_ylabel("root changes")
    ax.set_title(f"PV instability and discovery latency (game {int(sub['game'].iloc[0])})")
    h1, l1 = ax.get_legend_handles_labels(); h2, l2 = ax2.get_legend_handles_labels()
    ax.legend(h1 + h2, l1 + l2, fontsize=8, loc="upper left")
    names.append(save(fig, figdir, "pv_divergence.png"))

    # 7 ── discovery latency by depth
    depths = sorted(t["depth"].dropna().unique())
    depths = [d for d in depths if (t["depth"] == d).sum() >= args.min_bin]
    if depths:
        fig, ax = plt.subplots(figsize=(9, 4))
        ax.violinplot([t.loc[t["depth"] == d, "latency"].dropna() for d in depths],
                      positions=range(len(depths)), showmedians=True)
        ax.set_xticks(range(len(depths))); ax.set_xticklabels([str(int(d)) for d in depths])
        ax.set_xlabel("completed depth"); ax.set_ylabel("discovery latency")
        ax.set_title("When the final move was found, by depth")
        names.append(save(fig, figdir, "discovery_latency.png"))

    # 8 ── ordering quality
    fig, axes = plt.subplots(2, 1, figsize=(11, 6), sharex=True)
    for eng in engines:
        s = t[t["eng"] == eng].sort_values("t")
        axes[0].plot(s["t"], s["fmc_rate"].rolling(9, min_periods=3).median(), lw=1.3, label=eng)
        axes[1].plot(s["t"], s["bestRank"].rolling(9, min_periods=3).median(), lw=1.3, label=eng)
    axes[0].set_ylabel("first-move cutoff rate"); axes[0].set_ylim(0, 1)
    axes[1].set_ylabel("rank of chosen move"); axes[1].set_xlabel("half-move (t)")
    axes[0].set_title("Move ordering quality (rolling median, window 9)")
    axes[0].legend(fontsize=8, title="engine"); axes[1].legend(fontsize=8, title="engine")
    names.append(save(fig, figdir, "ordering_quality.png"))

    # 9 ── TT health, aggregated
    if t["ttAgeAvg"].notna().any():
        fig, ax = plt.subplots(figsize=(11, 4.2))
        hr = (t["ttCut"] / t["ttHit"].replace(0, np.nan)).rename("cut_per_hit")
        tmp = t.assign(cut_per_hit=hr)
        band_plot(ax, tmp.dropna(subset=["cut_per_hit"]), "t", "cut_per_hit", "game",
                  label_prefix="cut/hit ")
        ax2 = ax.twinx()
        agem = t.groupby("t")["ttAgeAvg"].median()
        ax2.plot(agem.index, agem.values, color="darkorange", lw=1.4, label="mean hit age")
        ax2.set_ylabel("TT hit age (generations)")
        ax.set_xlabel("half-move (t)"); ax.set_ylabel("cutoffs per hit")
        ax.set_title("Transposition table health (aggregated across games)")
        h1, l1 = ax.get_legend_handles_labels(); h2, l2 = ax2.get_legend_handles_labels()
        ax.legend(h1 + h2, l1 + l2, fontsize=8, loc="upper left")
        names.append(save(fig, figdir, "tt_health.png"))

        q = t.dropna(subset=["ttAgeAvg", "wp_loss"]).copy()
        if len(q) > 40:
            q["bin"] = pd.qcut(q["ttAgeAvg"], q=min(8, q["ttAgeAvg"].nunique()), duplicates="drop")
            gb = q.groupby("bin", observed=False).agg(n=("t", "size"), y=("wp_loss", "median"))
            gb = gb[gb["n"] >= args.min_bin]
            fig, ax = plt.subplots(figsize=(8, 4))
            bars = ax.bar(range(len(gb)), gb["y"])
            ax.set_xticks(range(len(gb)))
            ax.set_xticklabels([str(i) for i in gb.index], rotation=30, ha="right", fontsize=7)
            for b, n in zip(bars, gb["n"]):
                ax.text(b.get_x() + b.get_width() / 2, b.get_height(), f"n={int(n)}",
                        ha="center", va="bottom", fontsize=7)
            ax.set_xlabel("mean TT hit age (decile bin)"); ax.set_ylabel("median wp loss")
            ax.set_title("TT entry age vs move quality")
            names.append(save(fig, figdir, "tt_age_vs_quality.png"))

    # 10 ── pruning mix, small multiples
    rates = [c for c in t.columns if c.endswith("_pk")]
    if rates:
        n = len(rates)
        fig, axes = plt.subplots((n + 2) // 3, 3, figsize=(12, 3.1 * ((n + 2) // 3)), sharex=True)
        axes = np.atleast_1d(axes).ravel()
        for ax, c in zip(axes, rates):
            for eng in engines:
                s = t[t["eng"] == eng].sort_values("t")
                ax.plot(s["t"], s[c].rolling(11, min_periods=4).median(), lw=1.2, label=eng)
            lim = rlim(t[c], 1, 99)
            if lim:
                ax.set_ylim(max(0, lim[0]), lim[1])
            ax.set_title(c.replace("_pk", "") + " / 1000 nodes", fontsize=9)
            ax.legend(fontsize=7)
        for ax in axes[len(rates):]:
            ax.axis("off")
        fig.suptitle("Pruning and reduction event rates (rolling median, window 11)")
        names.append(save(fig, figdir, "pruning_mix.png"))

    # 11 ── capture cadence
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2))
    gaps = t["capture_gap"].dropna()
    if not gaps.empty:
        axes[0].hist(gaps, bins=range(1, int(min(gaps.max(), 40)) + 2), align="left")
        axes[0].set_xlabel("plies between consecutive captures"); axes[0].set_ylabel("captures")
        axes[0].set_title("Capture cadence")
    capg = t[t["is_capture"]].pivot_table(index="cap_group", columns="eng",
                                          values="t", aggfunc="size", fill_value=0)
    if not capg.empty:
        capg.plot(kind="bar", ax=axes[1])
        axes[1].set_xlabel("captured piece group"); axes[1].set_ylabel("captures")
        axes[1].set_title("Captures by piece group and engine")
        axes[1].legend(fontsize=8, title="engine")
    names.append(save(fig, figdir, "capture_cadence.png"))

    # 12 ── material timeline with captures
    fig, ax = plt.subplots(figsize=(11, 4.4))
    shown = sorted(t["game"].unique())[:args.max_games_plot]
    for g in shown:
        sub = t[t["game"] == g]
        (line,) = ax.plot(sub["t"], sub["bal"], lw=1.1, label=f"game {g}")
        cp = sub[sub["is_capture"]]
        ax.scatter(cp["t"], cp["bal"], s=12, color=line.get_color(), zorder=3)
    ax.axhline(0, color="k", lw=0.6)
    ax.set_xlabel("half-move (t)"); ax.set_ylabel("material balance, cp (white POV)")
    ax.set_title(f"Material balance; dots are captures (first {len(shown)} games)")
    ax.legend(fontsize=7, ncol=4)
    names.append(save(fig, figdir, "material_timeline.png"))

    # 13 ── shuffle map
    sh = t[t["shuffle"]]
    if not sh.empty:
        fig, ax = plt.subplots(figsize=(11, 3.6))
        for i, eng in enumerate(engines):
            s = sh[sh["eng"] == eng]
            ax.scatter(s["t"], s["game"] + i * 0.15, s=14, label=eng)
        ax.set_xlabel("half-move (t)"); ax.set_ylabel("game")
        ax.set_title("Detected move repetition (reversal of own move two turns earlier)")
        ax.legend(fontsize=8, title="engine")
        names.append(save(fig, figdir, "shuffle_map.png"))

    # 14 ── eval components, small multiples
    if not leaf.empty:
        comps = leaf.attrs.get("components", [])
        if comps:
            ncol = 4
            nrow = (len(comps) + ncol - 1) // ncol
            fig, axes = plt.subplots(nrow, ncol, figsize=(3.1 * ncol, 2.7 * nrow))
            axes = np.atleast_1d(axes).ravel()
            for ax, c in zip(axes, comps):
                s = leaf[c].dropna()
                lim = rlim(s, 1, 99)
                ax.hist(s.clip(*lim) if lim else s, bins=40)
                ax.axvline(0, color="k", lw=0.6)
                ax.set_title(f"{c}  (1–99 pct)", fontsize=9)
            for ax in axes[len(comps):]:
                ax.axis("off")
            fig.suptitle("Sampled leaf evaluation components — independent scales")
            names.append(save(fig, figdir, "eval_components.png"))

        if "stage" in leaf.columns and comps:
            stages = [s for s in STAGE_ORDER if (leaf["stage"] == s).sum() >= 30]
            if stages:
                fig, axes = plt.subplots(1, len(stages), figsize=(3.4 * len(stages), 4.2))
                axes = np.atleast_1d(axes)
                for ax, st in zip(axes, stages):
                    c = leaf[leaf["stage"] == st][comps + ["s"]].corr(method="spearman")
                    im = ax.imshow(c.values, vmin=-1, vmax=1, cmap="coolwarm")
                    ax.set_xticks(range(len(c))); ax.set_xticklabels(c.columns, rotation=90, fontsize=7)
                    ax.set_yticks(range(len(c))); ax.set_yticklabels(c.index, fontsize=7)
                    ax.set_title(f"{st}\n(n={(leaf['stage']==st).sum()})", fontsize=9)
                fig.colorbar(im, ax=axes.tolist(), shrink=0.7)
                fig.suptitle("Evaluation-term correlation by game stage (Spearman)")
                names.append(save(fig, figdir, "component_corr_by_stage.png"))

    # 15 ── anomaly map
    return names


def anomaly_figure(turns, anomalies, figdir):
    if anomalies is None or anomalies.empty:
        return []
    fig, ax = plt.subplots(figsize=(11, 4.2))
    ax.scatter(turns["t"], np.zeros(len(turns)), s=1, alpha=0)  # establish x range
    for eng, sub in anomalies.groupby("eng"):
        ax.scatter(sub["t"], sub["anomaly_score"], s=34, label=eng)
        for _, r in sub.iterrows():
            ax.annotate(f"{r['best']}", (r["t"], r["anomaly_score"]),
                        fontsize=6, xytext=(2, 3), textcoords="offset points")
    ax.set_xlabel("half-move (t)"); ax.set_ylabel("composite robust z")
    ax.set_title("Top anomalies (MAD-scaled composite)")
    ax.legend(fontsize=8, title="engine")
    return [save(fig, figdir, "anomaly_map.png")]


# ══════════════════════════════════════════════════════════════════════════
# Report
# ══════════════════════════════════════════════════════════════════════════
def to_md(df):
    try:
        return df.round(4).to_markdown()
    except Exception:
        return "```\n" + df.round(4).to_string() + "\n```"


def note_for(name):
    if name in NOTES:
        return NOTES[name]
    for k, v in NOTES.items():
        if name in k.split(" / "):
            return v
    return ""


def write_outputs(session, out, tidy, agg, figures, args):
    for d in ("tidy", "tables", "figures"):
        (out / d).mkdir(parents=True, exist_ok=True)
    for name, df in tidy.items():
        if df is not None and not df.empty:
            df.to_csv(out / "tidy" / f"{name}.csv", index=False)

    jsonable = {}
    for name, df in agg.items():
        if isinstance(df, pd.DataFrame) and not df.empty:
            df.to_csv(out / "tables" / f"{name}.csv")
            jsonable[name] = json.loads(df.reset_index().to_json(orient="records"))
    (out / "aggregates.json").write_text(json.dumps(jsonable, indent=2), encoding="utf-8")

    L = [f"# Engine log analysis — `{session.name}`", "",
         "## Conventions", "",
         f"* Mate scores (|cp| > {MATE_THRESHOLD}) are excluded from every statistic and "
         "every figure; see `mate_summary` for their count. They are 3 orders of magnitude "
         "larger than the heuristic effects this pipeline measures and would dominate every "
         "mean, axis and correlation.",
         "* Quality is **self-reported**: the drop in the engine's own evaluation two of its "
         "own plies later, expressed as win probability "
         "(`wp = 1/(1+10^(-cp/400))`). It measures internal consistency, not strength "
         "against an oracle.",
         f"* Blunder thresholds are conventions supplied on the command line "
         f"(`--blunder-cp {args.blunder_cp}`, `--blunder-wp {args.blunder_wp}`), not "
         "discovered breakpoints. Full loss distributions accompany every rate.",
         f"* Bins with fewer than {args.min_bin} samples are dropped from binned figures.",
         "* `seq` orders every record within a game across all files and engines; "
         "`sort_values(['game','seq'])` on the tidy CSVs replays a decision in order.",
         "", "## Figures", ""]
    for n in figures:
        L += [f"### {n}", "", f"![{n}](figures/{n})", "", f"*How to read:* {note_for(n)}", ""]
    L += ["## Tables", ""]
    for name, df in agg.items():
        if isinstance(df, pd.DataFrame) and not df.empty:
            L += [f"### {name}", "", to_md(df), ""]
            nt = note_for(name)
            if nt:
                L += [f"*How to read:* {nt}", ""]
    
    L += ["## Glossary", "",
        "Log keys are fields the engine writes; derived metrics are computed by "
        "this script. Every derived entry states its formula — the numbers are "
        "not interpretable without it.", "",
        "| Key | Kind | Meaning |", "|---|---|---|"]
    for k in sorted(GLOSSARY):
        kind, text = GLOSSARY[k]
        L.append(f"| `{k}` | {kind} | {text.replace('|', '/')} |")
    L += ["",
          "Mate scores (|cp| > %d) are excluded from every statistic and figure; see "
          "`mate_summary`." % MATE_THRESHOLD, ""]

    (out / "report.md").write_text("\n".join(L), encoding="utf-8")
    (out / "glossary.md").write_text(
        "# Glossary\n\n| Key | Kind | Meaning |\n|---|---|---|\n" +
        "\n".join(f"| `{k}` | {GLOSSARY[k][0]} | {GLOSSARY[k][1]}" for k in sorted(GLOSSARY)),
        encoding="utf-8")

def write_summary(session, out, turns, agg, args, replay_index):
    """
    Machine-readable run summary. tools/aggregate_runs.py consumes ONLY this,
    so a cross-run comparison never has to re-parse report.md.
    """
    summary = {
        "session": session.name,
        "label": args.label or session.name,
        "blunder_cp": args.blunder_cp,
        "blunder_wp": args.blunder_wp,
        "turns": int(len(turns)),
        "games": int(turns["game"].nunique()) if not turns.empty else 0,
        "engines": {},
        "replay_games": len(replay_index),
    }
    prof = agg.get("engine_profiles")
    mq = agg.get("move_quality_by_engine")
    order = agg.get("ordering_by_engine")
    stab = agg.get("search_stability")
    engines = sorted(turns["eng"].dropna().unique()) if not turns.empty else []
    for eng in engines:
        rec = {}
        for name, df in (("profile", prof), ("quality", mq),
                         ("ordering", order), ("stability", stab)):
            if isinstance(df, pd.DataFrame) and eng in df.index:
                rec[name] = json.loads(df.loc[[eng]].to_json(orient="records"))[0]
        summary["engines"][eng] = rec
    (out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


# ══════════════════════════════════════════════════════════════════════════
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=None)
    ap.add_argument("--blunder-cp", type=float, default=200.0)
    ap.add_argument("--blunder-wp", type=float, default=0.20)
    ap.add_argument("--min-bin", type=int, default=8)
    ap.add_argument("--top-anomalies", type=int, default=25)
    ap.add_argument("--max-games-plot", type=int, default=8)
    ap.add_argument("--label", type=str, default=None,
                    help="run label recorded in summary.json (used by aggregate_runs.py)")
    ap.add_argument("--export-replay", action="store_true",
                    help="write out/replay/{index,game-N}.json for client replay")
    ap.add_argument("--no-figures", action="store_true",
                    help="tables + report only; skips matplotlib entirely")
    ap.add_argument("--glossary-only", action="store_true",
                    help="write glossary.md and exit (no log parsing)")
    args = ap.parse_args()
    
    if args.glossary_only:
        out = args.out or Path(".")
        out.mkdir(parents=True, exist_ok=True)
        (out / "glossary.md").write_text(
            "# Glossary\n\n| Key | Kind | Meaning |\n|---|---|---|\n" +
            "\n".join(f"| `{k}` | {GLOSSARY[k][0]} | {GLOSSARY[k][1]}" for k in sorted(GLOSSARY)),
            encoding="utf-8")
        print(f"glossary: {out / 'glossary.md'}")
        return 0

    session = args.path
    if not any(session.glob("game-*")):
        session = newest_session(session)
    out = args.out or (session / "analysis")

    logs, instances = load_session(session)
    print(f"session : {session}")
    print(f"loaded  : {', '.join(f'{k}({len(v)})' for k, v in sorted(logs.items()))}")

    turns = build_turns(logs.get("search"))
    iters = build_iterations(logs.get("search"))
    leaf  = build_leaf(logs.get("eval"), turns)
    heur  = logs.get("heuristics", pd.DataFrame())

    agg = aggregate(turns, iters, leaf, instances, args)

    figs = []
    if not args.no_figures:
        figs = make_figures(turns, iters, leaf, out / "figures", args)
        figs += anomaly_figure(turns, agg.get("anomalies", pd.DataFrame()), out / "figures")

    tidy = {"turns": turns, "iterations": iters, "eval_leaves": leaf,
            "heuristics": heur, "instances": instances,
            "root_ordering": logs.get("order", pd.DataFrame()),
            "uci": logs.get("uci", pd.DataFrame()),
            "timing": logs.get("time", pd.DataFrame())}

    write_outputs(session, out, tidy, agg, figs, args)

    replay_index = export_replay(turns, iters, instances, out) if args.export_replay else []
    write_summary(session, out, turns, agg, args, replay_index)

    print(f"output  : {out}  ({len(figs)} figures, "
          f"{sum(1 for v in agg.values() if isinstance(v, pd.DataFrame) and not v.empty)} tables"
          f"{f', {len(replay_index)} replay games' if replay_index else ''})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())