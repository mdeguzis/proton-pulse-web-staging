#!/usr/bin/env python3
"""
Large-scale validation of Proton Pulse's rating derivation algorithm against
live ProtonDB detailed report data.

Fetches raw reports for a sample of popular games, applies infer_live_rating()
to each report's responses, and checks consistency + edge-case coverage.
"""

import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from urllib import request, error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pipeline.backfill import (
    LIVE_REPORT_FAULT_KEYS,
    infer_live_rating,
    normalize_live_detailed_reports,
    build_live_report_candidate_urls,
    fetch_live_reports_payload,
)
from pipeline.common import fetch_json, log, LIVE_COUNTS_URL

# ---------------------------------------------------------------------------
# Sample game set -- mix of popular, niche, borked-heavy, platinum-heavy
# ---------------------------------------------------------------------------
SAMPLE_GAMES = [
    ("289070", "Assassin's Creed Syndicate"),   # large corpus, mixed
    ("292030", "The Witcher 3"),                 # large, mostly platinum/gold
    ("1245620", "Elden Ring"),                   # high report count, mixed
    ("271590", "GTA V"),                         # very large corpus
    ("105600", "Terraria"),                      # mostly platinum
    ("570", "Dota 2"),                           # native, mostly platinum
    ("1091500", "Cyberpunk 2077"),               # mixed, many borked historically
    ("730", "CS:GO / CS2"),                      # native
    ("1174180", "Red Dead Redemption 2"),        # historically borked-heavy
    ("374320", "Dark Souls III"),                # gold/platinum heavy
    ("1203220", "STAR WARS Jedi: Fallen Order"), # varied
    ("632360", "Risk of Rain 2"),                # mostly platinum
    ("1551360", "Forza Horizon 5"),              # historically borked
    ("814380", "Sekiro"),                        # gold/platinum
    ("1086940", "Baldur's Gate 3"),              # platinum after patches
    ("2050650", "Resident Evil 4 Remake"),       # varied
    ("2358720", "Starfield"),                    # mixed/borked at launch
    ("990080", "Hogwarts Legacy"),               # varied
    ("1245040", "Hades"),                        # mostly platinum
    ("413150", "Stardew Valley"),                # mostly platinum
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FAULT_KEYS = list(LIVE_REPORT_FAULT_KEYS)

def analyse_report(responses: dict) -> dict:
    """Extract key fields and derived rating from a single report's responses."""
    derived = infer_live_rating(responses)
    fault_count = sum(1 for k in FAULT_KEYS if responses.get(k) == "yes")
    verdict = (responses.get("verdict") or "").lower()
    oob = (responses.get("verdictOob") or responses.get("triedOob") or "").lower()
    return {
        "derived": derived,
        "verdict": verdict,
        "fault_count": fault_count,
        "oob": oob,
        "can_install": responses.get("canInstall"),
        "can_start": responses.get("canStart"),
        "can_play": responses.get("canPlay"),
        "faults": {k: responses.get(k) for k in FAULT_KEYS if responses.get(k) == "yes"},
    }

_GLOBAL_COUNTS: dict = {}

def get_global_counts() -> dict:
    """Fetch global counts.json once (cached). Returns dict with 'reports' and 'timestamp'."""
    global _GLOBAL_COUNTS
    if not _GLOBAL_COUNTS:
        try:
            _GLOBAL_COUNTS = fetch_json(LIVE_COUNTS_URL) or {}
        except Exception as e:
            log(f"[analyse] Could not fetch counts: {e}")
    return _GLOBAL_COUNTS

def fetch_reports_for_app(app_id: str) -> list[dict]:
    """Fetch raw reports for a game, return list of response dicts."""
    counts = get_global_counts()
    report_count = counts.get("reports")
    timestamp = counts.get("timestamp")

    if not isinstance(report_count, int) or not isinstance(timestamp, int):
        log(f"[analyse] {app_id}: could not get global report_count/timestamp")
        return []

    candidates = build_live_report_candidate_urls(app_id, report_count, timestamp)
    payload, url = fetch_live_reports_payload(app_id, candidates)
    if not payload:
        log(f"[analyse] {app_id}: could not fetch live reports")
        return []

    raw_reports = payload.get("reports") or []
    log(f"[analyse] {app_id}: fetched {len(raw_reports)} raw reports from {url}")
    return [r.get("responses") or {} for r in raw_reports if isinstance(r, dict)]

# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def run():
    total_reports = 0
    rating_dist: Counter = Counter()
    fault_dist: Counter = Counter()
    verdict_dist: Counter = Counter()
    oob_dist: Counter = Counter()
    # Tracks which fault combos lead to which rating
    fault_to_rating: dict[int, Counter] = defaultdict(Counter)
    # Edge cases
    edge_cases = []

    per_game_stats = []

    for app_id, title in SAMPLE_GAMES:
        log(f"\n=== {title} ({app_id}) ===")
        responses_list = fetch_reports_for_app(app_id)
        if not responses_list:
            continue

        game_ratings: Counter = Counter()
        for resp in responses_list:
            a = analyse_report(resp)
            rating_dist[a["derived"]] += 1
            game_ratings[a["derived"]] += 1
            fault_dist[a["fault_count"]] += 1
            verdict_dist[a["verdict"] or "(missing)"] += 1
            oob_dist[a["oob"] or "(n/a)"] += 1
            fault_to_rating[a["fault_count"]][a["derived"]] += 1
            total_reports += 1

            # Flag edge cases worth reviewing
            if a["verdict"] == "yes" and a["fault_count"] == 0 and a["derived"] not in ("platinum", "gold"):
                edge_cases.append({"app_id": app_id, "reason": "verdict=yes, 0 faults, not platinum/gold", **a})
            if a["verdict"] == "no" and a["derived"] != "borked":
                edge_cases.append({"app_id": app_id, "reason": "verdict=no but not borked", **a})
            if a["derived"] == "pending" and a["verdict"]:
                edge_cases.append({"app_id": app_id, "reason": "pending despite having verdict", **a})

        per_game_stats.append({
            "app_id": app_id,
            "title": title,
            "reports": len(responses_list),
            "distribution": dict(game_ratings),
        })
        time.sleep(0.3)  # be polite to ProtonDB

    # --- Report ---
    print("\n" + "="*70)
    print(f"ANALYSIS COMPLETE -- {total_reports} reports across {len(per_game_stats)} games")
    print("="*70)

    print("\n-- Overall Rating Distribution --")
    for rating in ["platinum", "gold", "silver", "bronze", "borked", "pending"]:
        count = rating_dist[rating]
        pct = 100 * count / total_reports if total_reports else 0
        bar = "#" * int(pct / 2)
        print(f"  {rating:10s}: {count:5d} ({pct:5.1f}%)  {bar}")

    print("\n-- Fault Count Distribution --")
    for fc in sorted(fault_dist):
        count = fault_dist[fc]
        pct = 100 * count / total_reports if total_reports else 0
        ratings = ", ".join(f"{r}={n}" for r, n in sorted(fault_to_rating[fc].items()))
        print(f"  faults={fc}: {count:5d} ({pct:5.1f}%) -> {ratings}")

    print("\n-- Verdict Distribution --")
    for v, count in verdict_dist.most_common():
        print(f"  verdict={v!r:15s}: {count:5d}")

    print("\n-- Out-of-Box Distribution (fault=0, verdict=yes reports) --")
    for o, count in oob_dist.most_common():
        print(f"  oob={o!r:10s}: {count:5d}")

    print("\n-- Per-Game Summary --")
    for g in per_game_stats:
        dist = g["distribution"]
        top = max(dist, key=dist.get) if dist else "N/A"
        print(f"  {g['title'][:40]:40s} ({g['app_id']})  {g['reports']:4d} reports  top={top}")

    print(f"\n-- Edge Cases Found: {len(edge_cases)} --")
    for ec in edge_cases[:20]:
        print(f"  [{ec['app_id']}] {ec['reason']} | verdict={ec['verdict']} faults={ec['fault_count']} oob={ec['oob']} -> {ec['derived']}")
    if len(edge_cases) > 20:
        print(f"  ... and {len(edge_cases) - 20} more")

    print("\n-- Algorithm Consistency Check --")
    issues = []
    # Rule: fault_count >= 3 should always be bronze
    for n in range(3, 10):
        wrong = fault_to_rating[n].get("silver", 0) + fault_to_rating[n].get("gold", 0) + fault_to_rating[n].get("platinum", 0)
        if wrong:
            issues.append(f"fault_count={n}: {wrong} reports NOT bronze/borked (got {dict(fault_to_rating[n])})")
    # Rule: fault_count == 2 should always be silver
    wrong_silver = fault_to_rating[2].get("bronze", 0) + fault_to_rating[2].get("gold", 0) + fault_to_rating[2].get("platinum", 0)
    if wrong_silver:
        issues.append(f"fault_count=2: {wrong_silver} reports NOT silver (got {dict(fault_to_rating[2])})")
    # Rule: fault_count == 1 should always be gold
    wrong_gold = fault_to_rating[1].get("platinum", 0) + fault_to_rating[1].get("silver", 0) + fault_to_rating[1].get("bronze", 0)
    if wrong_gold:
        issues.append(f"fault_count=1: {wrong_gold} reports NOT gold (got {dict(fault_to_rating[1])})")

    if issues:
        print("  INCONSISTENCIES DETECTED:")
        for i in issues:
            print(f"    !! {i}")
    else:
        print("  All fault-count -> rating rules are internally consistent.")

    # Save results
    out = {
        "total_reports": total_reports,
        "rating_distribution": dict(rating_dist),
        "fault_distribution": {str(k): dict(v) for k, v in fault_to_rating.items()},
        "per_game": per_game_stats,
        "edge_cases": edge_cases[:50],
        "issues": issues,
    }
    out_path = Path(__file__).parent / "scoring_analysis_results.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"\nResults saved to {out_path}")

if __name__ == "__main__":
    run()
