"""Tests for the data-versions.json manifest generator (issue #119)."""
import json

from scripts.pipeline.data_versions import _hash8, write_data_versions_json


def test_hash_changes_when_content_changes(tmp_path):
    f = tmp_path / "x.json"
    f.write_text("alpha")
    a = _hash8(f)
    f.write_text("beta")
    b = _hash8(f)
    assert a != b
    assert len(a) == 8


def test_writes_manifest_for_present_files_only(tmp_path):
    (tmp_path / "search-index.json").write_text("[]")
    (tmp_path / "stats.json").write_text("{}")
    # nonsteam-images.json intentionally absent
    write_data_versions_json(tmp_path)
    out = json.loads((tmp_path / "data-versions.json").read_text())
    assert "search-index.json" in out
    assert "stats.json" in out
    assert "nonsteam-images.json" not in out
    # All hashes are 8 hex chars
    for v in out.values():
        assert len(v) == 8
        int(v, 16)


def test_manifest_is_deterministic_for_same_input(tmp_path):
    (tmp_path / "search-index.json").write_text('[["1","Half-Life"]]')
    write_data_versions_json(tmp_path)
    first = json.loads((tmp_path / "data-versions.json").read_text())
    write_data_versions_json(tmp_path)
    second = json.loads((tmp_path / "data-versions.json").read_text())
    assert first == second


def test_empty_output_dir_writes_empty_manifest(tmp_path):
    write_data_versions_json(tmp_path)
    out = json.loads((tmp_path / "data-versions.json").read_text())
    assert out == {}
