"""Tests for process.py functions that don't require ijson."""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Mock ijson at the module level before importing anything from process
sys.modules['ijson'] = MagicMock()

from scripts.pipeline.process import (
    _tarball_key,
    _read_tarball_cache,
    _write_tarball_cache,
    DEFAULT_TARBALL_CACHE_PATH,
)


# ── _tarball_key ──────────────────────────────────────────────────────────────

def test_tarball_key_format(tmp_path):
    f = tmp_path / "reports-2024.tar.gz"
    f.write_text("dummy")
    key = _tarball_key(f)
    assert "reports-2024.tar.gz" in key
    assert ":" in key

def test_tarball_key_includes_size(tmp_path):
    f = tmp_path / "reports.tar.gz"
    f.write_bytes(b"x" * 100)
    key = _tarball_key(f)
    assert ":100" in key

def test_tarball_key_same_name_different_size(tmp_path):
    f1 = tmp_path / "reports.tar.gz"
    f1.write_bytes(b"x" * 100)
    key1 = _tarball_key(f1)
    f1.write_bytes(b"x" * 200)
    key2 = _tarball_key(f1)
    assert key1 != key2


# ── _read_tarball_cache ───────────────────────────────────────────────────────

def test_read_tarball_cache_missing_returns_empty(tmp_path):
    with patch("scripts.pipeline.process.DEFAULT_TARBALL_CACHE_PATH", tmp_path / "missing.json"):
        result = _read_tarball_cache()
    assert result == set()

def test_read_tarball_cache_reads_existing(tmp_path):
    cache_path = tmp_path / "cache.json"
    cache_path.write_text(json.dumps(["key1", "key2"]))
    with patch("scripts.pipeline.process.DEFAULT_TARBALL_CACHE_PATH", cache_path):
        result = _read_tarball_cache()
    assert result == {"key1", "key2"}

def test_read_tarball_cache_corrupt_returns_empty(tmp_path):
    cache_path = tmp_path / "cache.json"
    cache_path.write_text("not json")
    with patch("scripts.pipeline.process.DEFAULT_TARBALL_CACHE_PATH", cache_path):
        result = _read_tarball_cache()
    assert result == set()


# ── _write_tarball_cache ──────────────────────────────────────────────────────

def test_write_tarball_cache_creates_file(tmp_path):
    cache_path = tmp_path / "sub" / "cache.json"
    with patch("scripts.pipeline.process.DEFAULT_TARBALL_CACHE_PATH", cache_path):
        _write_tarball_cache({"key1", "key2"})
    assert cache_path.exists()
    data = json.loads(cache_path.read_text())
    assert sorted(data) == ["key1", "key2"]

def test_write_tarball_cache_sorted(tmp_path):
    cache_path = tmp_path / "cache.json"
    with patch("scripts.pipeline.process.DEFAULT_TARBALL_CACHE_PATH", cache_path):
        _write_tarball_cache({"zzz", "aaa", "mmm"})
    data = json.loads(cache_path.read_text())
    assert data == sorted(data)

def test_write_then_read_roundtrip(tmp_path):
    cache_path = tmp_path / "cache.json"
    keys = {"reports-2024.tar.gz:1024", "reports-2023.tar.gz:2048"}
    with patch("scripts.pipeline.process.DEFAULT_TARBALL_CACHE_PATH", cache_path):
        _write_tarball_cache(keys)
        result = _read_tarball_cache()
    assert result == keys
