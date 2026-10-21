"""Refresh only the historical poll cards for the current New Jersey Senate page."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from datetime import date
from pathlib import Path
from typing import Any


SITE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SITE_ROOT.parent
BUILDER_PATH = SITE_ROOT / "scripts" / "build-race-retrospective-data.py"
RETROSPECTIVE_PATH = SITE_ROOT / "public" / "data" / "race-retrospectives.json"
CURRENT_PATH = SITE_ROOT / "public" / "data" / "current.json"
AUDIT_PATH = SITE_ROOT / "dist" / "audit" / "nj-senate-poll-archive-repair.json"
EXPECTED_COUNTS = {2018: 15, 2020: 3, 2024: 4}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json_atomic(path: Path, payload: Any, *, compact: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":") if compact else None,
        indent=None if compact else 2,
    )
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(text + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    spec = importlib.util.spec_from_file_location("race_retrospective_builder", BUILDER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load poll archive helpers from {BUILDER_PATH}.")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)

    original_current_hash = sha256(CURRENT_PATH)
    retrospective = json.loads(RETROSPECTIVE_PATH.read_text(encoding="utf-8"))
    race = retrospective.get("races", {}).get("senate-nj")
    if not race or race.get("office") != "Senate" or race.get("state") != "NJ":
        raise ValueError("The current retrospective file has no Senate · NJ race record.")

    source_rows = builder.read_csv(builder.SENATE_POLLS_PATH)
    polls_by_state_year = builder.collect_senate_polls(source_rows)
    wedgewood_in_source = sum(
        "wedgewood" in str(row.get("pollster") or "").casefold()
        for row in source_rows
        if row.get("year") in {str(year) for year in EXPECTED_COUNTS}
        and str(row.get("state") or "").strip().casefold() in {"new-jersey", "new jersey"}
    )
    if wedgewood_in_source:
        raise ValueError(f"Refusing to include {wedgewood_in_source} Wedgewood poll(s).")

    rows_by_year = {int(row["year"]): row for row in race.get("historical_rows", [])}
    if not set(EXPECTED_COUNTS).issubset(rows_by_year):
        raise ValueError("The NJ Senate page does not expose all expected historical validation cycles.")

    cycle_audit = {}
    for year, expected_count in EXPECTED_COUNTS.items():
        historical_row = rows_by_year[year]
        polls = list(polls_by_state_year.get(("NJ", year), []))
        if len(polls) != expected_count:
            raise ValueError(f"NJ Senate {year} archive count is {len(polls)}, expected {expected_count}.")
        if any("wedgewood" in str(poll.get("pollster", "")).casefold() for poll in polls):
            raise ValueError(f"A Wedgewood poll reached the NJ Senate {year} archive.")
        summary = builder.summarized_polls(
            polls, historical_row.get("actual_margin_pp"), office="Senate", year=year,
        )
        historical_row.update(summary)
        cycle_audit[str(year)] = {
            "poll_count": summary["poll_count"],
            "final_30_day_poll_count": summary["final_30_day_poll_count"],
            "poll_average_margin_pp": summary["poll_average_margin_pp"],
            "poll_miss_pp": summary["poll_miss_pp"],
            "source_url": builder.NEW_JERSEY_SENATE_RCP_URLS[year],
        }

    current_poll_count = int(race.get("current_polling", {}).get("poll_count", 0))
    write_json_atomic(RETROSPECTIVE_PATH, retrospective, compact=False)
    if sha256(CURRENT_PATH) != original_current_hash:
        raise RuntimeError("The 2026 current forecast file changed during a history-only repair.")

    source_path = builder.SENATE_POLLS_PATH.resolve()
    audit = {
        "created_on": date.today().isoformat(),
        "scope": "NJ Senate historical poll cards for the page's visible 2018, 2020, and 2024 validation cycles only.",
        "rerun_command": "python scripts/refresh-nj-senate-poll-history.py",
        "race_id": "senate-nj",
        "historical_cycles": cycle_audit,
        "total_historical_polls": sum(row["poll_count"] for row in cycle_audit.values()),
        "wedgewood_poll_rows_included": 0,
        "wedgewood_poll_rows_found_in_source_for_nj_cycles": wedgewood_in_source,
        "current_2026_poll_count_left_unchanged": current_poll_count,
        "date_correction": {
            "pollster": "Rutgers-Eagleton",
            "cycle": 2020,
            "source_table_start": "2019-10-18",
            "displayed_start": "2020-10-18",
            "reason": "RCP's NJ Senate archive lists this poll as 10/18–10/24 in 2020.",
            "archive_url": builder.NEW_JERSEY_SENATE_RCP_URLS[2020],
        },
        "sources": {
            "senate_poll_archive": {
                "file": source_path.relative_to(REPO_ROOT).as_posix(),
                "sha256": sha256(source_path),
            },
            "importer": {
                "file": BUILDER_PATH.relative_to(SITE_ROOT).as_posix(),
                "sha256": sha256(BUILDER_PATH),
            },
            "focused_refresh_script": {
                "file": Path(__file__).resolve().relative_to(SITE_ROOT).as_posix(),
                "sha256": sha256(Path(__file__).resolve()),
            },
        },
        "outputs": {
            "race_retrospectives": {
                "file": RETROSPECTIVE_PATH.relative_to(SITE_ROOT).as_posix(),
                "sha256": sha256(RETROSPECTIVE_PATH),
            },
            "current_forecast": {
                "file": CURRENT_PATH.relative_to(SITE_ROOT).as_posix(),
                "sha256": original_current_hash,
                "unchanged": True,
            },
        },
        "notes": [
            "Historical poll rows link to the RCP race archive page that lists them.",
            "The current 2026 archive remains empty because its RCP matchup page and Polling Forecast's NJ Senate poll listing have no race-specific polls.",
        ],
    }
    write_json_atomic(AUDIT_PATH, audit, compact=False)
    print(json.dumps({"race_id": "senate-nj", "cycles": cycle_audit, "audit": str(AUDIT_PATH)}, indent=2))


if __name__ == "__main__":
    main()
