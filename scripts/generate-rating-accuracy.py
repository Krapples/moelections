#!/usr/bin/env python3
"""Build rating-category accuracy from the released models' OOF forecasts."""

from __future__ import annotations

import csv
import gzip
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any


SITE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SITE_ROOT.parent
PUBLIC_DATA = SITE_ROOT / "public" / "data"
EXPERIMENT_ROOT = REPO_ROOT / "processed" / "expanded_model" / "rcp_no_wedgewood_refresh_20261023_v1"
CATEGORY_PATH = (
    REPO_ROOT
    / "processed"
    / "expanded_model"
    / "house_histgbr_feature_family_ablation_optuna_20261022_v1"
    / "fixed_public_oof_categories.csv"
)
HOUSE_PATH = EXPERIMENT_ROOT / "house_kde" / "validation_kde_paired_predictions.csv.gz"
SENATE_PATH = EXPERIMENT_ROOT / "senate_apply" / "website_selected_oof_predictions.csv.gz"
GOVERNOR_PATH = EXPERIMENT_ROOT / "governor" / "website_selected_oof_predictions.csv.gz"
CURRENT_PATH = PUBLIC_DATA / "current.json"
OUTPUT_PATH = PUBLIC_DATA / "category-accuracy.json"

YEARS = (2018, 2020, 2022, 2024)
CATEGORIES = ("Toss-up", "Lean", "Likely", "Safe")
OFFICES = ("House", "Senate", "Governor")
SCOPES = ("All offices", *OFFICES)
THRESHOLDS = ((0.60, "Toss-up"), (0.80, "Lean"), (0.98, "Likely"))
EXPECTED_COUNTS = {
    "House": {2018: 393, 2020: 408, 2022: 400, 2024: 397},
    "Senate": {2018: 31, 2020: 31, 2022: 29, 2024: 31},
    "Governor": {2018: 36, 2020: 11, 2022: 36, 2024: 11},
}


def read_csv(path: Path, *, compressed: bool = False) -> list[dict[str, str]]:
    opener = gzip.open if compressed else open
    with opener(path, "rt", newline="", encoding="utf-8-sig") as source:
        return list(csv.DictReader(source))


def category_for(probability_dem: float) -> str:
    favored = max(probability_dem, 1.0 - probability_dem)
    if favored < THRESHOLDS[0][0]:
        return "Toss-up"
    if favored < THRESHOLDS[1][0]:
        return "Lean"
    if favored < THRESHOLDS[2][0]:
        return "Likely"
    return "Safe"


def metric(rows: list[dict[str, Any]]) -> dict[str, Any]:
    races = len(rows)
    correct = sum(int(row["correct"]) for row in rows)
    return {
        "races": races,
        "correct_calls": correct,
        "accuracy": correct / races if races else None,
    }


def main() -> None:
    for path in (CATEGORY_PATH, HOUSE_PATH, SENATE_PATH, GOVERNOR_PATH, CURRENT_PATH):
        if not path.is_file():
            raise FileNotFoundError(f"Required rating-accuracy input is missing: {path}")

    fixed_categories: dict[tuple[int, str], dict[str, str]] = {}
    for row in read_csv(CATEGORY_PATH):
        key = (int(row["evaluation_year"]), row["district_id"])
        if key in fixed_categories:
            raise ValueError(f"Duplicate fixed House category key: {key}")
        fixed_categories[key] = row

    predictions: list[dict[str, Any]] = []
    seen: set[tuple[str, int, str]] = set()

    for row in read_csv(HOUSE_PATH, compressed=True):
        year = int(row["evaluation_year"])
        race_id = row["district_id"]
        key = (year, race_id)
        fixed = fixed_categories.get(key)
        if fixed is None:
            raise ValueError(f"House prediction has no fixed rating label: {key}")
        kde_probability = row.get("kde_probability", "")
        probability = float(kde_probability) if kde_probability else float(row["website_aligned_probability"])
        fixed_probability = float(fixed["selected_public_probability"])
        if not math.isclose(probability, fixed_probability, rel_tol=0.0, abs_tol=1e-10):
            raise ValueError(f"House fixed-category probability differs from released OOF probability: {key}")
        category = fixed["category"]
        if category not in CATEGORIES or category != category_for(probability):
            raise ValueError(f"House fixed rating does not follow current thresholds: {key} ({category})")
        actual_dem = int(float(row["actual_dem_win"]))
        predictions.append({
            "office": "House",
            "year": year,
            "race_id": race_id,
            "category": category,
            "correct": int((probability >= 0.5) == bool(actual_dem)),
        })
        seen.add(("House", year, race_id))

    for office, path in (("Senate", SENATE_PATH), ("Governor", GOVERNOR_PATH)):
        for row in read_csv(path, compressed=True):
            source_office = row.get("source_office") or office
            if source_office != office:
                continue
            year = int(row["cycle"])
            probability = float(row["probability_democratic"])
            actual_margin = float(row["actual_margin_pp"])
            if not math.isfinite(probability) or not 0.0 <= probability <= 1.0:
                raise ValueError(f"Invalid {office} OOF probability for {row['district_id']}")
            if not math.isfinite(actual_margin) or actual_margin == 0:
                raise ValueError(f"Missing or tied {office} OOF outcome for {row['district_id']}")
            race_id = row["district_id"]
            category = category_for(probability)
            if year not in YEARS:
                continue
            predictions.append({
                "office": office,
                "year": year,
                "race_id": race_id,
                "category": category,
                "correct": int((probability >= 0.5) == (actual_margin > 0)),
            })
            seen.add((office, year, race_id))

    if len(fixed_categories) != 1598 or sum(row["office"] == "House" for row in predictions) != 1598:
        raise ValueError("The House validation panel changed from the established 1,598-race cohort")
    if len(seen) != len(predictions):
        raise ValueError("Duplicate office/year/race prediction rows were found")

    for office in OFFICES:
        for year in YEARS:
            count = sum(row["office"] == office and row["year"] == year for row in predictions)
            if count != EXPECTED_COUNTS[office][year]:
                raise ValueError(f"Unexpected {office} validation count for {year}: {count}")

    current = json.loads(CURRENT_PATH.read_text(encoding="utf-8"))
    published_metrics = current["historical_performance"]["metrics"]
    for office in OFFICES:
        for year in YEARS:
            group = [row for row in predictions if row["office"] == office and row["year"] == year]
            published = next(
                (row for row in published_metrics if row["office"] == office and row["cycle"] == year),
                None,
            )
            if published is None:
                raise ValueError(f"Published historical scorecard is missing {office} {year}")
            observed = metric(group)
            expected_correct = round(float(published["accuracy"]) * int(published["races"]))
            if observed["races"] != int(published["races"]) or observed["correct_calls"] != expected_correct:
                raise ValueError(
                    f"{office} {year} OOF calls do not match the published website scorecard: "
                    f"{observed['correct_calls']}/{observed['races']} vs "
                    f"{expected_correct}/{published['races']}"
                )

    results: dict[str, Any] = {}
    for scope in SCOPES:
        selected = predictions if scope == "All offices" else [row for row in predictions if row["office"] == scope]
        results[scope] = {
            "overall": metric(selected),
            "by_year": {
                str(year): metric([row for row in selected if row["year"] == year])
                for year in YEARS
            },
            "categories": {
                category: {
                    **metric([row for row in selected if row["category"] == category]),
                    "by_year": {
                        str(year): metric([
                            row for row in selected
                            if row["category"] == category and row["year"] == year
                        ])
                        for year in YEARS
                    },
                }
                for category in CATEGORIES
            },
        }

    payload = {
        "schema_version": 1,
        "snapshot_date": current["snapshot_date"],
        "validation_years": list(YEARS),
        "call_rule": "Democratic call when Democratic win probability is at least 50%; Republican otherwise.",
        "rating_definition": (
            "Category is based on the stronger party's forecast win probability: Toss-up <60%; "
            "Lean 60%–<80%; Likely 80%–<98%; Safe ≥98%."
        ),
        "validation_note": (
            "Historical out-of-sample winner-call rates for the website's released forecast streams. "
            "These are observed validation frequencies, not guarantees; races within an election cycle "
            "are related, and the panel covers four elections."
        ),
        "results": results,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUTPUT_PATH.relative_to(SITE_ROOT)}: "
        f"{len(predictions):,} predictions across {len(OFFICES)} offices and {len(YEARS)} cycles."
    )
    for scope in SCOPES:
        overall = results[scope]["overall"]
        categories = results[scope]["categories"]
        print(
            f"{scope}: {overall['correct_calls']}/{overall['races']} "
            f"({overall['accuracy']:.4%}); "
            + ", ".join(
                f"{category} {categories[category]['correct_calls']}/{categories[category]['races']} "
                f"({categories[category]['accuracy']:.2%})"
                for category in CATEGORIES
            )
        )


if __name__ == "__main__":
    main()
