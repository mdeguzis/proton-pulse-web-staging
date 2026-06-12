"""Additional backfill coverage tests for functions not covered elsewhere."""
import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from scripts.pipeline.backfill import (
    _app_dir_has_report_data,
    _log_backfill_summary,
    _string_app_id_sort_key,
    _target_app_id_sort_key,
    _find_bad_app_id_entries,
    _require_bounded_coverage_backfill,
    _log_app_id_batches,
    backfill_probe_discoveries,
    run_probe_backfill,
    run_backfill,
    BackfillTarget,
)
from scripts.pipeline.state import write_pipeline_state


# ── _app_dir_has_report_data ──────────────────────────────────────────────────

def test_app_dir_has_report_data_with_year_file(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "2024.json").write_text("[]")
    assert _app_dir_has_report_data(app_dir) is True

def test_app_dir_has_report_data_metadata_only(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "metadata.json").write_text("{}")
    assert _app_dir_has_report_data(app_dir) is False

def test_app_dir_has_report_data_missing_dir(tmp_path):
    assert _app_dir_has_report_data(tmp_path / "999") is False

def test_app_dir_has_report_data_empty(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    assert _app_dir_has_report_data(app_dir) is False


# ── _string_app_id_sort_key ───────────────────────────────────────────────────

def test_string_app_id_sort_key():
    assert _string_app_id_sort_key("730") == 730
    assert _string_app_id_sort_key("100") < _string_app_id_sort_key("200")


# ── _target_app_id_sort_key ───────────────────────────────────────────────────

def test_target_app_id_sort_key():
    t = BackfillTarget("730", ())
    assert _target_app_id_sort_key(t) == 730


# ── _log_backfill_summary ─────────────────────────────────────────────────────

def test_log_backfill_summary_no_reasons(capsys):
    _log_backfill_summary("test", 1, 1, {("730", "2024")})
    err = capsys.readouterr().err
    assert "miss reasons: none" in err

def test_log_backfill_summary_all_reasons(capsys):
    _log_backfill_summary(
        "test", 10, 5, set(),
        no_candidate=2,
        no_usable_reports=1,
        unresolved_title=1,
        already_present=1,
    )
    err = capsys.readouterr().err
    assert "no live detailed payload" in err
    assert "no usable reports" in err
    assert "unresolved title" in err
    assert "already present" in err

def test_log_backfill_summary_partial_reasons(capsys):
    _log_backfill_summary("test", 5, 3, set(), no_candidate=2)
    err = capsys.readouterr().err
    assert "no live detailed payload" in err


# ── _find_bad_app_id_entries ──────────────────────────────────────────────────

def test_find_bad_app_id_entries_basic(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "730").mkdir()
    (data_dir / "bad-id").mkdir()
    result = _find_bad_app_id_entries(data_dir)
    assert "bad-id" in result
    assert "730" not in result

def test_find_bad_app_id_entries_empty(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    assert _find_bad_app_id_entries(data_dir) == []


# ── _require_bounded_coverage_backfill ────────────────────────────────────────

def test_require_bounded_bad_app_id_always_ok():
    _require_bounded_coverage_backfill("bad-app-id", 0, False)

def test_require_bounded_with_limit_ok():
    _require_bounded_coverage_backfill("no-titles", 10, False)

def test_require_bounded_unbounded_allowed(capsys):
    _require_bounded_coverage_backfill("no-titles", 0, allow_unbounded=True)
    err = capsys.readouterr().err
    assert "Unbounded run explicitly allowed" in err

def test_require_bounded_unbounded_not_allowed(capsys):
    _require_bounded_coverage_backfill("no-titles", 0, allow_unbounded=False)
    err = capsys.readouterr().err
    assert "Running unbounded" in err


# ── _log_app_id_batches ───────────────────────────────────────────────────────

def test_log_app_id_batches_empty(capsys):
    _log_app_id_batches("[test]", [])
    err = capsys.readouterr().err
    assert "none" in err

def test_log_app_id_batches_single_batch(capsys):
    _log_app_id_batches("[test]", ["730", "570"])
    err = capsys.readouterr().err
    assert "730" in err

def test_log_app_id_batches_multi_batch(capsys):
    ids = [str(i) for i in range(150)]
    _log_app_id_batches("[test]", ids, batch_size=100)
    err = capsys.readouterr().err
    # Should have at least two batch lines
    assert err.count("[test]") >= 2


# ── backfill_probe_discoveries ────────────────────────────────────────────────

def test_backfill_probe_discoveries_no_missing(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "730").mkdir()
    result = backfill_probe_discoveries(data_dir, {"730": "CS2"})
    assert result == set()

def test_backfill_probe_discoveries_empty_catalog(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    result = backfill_probe_discoveries(data_dir, {})
    assert result == set()

def test_backfill_probe_discoveries_with_limit(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    catalog = {"730": "CS2", "570": "Dota 2", "440": "TF2"}
    counts_payload = {"reports": 100000, "timestamp": 1700000000}
    live_payload = {"reports": [
        {"timestamp": 1700000000, "responses": {"verdict": "yes", "protonVersion": "9.0"},
         "device": {"inferred": {"steam": {}}}, "contributor": {"steam": {"playtimeLinux": 100}}}
    ]}

    def fake_fetch(url):
        if "counts" in url:
            return counts_payload
        return live_payload

    with patch("scripts.pipeline.backfill.fetch_steam_title_with_source", return_value=("CS2", "steam")):
        result = backfill_probe_discoveries(data_dir, catalog, limit=1, fetch_json_impl=fake_fetch)
    assert len(result) <= 1

def test_backfill_probe_discoveries_already_known(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    catalog = {"730": "CS2"}
    result = backfill_probe_discoveries(data_dir, catalog, already_known_app_ids={"730"})
    assert result == set()


# ── run_probe_backfill ────────────────────────────────────────────────────────

def test_run_probe_backfill_empty_cache(tmp_path):
    write_pipeline_state(tmp_path, 0, set())
    (tmp_path / "data").mkdir()
    with (
        patch("scripts.pipeline.backfill.read_protondb_probe_cache", return_value={}),
        patch("scripts.pipeline.backfill.load_protondb_signal_catalog", return_value={}),
        patch("scripts.pipeline.backfill.flush_steam_title_cache"),
    ):
        run_probe_backfill(str(tmp_path))

def test_run_probe_backfill_signal_catalog_error(tmp_path):
    write_pipeline_state(tmp_path, 0, set())
    (tmp_path / "data").mkdir()
    with (
        patch("scripts.pipeline.backfill.read_protondb_probe_cache", return_value={}),
        patch("scripts.pipeline.backfill.load_protondb_signal_catalog", side_effect=Exception("error")),
        patch("scripts.pipeline.backfill.flush_steam_title_cache"),
    ):
        run_probe_backfill(str(tmp_path))


# ── run_backfill ──────────────────────────────────────────────────────────────

def test_run_backfill_with_no_manifest(tmp_path):
    write_pipeline_state(tmp_path, 0, set())
    (tmp_path / "data").mkdir()
    counts = {"reports": 100000, "timestamp": 1700000000}
    with (
        patch("scripts.pipeline.backfill.backfill_missing_apps", return_value=(set(), set())),
        patch("scripts.pipeline.backfill.flush_steam_title_cache"),
    ):
        run_backfill(str(tmp_path))


# ── fetch_live_reports_payload ────────────────────────────────────────────────

from urllib import error as urllib_error
from scripts.pipeline.backfill import fetch_live_reports_payload


def test_fetch_live_reports_http_error_skips(capsys):
    def bad_fetch(url):
        from email.message import Message
        h = Message()
        raise urllib_error.HTTPError(url, 404, "not found", h, None)
    result, resolved = fetch_live_reports_payload("730", ["https://example.com/r.json"], fetch_json_impl=bad_fetch)
    assert result is None
    assert resolved is None

def test_fetch_live_reports_url_error_skips(capsys):
    def bad_fetch(url):
        raise urllib_error.URLError("timeout")
    result, resolved = fetch_live_reports_payload("730", ["https://example.com/r.json"], fetch_json_impl=bad_fetch)
    assert result is None

def test_fetch_live_reports_non_dict_payload_skips(capsys):
    result, resolved = fetch_live_reports_payload("730", ["https://example.com/r.json"], fetch_json_impl=lambda u: [1,2,3])
    assert result is None

def test_fetch_live_reports_success():
    payload = {"reports": []}
    result, resolved = fetch_live_reports_payload("730", ["https://example.com/r.json"], fetch_json_impl=lambda u: payload)
    assert result == payload
    assert resolved == "https://example.com/r.json"


# ── _find_no_title_app_ids ────────────────────────────────────────────────────

from scripts.pipeline.backfill import _find_no_title_app_ids


def test_find_no_title_app_ids_corrupt_latest(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    app_dir = data_dir / "730"
    app_dir.mkdir()
    (app_dir / "latest.json").write_text("not json")
    with (
        patch("scripts.pipeline.backfill.load_protondb_signal_catalog", return_value={}),
        patch("scripts.pipeline.backfill.read_protondb_probe_cache", return_value={}),
        patch("scripts.pipeline.backfill.get_steam_api_key", return_value=None),
    ):
        result = _find_no_title_app_ids(data_dir)
    assert "730" in result

def test_find_no_title_app_ids_empty_title(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    app_dir = data_dir / "730"
    app_dir.mkdir()
    (app_dir / "latest.json").write_text(json.dumps([{"title": ""}]))
    with (
        patch("scripts.pipeline.backfill.load_protondb_signal_catalog", return_value={}),
        patch("scripts.pipeline.backfill.read_protondb_probe_cache", return_value={}),
        patch("scripts.pipeline.backfill.get_steam_api_key", return_value=None),
    ):
        result = _find_no_title_app_ids(data_dir)
    assert "730" in result

def test_find_no_title_app_ids_no_latest(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "730").mkdir()
    with (
        patch("scripts.pipeline.backfill.load_protondb_signal_catalog", return_value={}),
        patch("scripts.pipeline.backfill.read_protondb_probe_cache", return_value={}),
        patch("scripts.pipeline.backfill.get_steam_api_key", return_value=None),
    ):
        result = _find_no_title_app_ids(data_dir)
    assert "730" not in result

def test_find_no_title_app_ids_signal_catalog_error(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    with (
        patch("scripts.pipeline.backfill.load_protondb_signal_catalog", side_effect=OSError("err")),
        patch("scripts.pipeline.backfill.read_protondb_probe_cache", return_value={}),
        patch("scripts.pipeline.backfill.get_steam_api_key", return_value=None),
    ):
        result = _find_no_title_app_ids(data_dir)
    assert result == []

def test_find_no_title_app_ids_with_steam_catalog(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    with (
        patch("scripts.pipeline.backfill.load_protondb_signal_catalog", return_value={}),
        patch("scripts.pipeline.backfill.read_protondb_probe_cache", return_value={}),
        patch("scripts.pipeline.backfill.get_steam_api_key", return_value="KEY"),
        patch("scripts.pipeline.backfill.load_steam_game_catalog", return_value={"99999": ""}),
    ):
        result = _find_no_title_app_ids(data_dir)
    assert "99999" in result

def test_find_no_title_app_ids_steam_catalog_error(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    with (
        patch("scripts.pipeline.backfill.load_protondb_signal_catalog", return_value={}),
        patch("scripts.pipeline.backfill.read_protondb_probe_cache", return_value={}),
        patch("scripts.pipeline.backfill.get_steam_api_key", return_value="KEY"),
        patch("scripts.pipeline.backfill.load_steam_game_catalog", side_effect=OSError("err")),
    ):
        result = _find_no_title_app_ids(data_dir)
    assert result == []


# ── run_coverage_backfill ─────────────────────────────────────────────────────

from scripts.pipeline.backfill import run_coverage_backfill, _patch_titles_on_disk


def test_run_coverage_backfill_bad_app_id(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "bad-id").mkdir()
    write_pipeline_state(tmp_path, 0, set())
    run_coverage_backfill(str(tmp_path), issue_type="bad-app-id")

def test_run_coverage_backfill_unknown_issue_type(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    write_pipeline_state(tmp_path, 0, set())
    run_coverage_backfill(str(tmp_path), issue_type="nonexistent")

def test_run_coverage_backfill_no_titles_empty(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    write_pipeline_state(tmp_path, 0, set())
    with (
        patch("scripts.pipeline.backfill._find_no_title_app_ids", return_value=[]),
    ):
        run_coverage_backfill(str(tmp_path), issue_type="no-titles")

def test_run_coverage_backfill_no_protondb_data_dispatches_run_backfill(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    write_pipeline_state(tmp_path, 0, set())
    with (
        patch("scripts.pipeline.backfill._find_no_protondb_data_app_ids", return_value=["730"]),
        patch("scripts.pipeline.backfill.run_backfill") as mock_run,
    ):
        run_coverage_backfill(str(tmp_path), issue_type="no-protondb-data")
        mock_run.assert_called_once()

def test_run_coverage_backfill_with_limit(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    write_pipeline_state(tmp_path, 0, set())
    with (
        patch("scripts.pipeline.backfill._find_no_protondb_data_app_ids", return_value=["730", "570", "440"]),
        patch("scripts.pipeline.backfill.run_backfill") as mock_run,
    ):
        run_coverage_backfill(str(tmp_path), issue_type="no-protondb-data", limit=1)
        args = mock_run.call_args
        assert args[1]["target_app_ids"] == ["730"]


# ── _patch_titles_on_disk ────────────────────────────────────────────────────

def test_patch_titles_on_disk_skips_unresolvable(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "2024.json").write_text(json.dumps([{"rating": "gold"}]))
    with patch("scripts.pipeline.backfill.fetch_steam_title_with_source", return_value=("", "steam-store-error")):
        result = _patch_titles_on_disk(tmp_path, ["730"])
    assert result == set()

def test_patch_titles_on_disk_patches_year_files(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "2024.json").write_text(json.dumps([{"rating": "gold", "title": ""}]))
    with patch("scripts.pipeline.backfill.fetch_steam_title_with_source", return_value=("CS2", "steam-store")):
        result = _patch_titles_on_disk(tmp_path, ["730"])
    assert ("730", "2024") in result
    reports = json.loads((app_dir / "2024.json").read_text())
    assert reports[0]["title"] == "CS2"


# ── load_backfill_targets: invalid url in reportUrls (line 74) ────────────────

from scripts.pipeline.backfill import load_backfill_targets


def test_load_backfill_targets_invalid_report_url(tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps([
        {"appId": "730", "reportUrls": [""]}  # empty string url
    ]))
    with pytest.raises(ValueError, match="Invalid reportUrls"):
        load_backfill_targets(manifest)


# ── compute_live_report_hash_legacy: TypeError/ValueError branch (line 164) ───

from scripts.pipeline.backfill import compute_live_report_hash_legacy


def test_compute_live_report_hash_legacy_invalid_page():
    result = compute_live_report_hash_legacy(730, 100, 1000, "not-a-number")
    assert isinstance(result, int)


# ── bucket_reports_by_year: bad timestamp branch (lines 314-315) ──────────────

from scripts.pipeline.backfill import bucket_reports_by_year


def test_bucket_reports_by_year_bad_timestamp():
    reports = [{"timestamp": "not-a-ts", "rating": "gold"}]
    result = bucket_reports_by_year(reports)
    assert "unknown" in result


# ── run_backfill: force mode path (lines 366-368) ─────────────────────────────

def test_run_backfill_force_mode(tmp_path):
    write_pipeline_state(tmp_path, 0, set())
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    app_dir = data_dir / "730"
    app_dir.mkdir()
    (app_dir / "2024.json").write_text(json.dumps([{"appId": "730"}]))

    with (
        patch("scripts.pipeline.backfill.fetch_live_reports_payload",
              return_value=({"reports": []}, "https://example.com")),
        patch("scripts.pipeline.backfill.fetch_json",
              return_value={"reports": 100000, "timestamp": 1700000000}),
    ):
        run_backfill(str(tmp_path), target_app_ids=["730"], force=True)


# ── run_backfill: no usable reports path (lines 446-451) ─────────────────────

def test_run_backfill_no_usable_reports(tmp_path):
    write_pipeline_state(tmp_path, 0, set())
    data_dir = tmp_path / "data"
    data_dir.mkdir()

    with (
        patch("scripts.pipeline.backfill.fetch_live_reports_payload",
              return_value=({"reports": []}, "https://example.com")),
        patch("scripts.pipeline.backfill.fetch_json",
              return_value={"reports": 100000, "timestamp": 1700000000}),
    ):
        run_backfill(str(tmp_path), target_app_ids=["999"])


# ── backfill_missing_apps: bad counts payload (lines 393, 403) ────────────────

from scripts.pipeline.backfill import backfill_missing_apps


def test_backfill_missing_apps_non_dict_counts_raises(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    with pytest.raises(ValueError, match="not a JSON object"):
        backfill_missing_apps(
            data_dir,
            fetch_json_impl=lambda url: ["not", "a", "dict"],
            target_app_ids=["730"],
        )


def test_backfill_missing_apps_bad_seeds_raises(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    with pytest.raises(ValueError, match="usable report/timestamp"):
        backfill_missing_apps(
            data_dir,
            fetch_json_impl=lambda url: {"reports": -1, "timestamp": 0},
            target_app_ids=["730"],
        )


# ── compute_live_report_hash_legacy: valid page (line 164 needs page=int) ─────

def test_compute_live_report_hash_legacy_valid_page():
    result = compute_live_report_hash_legacy(730, 100, 1000, 1)
    assert isinstance(result, int)


# ── backfill_probe_discoveries: bad counts payload (lines 566, 576) ───────────

def test_backfill_probe_discoveries_non_dict_counts_raises(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    with pytest.raises(ValueError, match="not a JSON object"):
        backfill_probe_discoveries(
            data_dir,
            probe_catalog={"730": "CS2"},
            fetch_json_impl=lambda url: ["not", "a", "dict"],
        )


def test_backfill_probe_discoveries_bad_seeds_raises(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    with pytest.raises(ValueError, match="usable report/timestamp"):
        backfill_probe_discoveries(
            data_dir,
            probe_catalog={"730": "CS2"},
            fetch_json_impl=lambda url: {"reports": 0, "timestamp": 0},
        )


# ── _find_no_protondb_data_app_ids (lines 821, 826-827, 832-833) ─────────────

from scripts.pipeline.backfill import _find_no_protondb_data_app_ids


def test_find_no_protondb_data_uses_state_no_data_ids(tmp_path):
    """When no_data_app_ids set in state, returns early (line 821)."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    write_pipeline_state(tmp_path, 0, set(), no_data_app_ids={"730", "570"})
    result = _find_no_protondb_data_app_ids(data_dir)
    assert "730" in result
    assert "570" in result


def test_find_no_protondb_data_signal_catalog_error(tmp_path):
    """Signal catalog OSError is swallowed (lines 826-827)."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    write_pipeline_state(tmp_path, 0, set())
    with (
        patch("scripts.pipeline.backfill.load_protondb_signal_catalog", side_effect=OSError("err")),
        patch("scripts.pipeline.backfill.read_protondb_probe_cache", return_value={}),
        patch("scripts.pipeline.backfill.get_steam_api_key", return_value=None),
    ):
        result = _find_no_protondb_data_app_ids(data_dir)
    assert isinstance(result, list)


def test_find_no_protondb_data_probe_cache_error(tmp_path):
    """Probe cache error is swallowed (lines 832-833)."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    write_pipeline_state(tmp_path, 0, set())
    with (
        patch("scripts.pipeline.backfill.load_protondb_signal_catalog", return_value={}),
        patch("scripts.pipeline.backfill.read_protondb_probe_cache", side_effect=OSError("err")),
        patch("scripts.pipeline.backfill.get_steam_api_key", return_value=None),
    ):
        result = _find_no_protondb_data_app_ids(data_dir)
    assert isinstance(result, list)


# ── _patch_titles_on_disk: corrupt year file (lines 899-900) ─────────────────

from scripts.pipeline.backfill import _patch_titles_on_disk


def test_patch_titles_on_disk_corrupt_year_file(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    app_dir = data_dir / "730"
    app_dir.mkdir()
    (app_dir / "2024.json").write_text("not json")
    _patch_titles_on_disk(data_dir, {"730": "CS2"})


# ── backfill_probe_discoveries: unresolved title (lines 607-610) ─────────────

def test_backfill_probe_discoveries_unresolved_title(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    counts_payload = {"reports": 100000, "timestamp": 1700000000}
    live_payload = {"reports": [
        {"timestamp": 1700000000, "responses": {"verdict": "yes", "protonVersion": "9.0"},
         "device": {"inferred": {"steam": {}}}, "contributor": {"steam": {"playtimeLinux": 100}}}
    ]}

    def fake_fetch(url):
        if "counts" in url:
            return counts_payload
        return live_payload

    with patch("scripts.pipeline.backfill.fetch_steam_title_with_source", return_value=("", "no-source")):
        result = backfill_probe_discoveries(
            data_dir, {"730": ""}, limit=1, fetch_json_impl=fake_fetch
        )


# ── backfill_probe_discoveries: no usable reports (lines 614-619) ─────────────

def test_backfill_probe_discoveries_no_usable_reports(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    counts_payload = {"reports": 100000, "timestamp": 1700000000}

    def fake_fetch(url):
        if "counts" in url:
            return counts_payload
        return {"reports": []}

    with patch("scripts.pipeline.backfill.fetch_steam_title_with_source", return_value=("CS2", "steam")):
        result = backfill_probe_discoveries(
            data_dir, {"730": "CS2"}, limit=1, fetch_json_impl=fake_fetch
        )


# ── _find_no_title_app_ids: line 754 (non-dir/non-digit skipped) ──────────────

def test_find_no_title_app_ids_skips_non_digit_dir(tmp_path):
    """Non-digit dir names and files in data/ are skipped (line 754)."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "not-a-number").mkdir()  # non-digit dir
    (data_dir / "file.txt").write_text("x")  # file, not dir
    with (
        patch("scripts.pipeline.backfill.load_protondb_signal_catalog", return_value={}),
        patch("scripts.pipeline.backfill.read_protondb_probe_cache", return_value={}),
        patch("scripts.pipeline.backfill.get_steam_api_key", return_value=None),
    ):
        result = _find_no_title_app_ids(data_dir)
    assert result == []


# ── _find_no_title_app_ids: lines 788/790 (non-digit/existing catalog IDs) ───

def test_find_no_title_app_ids_catalog_non_digit_and_existing(tmp_path):
    """Non-digit catalog IDs skipped (788); IDs with on-disk dir skipped (790)."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "730").mkdir()  # existing -- will be skipped by line 790

    catalog = {
        "not-a-number": "",  # non-digit, hits line 788
        "730": "",           # already on disk, hits line 790
        "570": "",           # missing and empty title, should be added
    }
    with (
        patch("scripts.pipeline.backfill.load_protondb_signal_catalog", return_value=catalog),
        patch("scripts.pipeline.backfill.read_protondb_probe_cache", return_value={}),
        patch("scripts.pipeline.backfill.get_steam_api_key", return_value=None),
    ):
        result = _find_no_title_app_ids(data_dir)
    assert "570" in result
    assert "730" not in result
    assert "not-a-number" not in result


# ── run_coverage_backfill: no-protondb-data with backfill (lines 972-977) ─────

def test_run_coverage_backfill_no_protondb_data_with_backfill(tmp_path):
    """no-protondb-data type with actual IDs triggers backfill_missing_apps (lines 972-977)."""
    from scripts.pipeline.backfill import run_coverage_backfill
    write_pipeline_state(tmp_path, 0, set(), no_data_app_ids={"730"})
    data_dir = tmp_path / "data"
    data_dir.mkdir()

    with (
        patch("scripts.pipeline.backfill.backfill_missing_apps", return_value=(set(), set())) as mock_bma,
    ):
        run_coverage_backfill(str(tmp_path), issue_type="no-protondb-data")
    mock_bma.assert_called_once()


# ── run_coverage_backfill: no-titles with no-data app triggers lines 972-977 ─

def test_run_coverage_backfill_no_titles_no_data_backfill(tmp_path):
    """no-titles type with catalog-only app (no on-disk dir) hits lines 972-977."""
    from scripts.pipeline.backfill import run_coverage_backfill
    write_pipeline_state(tmp_path, 0, set())
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    # 570 has no on-disk directory so it goes into no_data, triggering lines 972-977

    with (
        patch("scripts.pipeline.backfill._find_no_title_app_ids", return_value=["570"]),
        patch("scripts.pipeline.backfill.backfill_missing_apps", return_value=(set(), set())) as mock_bma,
    ):
        run_coverage_backfill(str(tmp_path), issue_type="no-titles")
    mock_bma.assert_called_once()
