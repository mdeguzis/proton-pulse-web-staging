"""Tests for process.py parse_and_split and process_reports functions.

ijson is mocked via conftest.py; we configure ijson.items.return_value
to inject synthetic report data.
"""
import io
import json
import sys
import tarfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from scripts.pipeline.process import (
    parse_and_split,
    process_reports,
    DEFAULT_TARBALL_CACHE_PATH,
)
import scripts.pipeline.process as _proc_module

# Use the ijson reference that process.py actually bound at import time,
# not sys.modules['ijson'] which may have been replaced by test_process_cache.py.
_ijson_mock = _proc_module.ijson


def _set_reports(reports):
    """Make ijson.items() return the given list of reports."""
    _ijson_mock.items.return_value = iter(reports)


# ── parse_and_split ───────────────────────────────────────────────────────────

def test_parse_and_split_basic(tmp_path):
    _set_reports([{"appId": "730", "timestamp": 1704067200, "rating": "gold"}])
    count, keys = parse_and_split(io.BytesIO(b""), tmp_path)
    assert count == 1
    assert ("730", "2024") in keys
    assert (tmp_path / "730" / "2024.json").exists()

def test_parse_and_split_skips_missing_app_id(tmp_path):
    _set_reports([{"timestamp": 1704067200, "rating": "gold"}])
    count, keys = parse_and_split(io.BytesIO(b""), tmp_path)
    assert count == 0
    assert keys == set()

def test_parse_and_split_skips_non_numeric_app_id(tmp_path):
    _set_reports([{"appId": "abc", "timestamp": 1704067200}])
    count, keys = parse_and_split(io.BytesIO(b""), tmp_path)
    assert count == 0

def test_parse_and_split_tags_source_protondb(tmp_path):
    _set_reports([{"appId": "730", "timestamp": 1704067200}])
    parse_and_split(io.BytesIO(b""), tmp_path)
    reports = json.loads((tmp_path / "730" / "2024.json").read_text())
    assert reports[0]["source"] == "protondb"

def test_parse_and_split_does_not_overwrite_existing_source(tmp_path):
    _set_reports([{"appId": "730", "timestamp": 1704067200, "source": "custom"}])
    parse_and_split(io.BytesIO(b""), tmp_path)
    reports = json.loads((tmp_path / "730" / "2024.json").read_text())
    assert reports[0]["source"] == "custom"

def test_parse_and_split_deduplicates_by_timestamp(tmp_path):
    report = {"appId": "730", "timestamp": 1704067200}
    _set_reports([report])
    parse_and_split(io.BytesIO(b""), tmp_path)
    # second call with same timestamp should not add duplicate
    _set_reports([report])
    parse_and_split(io.BytesIO(b""), tmp_path)
    reports = json.loads((tmp_path / "730" / "2024.json").read_text())
    assert len(reports) == 1

def test_parse_and_split_appends_new_reports(tmp_path):
    _set_reports([{"appId": "730", "timestamp": 1704067200}])
    parse_and_split(io.BytesIO(b""), tmp_path)
    _set_reports([{"appId": "730", "timestamp": 1704067300}])
    parse_and_split(io.BytesIO(b""), tmp_path)
    reports = json.loads((tmp_path / "730" / "2024.json").read_text())
    assert len(reports) == 2

def test_parse_and_split_unknown_year_for_none_timestamp(tmp_path):
    _set_reports([{"appId": "730", "timestamp": None}])
    count, keys = parse_and_split(io.BytesIO(b""), tmp_path)
    assert count == 1
    assert ("730", "unknown") in keys

def test_parse_and_split_handles_bad_timestamp(tmp_path):
    _set_reports([{"appId": "730", "timestamp": "not-a-number"}])
    count, keys = parse_and_split(io.BytesIO(b""), tmp_path)
    assert count == 1
    assert ("730", "unknown") in keys

def test_parse_and_split_multiple_apps(tmp_path):
    _set_reports([
        {"appId": "730", "timestamp": 1704067200},
        {"appId": "570", "timestamp": 1704067200},
    ])
    count, keys = parse_and_split(io.BytesIO(b""), tmp_path)
    assert count == 2
    assert ("730", "2024") in keys
    assert ("570", "2024") in keys

def test_parse_and_split_backfills_source_on_existing(tmp_path):
    existing_dir = tmp_path / "730"
    existing_dir.mkdir()
    (existing_dir / "2024.json").write_text(
        json.dumps([{"appId": "730", "timestamp": 1000}])
    )
    _set_reports([{"appId": "730", "timestamp": 1704067200}])
    parse_and_split(io.BytesIO(b""), tmp_path)
    reports = json.loads((existing_dir / "2024.json").read_text())
    # Legacy entry should now have source backfilled
    legacy = next(r for r in reports if r["timestamp"] == 1000)
    assert legacy["source"] == "protondb"

def test_parse_and_split_handles_corrupt_year_file(tmp_path):
    existing_dir = tmp_path / "730"
    existing_dir.mkdir()
    (existing_dir / "2024.json").write_text("not valid json")
    _set_reports([{"appId": "730", "timestamp": 1704067200}])
    count, keys = parse_and_split(io.BytesIO(b""), tmp_path)
    assert count == 1


# ── process_reports ───────────────────────────────────────────────────────────

def test_process_reports_missing_input_dir(tmp_path):
    with pytest.raises(SystemExit):
        process_reports(str(tmp_path / "missing"), str(tmp_path / "out"))

def test_process_reports_processes_json_files(tmp_path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    (input_dir / "reports.json").write_text(
        json.dumps([{"appId": "730", "timestamp": 1704067200}])
    )
    _set_reports([{"appId": "730", "timestamp": 1704067200}])

    with patch("scripts.pipeline.process._write_tarball_cache"):
        process_reports(str(input_dir), str(tmp_path / "out"))

    assert (tmp_path / "out" / "data" / "730").is_dir()

def test_process_reports_no_output_raises(tmp_path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    _set_reports([])
    with (
        patch("scripts.pipeline.process._write_tarball_cache"),
        pytest.raises(SystemExit),
    ):
        process_reports(str(input_dir), str(tmp_path / "out"))

def test_process_reports_skips_cached_tarballs(tmp_path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    tar_path = input_dir / "reports.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        pass  # empty tarball
    cache_key = f"reports.tar.gz:{tar_path.stat().st_size}"

    _set_reports([])
    with (
        patch("scripts.pipeline.process._read_tarball_cache", return_value={cache_key}),
        patch("scripts.pipeline.process._write_tarball_cache"),
    ):
        # Cached tarball + no json = parsed_count==0 but tarball_cache is non-empty,
        # so no SystemExit; the function completes successfully.
        process_reports(str(input_dir), str(tmp_path / "out"))


def test_process_reports_logs_extra_files(tmp_path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    # Create 22 dummy files to trigger the "... and N more" log at line 208
    for i in range(22):
        (input_dir / f"file{i:02d}.txt").write_text("dummy")
    # Also need one JSON so parse doesn't raise
    _set_reports([{"appId": "730", "timestamp": 1704067200}])
    (input_dir / "reports.json").write_text("[]")
    with patch("scripts.pipeline.process._write_tarball_cache"):
        process_reports(str(input_dir), str(tmp_path / "out"))


def test_process_reports_processes_tarball(tmp_path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    import tarfile as tf
    import io as _io
    # Create a tarball with a JSON member
    json_data = json.dumps([{"appId": "730", "timestamp": 1704067200}]).encode()
    tar_path = input_dir / "reports.tar.gz"
    with tf.open(tar_path, "w:gz") as tar:
        info = tf.TarInfo(name="sample.json")
        info.size = len(json_data)
        tar.addfile(info, _io.BytesIO(json_data))

    _set_reports([{"appId": "730", "timestamp": 1704067200}])
    with patch("scripts.pipeline.process._write_tarball_cache"):
        process_reports(str(input_dir), str(tmp_path / "out"))
    assert (tmp_path / "out" / "data" / "730").is_dir()


# ── seed_official_dump_metadata ──────────────────────────────────────────────

from scripts.pipeline.process import seed_official_dump_metadata, _iter_app_ids_from_stream
import io as _io2


def test_iter_app_ids_from_stream_yields_numeric():
    """_iter_app_ids_from_stream yields only numeric appIds from ijson stream."""
    data = [
        {"appId": "730"},
        {"appId": "abc"},  # non-numeric, skipped
        {"appId": "570"},
    ]
    _ijson_mock.items.return_value = iter(data)
    result = list(_iter_app_ids_from_stream(_io2.BytesIO(b"")))
    assert result == ["730", "570"]


def test_seed_official_dump_metadata_with_json_file(tmp_path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    (input_dir / "reports.json").write_text("[]")
    _ijson_mock.items.return_value = iter([{"appId": "730"}])
    seed_official_dump_metadata(str(input_dir), str(tmp_path / "out"))
    assert (tmp_path / "out" / "data" / "730" / "metadata.json").exists()


def test_seed_official_dump_metadata_with_tarball(tmp_path):
    import tarfile as tf
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    json_data = b'[{"appId":"730"}]'
    tar_path = input_dir / "dump.tar.gz"
    with tf.open(tar_path, "w:gz") as tar:
        info = tf.TarInfo(name="dump.json")
        info.size = len(json_data)
        tar.addfile(info, _io2.BytesIO(json_data))
    _ijson_mock.items.return_value = iter([{"appId": "730"}])
    seed_official_dump_metadata(str(input_dir), str(tmp_path / "out"))
    assert (tmp_path / "out" / "data" / "730" / "metadata.json").exists()


def test_process_reports_handles_corrupt_tarball(tmp_path):
    """Corrupt tarball is caught and logged, does not raise."""
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    # Write a file that looks like a tarball but is corrupt
    (input_dir / "bad.tar.gz").write_bytes(b"not a valid tarball")
    _set_reports([{"appId": "730", "timestamp": 1704067200}])
    (input_dir / "reports.json").write_text("[]")
    with patch("scripts.pipeline.process._write_tarball_cache"):
        process_reports(str(input_dir), str(tmp_path / "out"))
