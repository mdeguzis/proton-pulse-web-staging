import json
from pathlib import Path

from scripts.pipeline.metadata import (
    app_metadata_path,
    read_app_metadata,
    update_app_metadata,
    _is_live_normalized_report,
    _read_report_samples,
    infer_app_metadata_from_disk,
    bootstrap_app_metadata,
    bootstrap_all_app_metadata,
)


# ── _is_live_normalized_report ────────────────────────────────────────────────

def _live_report(**extra):
    base = {
        "appId": "730",
        "duration": "severalHours",
        "protonVersion": "9.0-4",
        "rating": "gold",
        "timestamp": 1700000000,
        "title": "CS2",
    }
    base.update(extra)
    return base

def test_is_live_normalized_report_true():
    assert _is_live_normalized_report(_live_report()) is True

def test_is_live_normalized_report_missing_required_key():
    r = _live_report()
    del r["rating"]
    assert _is_live_normalized_report(r) is False

def test_is_live_normalized_report_disallowed_key():
    r = _live_report(unknownField="value")
    assert _is_live_normalized_report(r) is False

def test_is_live_normalized_report_extra_allowed():
    r = _live_report(cpu="Intel i7", gpu="RTX 3080")
    assert _is_live_normalized_report(r) is True


# ── _read_report_samples ──────────────────────────────────────────────────────

def test_read_report_samples_basic(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "2023.json").write_text(json.dumps([{"rating": "gold"}]))
    samples = _read_report_samples(app_dir)
    assert len(samples) == 1
    assert samples[0]["rating"] == "gold"

def test_read_report_samples_skips_reserved(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "latest.json").write_text(json.dumps([{"rating": "gold"}]))
    (app_dir / "index.json").write_text('["2023"]')
    (app_dir / "votes.json").write_text("{}")
    (app_dir / "metadata.json").write_text("{}")
    samples = _read_report_samples(app_dir)
    assert samples == []

def test_read_report_samples_corrupt_file(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "2023.json").write_text("not json")
    samples = _read_report_samples(app_dir)
    assert samples == []

def test_read_report_samples_non_list(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "2023.json").write_text(json.dumps({"rating": "gold"}))
    samples = _read_report_samples(app_dir)
    assert samples == []

def test_read_report_samples_empty_list(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "2023.json").write_text("[]")
    samples = _read_report_samples(app_dir)
    assert samples == []


# ── infer_app_metadata_from_disk ─────────────────────────────────────────────

def test_infer_live_from_disk(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    report = _live_report()
    (app_dir / "2023.json").write_text(json.dumps([report]))
    result = infer_app_metadata_from_disk(tmp_path, "730")
    assert result.get("protondb_live") is True

def test_infer_official_from_disk(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    # Report has extra field not in allowed keys -> not live normalized -> official dump
    report = {"appId": "730", "timestamp": 1700000000, "extra_field": "value", "rating": "gold"}
    (app_dir / "2023.json").write_text(json.dumps([report]))
    result = infer_app_metadata_from_disk(tmp_path, "730")
    assert result.get("official_dump") is True

def test_infer_missing_dir(tmp_path):
    result = infer_app_metadata_from_disk(tmp_path, "999")
    assert result == {}

def test_infer_no_samples(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    result = infer_app_metadata_from_disk(tmp_path, "730")
    assert result == {}


# ── bootstrap_app_metadata ────────────────────────────────────────────────────

def test_bootstrap_creates_metadata_file(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "2023.json").write_text(json.dumps([_live_report()]))
    result = bootstrap_app_metadata(tmp_path, "730")
    assert (app_dir / "metadata.json").exists()
    assert isinstance(result, dict)

def test_bootstrap_uses_backfilled_set(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    result = bootstrap_app_metadata(tmp_path, "730", backfilled_app_ids={"730"})
    assert result.get("protondb_live") is True

def test_bootstrap_preserves_existing_flags(tmp_path):
    update_app_metadata(tmp_path, "730", official_dump=True)
    result = bootstrap_app_metadata(tmp_path, "730")
    assert result.get("official_dump") is True


# ── bootstrap_all_app_metadata ────────────────────────────────────────────────

def test_bootstrap_all_processes_multiple(tmp_path):
    for app_id in ["730", "570"]:
        d = tmp_path / app_id
        d.mkdir()
    result = bootstrap_all_app_metadata(tmp_path)
    assert "730" in result
    assert "570" in result

def test_bootstrap_all_skips_files(tmp_path):
    (tmp_path / "not-a-dir.json").write_text("{}")
    result = bootstrap_all_app_metadata(tmp_path)
    assert "not-a-dir.json" not in result


# ── read / update_app_metadata edge cases ─────────────────────────────────────

def test_read_metadata_corrupt_returns_empty(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "metadata.json").write_text("not json")
    assert read_app_metadata(tmp_path, "730") == {}

def test_read_metadata_non_dict_returns_empty(tmp_path):
    app_dir = tmp_path / "730"
    app_dir.mkdir()
    (app_dir / "metadata.json").write_text("[1, 2, 3]")
    assert read_app_metadata(tmp_path, "730") == {}

def test_update_ignores_unknown_flags(tmp_path):
    result = update_app_metadata(tmp_path, "730", fake_flag=True)
    assert "fake_flag" not in result
