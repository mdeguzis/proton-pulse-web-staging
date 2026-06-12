import json
from pathlib import Path
from unittest.mock import patch

from scripts.pipeline.most_played import (
    _last_report_date,
    load_search_index,
    build_most_played,
)


# ── _last_report_date ─────────────────────────────────────────────────────────

def test_last_report_date_basic(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "2025.json").write_text(json.dumps([
        {"timestamp": 1750000000},
        {"timestamp": 1749000000},
    ]))
    result = _last_report_date(tmp_path, "730")
    assert result is not None
    assert "2025" in result

def test_last_report_date_missing_dir(tmp_path):
    assert _last_report_date(tmp_path, "999") is None

def test_last_report_date_no_year_files(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "latest.json").write_text("[]")
    assert _last_report_date(tmp_path, "730") is None

def test_last_report_date_all_zero_timestamps(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "2025.json").write_text(json.dumps([{"timestamp": 0}]))
    assert _last_report_date(tmp_path, "730") is None

def test_last_report_date_skips_reserved_files(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "latest.json").write_text(json.dumps([{"timestamp": 9999999999}]))
    # Only reserved file, no year file
    assert _last_report_date(tmp_path, "730") is None

def test_last_report_date_corrupt_file(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "2025.json").write_text("not json")
    assert _last_report_date(tmp_path, "730") is None


# ── load_search_index ─────────────────────────────────────────────────────────

def test_load_search_index_basic(tmp_path):
    index = [["730", "CS2", "gold", 50, 5]]
    (tmp_path / "search-index.json").write_text(json.dumps(index))
    result = load_search_index(tmp_path)
    assert "730" in result
    assert result["730"] == ("CS2", "gold", 50, 5)

def test_load_search_index_minimal_row(tmp_path):
    index = [["730", "CS2", "gold"]]
    (tmp_path / "search-index.json").write_text(json.dumps(index))
    result = load_search_index(tmp_path)
    assert result["730"] == ("CS2", "gold", 0, 0)

def test_load_search_index_skips_short_rows(tmp_path):
    index = [["730", "CS2"]]
    (tmp_path / "search-index.json").write_text(json.dumps(index))
    result = load_search_index(tmp_path)
    assert "730" not in result

def test_load_search_index_empty(tmp_path):
    (tmp_path / "search-index.json").write_text("[]")
    result = load_search_index(tmp_path)
    assert result == {}


# ── build_most_played (extended) ──────────────────────────────────────────────

def _write_index(tmp_path, rows):
    (tmp_path / "search-index.json").write_text(json.dumps(rows), encoding="utf-8")

def test_build_most_played_includes_last_report_date(tmp_path):
    _write_index(tmp_path, [["730", "CS2", "gold", 10, 0]])
    app_dir = tmp_path / "data" / "730"
    app_dir.mkdir(parents=True)
    (app_dir / "2025.json").write_text(json.dumps([{"timestamp": 1750000000}]))

    ranks = [{"appid": 730, "peak_in_game": 100}]
    out = build_most_played(tmp_path, ranks=ranks)
    assert out[0]["lastReportDate"] is not None

def test_build_most_played_lastdate_none_if_no_data(tmp_path):
    _write_index(tmp_path, [["730", "CS2", "gold", 10, 0]])
    # No data dir for this app
    ranks = [{"appid": 730, "peak_in_game": 100}]
    out = build_most_played(tmp_path, ranks=ranks)
    assert out[0]["lastReportDate"] is None

def test_build_most_played_header_image_none(tmp_path):
    _write_index(tmp_path, [["730", "CS2", "gold", 10, 0]])
    ranks = [{"appid": 730, "peak_in_game": 100}]
    out = build_most_played(tmp_path, ranks=ranks)
    assert out[0]["headerImage"] is None
