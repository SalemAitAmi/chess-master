#!/usr/bin/env python3
"""
Aggregate analysis runs into one comparison table.

    python tools/aggregate_runs.py tools/runs
    python tools/aggregate_runs.py tools/runs -o tools/runs/comparison

Input : every `summary.json` under <root> (written by analyze_logs.py), plus
        every `arm-*.json` / `run.json` written by tools/run_experiments.mjs.
Output: comparison.csv / comparison.md — one row per (run, engine), with the
        match result from the harness joined onto the quality metrics from the
        analyser.

WHY A SEPARATE SCRIPT. analyze_logs.py describes ONE session and deliberately
draws no conclusions. Comparing config sets is a different question with a
different failure mode: the temptation to read a 1-game difference as a result.
Every row therefore carries `games` and `turns`, and the markdown header says
so in as many words.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

FLAT = [
    ("quality", "moves"), ("quality", "wp_loss_median"), ("quality", "wp_loss_p90"),
    ("quality", "eval_drop_median"), ("quality", "blunder_rate_wp"),
    ("quality", "blunder_rate_cp"), ("quality", "capture_share"),
    ("quality", "shuffle_share"), ("quality", "depth_median"),
    ("quality", "nodes_median"), ("quality", "ms_median"),
    ("ordering", "fmc_rate_median"), ("ordering", "rank0_rate"),
    ("ordering", "rank_median"), ("ordering", "margin_median"),
    ("stability", "root_changes_mean"), ("stability", "latency_median"),
    ("stability", "asp_low_mean"), ("stability", "asp_high_mean"),
    ("profile", "profile"), ("profile", "configHash"),
]


def load_summaries(root: Path) -> pd.DataFrame:
    rows = []
    for p in sorted(root.rglob("summary.json")):
        try:
            s = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"  skipped malformed {p}")
            continue
        for eng, blocks in (s.get("engines") or {}).items():
            row = {"run": s.get("label") or s.get("session"),
                   "session": s.get("session"),
                   "eng": eng,
                   "games": s.get("games"),
                   "turns": s.get("turns"),
                   "source": str(p)}
            for block, key in FLAT:
                row[key if block != "profile" else f"cfg_{key}"] = (blocks.get(block) or {}).get(key)
            rows.append(row)
    return pd.DataFrame(rows)


def load_match_results(root: Path) -> pd.DataFrame:
    """Match outcomes per engine instance, from the harness's arm-*.json."""
    rows = []
    for p in sorted(root.rglob("arm-*.json")):
        try:
            a = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        games = a.get("games") or []
        for eng, wins in (a.get("tally") or {}).items():
            if eng == "draw":
                continue
            played = sum(1 for g in games if eng in (g.get("whiteEngine"), g.get("blackEngine")))
            rows.append({
                "eng": eng, "arm": a.get("arm"),
                "match_wins": wins,
                "match_draws": (a.get("tally") or {}).get("draw", 0),
                "match_games": played,
                "mean_plies": (sum(g.get("plies", 0) for g in games) / len(games)) if games else None,
                "abandoned": sum(1 for g in games if g.get("status") == "abandoned_move_limit"),
            })
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=None)
    args = ap.parse_args()

    out = args.out or (args.root / "comparison")
    out.mkdir(parents=True, exist_ok=True)

    summaries = load_summaries(args.root)
    if summaries.empty:
        raise SystemExit(f"no summary.json found under {args.root}")

    matches = load_match_results(args.root)
    merged = summaries.merge(matches, on="eng", how="left") if not matches.empty else summaries
    merged = merged.sort_values(["run", "eng"])
    merged.to_csv(out / "comparison.csv", index=False)

    lead = [
        "# Config-set comparison", "",
        "One row per (run, engine instance). `eng` is an engine INSTANCE: one "
        "socket, one config set, one transposition table. Two rows with the same "
        "`cfg_configHash` are the same engine and must not be compared as if they "
        "were different.", "",
        "Read `wp_loss_median` first (robust, bounded), then `fmc_rate_median` "
        "(ordering health), then the match result. **Check `games` and "
        "`match_games` before concluding anything** — a difference smaller than "
        "the spread of a single game is not a difference.", "",
    ]
    try:
        table = merged.round(4).to_markdown(index=False)
    except Exception:
        table = "```\n" + merged.round(4).to_string(index=False) + "\n```"
    (out / "comparison.md").write_text("\n".join(lead + [table, ""]), encoding="utf-8")

    print(f"runs    : {merged['run'].nunique()}  engines: {merged['eng'].nunique()}")
    print(f"output  : {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())