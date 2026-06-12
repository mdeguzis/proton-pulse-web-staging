"""Tests for catalog.py utility functions."""
import json
import time
from email.message import Message
from pathlib import Path
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError, URLError

import pytest
import scripts.pipeline.catalog as catalog_module
from scripts.pipeline.catalog import (
    _strip_wrapping_quotes,
    load_dotenv,
    _merged_env,
    get_steam_api_key,
    get_protondb_probe_limit,
    get_protondb_probe_backfill_limit,
    get_protondb_probe_cache_max_age_seconds,
    get_protondb_probe_log_every,
    _read_cached_catalog,
    _write_cached_catalog,
    read_cached_steam_game_catalog,
    write_cached_steam_game_catalog,
    read_protondb_probe_cache,
    write_protondb_probe_cache,
    fetch_protondb_signal_catalog,
    load_protondb_signal_catalog,
    load_steam_game_catalog,
    _is_tracked_protondb_summary,
    _format_duration,
    retry_http,
)
from scripts.pipeline.finalize import probe_cache_to_catalog


def _make_http_error(code, headers=None):
    h = Message()
    for k, v in (headers or {}).items():
        h[k] = v
    return HTTPError("http://example.com", code, "error", h, None)


# ── _strip_wrapping_quotes ────────────────────────────────────────────────────

def test_strip_double_quotes():
    assert _strip_wrapping_quotes('"hello"') == "hello"

def test_strip_single_quotes():
    assert _strip_wrapping_quotes("'hello'") == "hello"

def test_strip_no_quotes():
    assert _strip_wrapping_quotes("hello") == "hello"

def test_strip_mismatched_quotes():
    assert _strip_wrapping_quotes('"hello\'') == '"hello\''

def test_strip_short_string():
    assert _strip_wrapping_quotes("x") == "x"


# ── load_dotenv ───────────────────────────────────────────────────────────────

def test_load_dotenv_missing_file(tmp_path):
    result = load_dotenv(tmp_path / "missing.env")
    assert result == {}

def test_load_dotenv_basic(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("STEAM_API_KEY=abc123\nFOO=bar\n")
    result = load_dotenv(env_file)
    assert result["STEAM_API_KEY"] == "abc123"
    assert result["FOO"] == "bar"

def test_load_dotenv_skips_comments(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("# comment\nKEY=value\n")
    result = load_dotenv(env_file)
    assert "# comment" not in result
    assert result["KEY"] == "value"

def test_load_dotenv_skips_lines_without_equals(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("NOEQUALS\nKEY=value\n")
    result = load_dotenv(env_file)
    assert "NOEQUALS" not in result
    assert result["KEY"] == "value"

def test_load_dotenv_strips_wrapping_quotes(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text('KEY="quoted_value"\n')
    result = load_dotenv(env_file)
    assert result["KEY"] == "quoted_value"


# ── get_steam_api_key ─────────────────────────────────────────────────────────

def test_get_steam_api_key_from_env():
    result = get_steam_api_key({"STEAM_API_KEY": "my-key"})
    assert result == "my-key"

def test_get_steam_api_key_missing():
    result = get_steam_api_key({})
    assert result is None

def test_get_steam_api_key_empty_string():
    result = get_steam_api_key({"STEAM_API_KEY": "  "})
    assert result is None


# ── get_protondb_probe_limit ──────────────────────────────────────────────────

def test_get_probe_limit_from_env():
    assert get_protondb_probe_limit({"PROTONDB_PROBE_LIMIT": "500"}) == 500

def test_get_probe_limit_invalid():
    assert get_protondb_probe_limit({"PROTONDB_PROBE_LIMIT": "bad"}) == 0

def test_get_probe_limit_negative_clamped():
    assert get_protondb_probe_limit({"PROTONDB_PROBE_LIMIT": "-10"}) == 0

def test_get_probe_limit_default():
    assert get_protondb_probe_limit({}) == 0


# ── get_protondb_probe_backfill_limit ─────────────────────────────────────────

def test_get_probe_backfill_limit_from_env():
    assert get_protondb_probe_backfill_limit({"PROTONDB_PROBE_BACKFILL_LIMIT": "100"}) == 100

def test_get_probe_backfill_limit_invalid():
    assert get_protondb_probe_backfill_limit({"PROTONDB_PROBE_BACKFILL_LIMIT": "xyz"}) == 0


# ── get_protondb_probe_cache_max_age_seconds ──────────────────────────────────

def test_get_probe_cache_max_age_default():
    result = get_protondb_probe_cache_max_age_seconds({})
    assert result == 90 * 24 * 60 * 60

def test_get_probe_cache_max_age_custom():
    result = get_protondb_probe_cache_max_age_seconds({"PROTONDB_PROBE_CACHE_MAX_AGE_DAYS": "30"})
    assert result == 30 * 24 * 60 * 60

def test_get_probe_cache_max_age_invalid():
    result = get_protondb_probe_cache_max_age_seconds({"PROTONDB_PROBE_CACHE_MAX_AGE_DAYS": "bad"})
    assert result == 90 * 24 * 60 * 60


# ── get_protondb_probe_log_every ──────────────────────────────────────────────

def test_get_probe_log_every_from_env():
    assert get_protondb_probe_log_every({"PROTONDB_PROBE_LOG_EVERY": "100"}) == 100

def test_get_probe_log_every_invalid():
    assert get_protondb_probe_log_every({"PROTONDB_PROBE_LOG_EVERY": "bad"}) == 250

def test_get_probe_log_every_clamped_to_one():
    assert get_protondb_probe_log_every({"PROTONDB_PROBE_LOG_EVERY": "0"}) == 1


# ── _read_cached_catalog ──────────────────────────────────────────────────────

def test_read_cached_catalog_missing(tmp_path):
    result = _read_cached_catalog(tmp_path / "missing.json", 86400, "test")
    assert result is None

def test_read_cached_catalog_corrupt(tmp_path):
    f = tmp_path / "cache.json"
    f.write_text("not json")
    result = _read_cached_catalog(f, 86400, "test")
    assert result is None

def test_read_cached_catalog_expired(tmp_path):
    f = tmp_path / "cache.json"
    f.write_text(json.dumps({"fetched_at": 1, "apps": {"730": "CS2"}}))
    result = _read_cached_catalog(f, 60, "test")
    assert result is None

def test_read_cached_catalog_fresh(tmp_path):
    f = tmp_path / "cache.json"
    now = int(time.time())
    f.write_text(json.dumps({"fetched_at": now, "apps": {"730": "CS2"}}))
    result = _read_cached_catalog(f, 86400, "test")
    assert result == {"730": "CS2"}

def test_read_cached_catalog_filters_non_numeric(tmp_path):
    f = tmp_path / "cache.json"
    now = int(time.time())
    f.write_text(json.dumps({"fetched_at": now, "apps": {"730": "CS2", "abc": "Bad"}}))
    result = _read_cached_catalog(f, 86400, "test")
    assert "abc" not in (result or {})
    assert "730" in (result or {})

def test_read_cached_catalog_empty_returns_none(tmp_path):
    f = tmp_path / "cache.json"
    now = int(time.time())
    f.write_text(json.dumps({"fetched_at": now, "apps": {}}))
    result = _read_cached_catalog(f, 86400, "test")
    assert result is None

def test_read_cached_catalog_invalid_apps_type(tmp_path):
    f = tmp_path / "cache.json"
    now = int(time.time())
    f.write_text(json.dumps({"fetched_at": now, "apps": ["not", "a", "dict"]}))
    result = _read_cached_catalog(f, 86400, "test")
    assert result is None

def test_read_cached_catalog_zero_fetched_at(tmp_path):
    f = tmp_path / "cache.json"
    f.write_text(json.dumps({"fetched_at": 0, "apps": {"730": "CS2"}}))
    result = _read_cached_catalog(f, 86400, "test")
    assert result is None


# ── _write_cached_catalog ─────────────────────────────────────────────────────

def test_write_cached_catalog(tmp_path):
    f = tmp_path / "out" / "cache.json"
    _write_cached_catalog({"730": "CS2"}, f)
    assert f.exists()
    data = json.loads(f.read_text())
    assert data["apps"]["730"] == "CS2"
    assert "fetched_at" in data


# ── read_protondb_probe_cache ─────────────────────────────────────────────────

def test_read_probe_cache_missing(tmp_path):
    result = read_protondb_probe_cache(tmp_path / "missing.json", max_age_seconds=86400)
    assert result == {}

def test_read_probe_cache_corrupt(tmp_path):
    f = tmp_path / "cache.json"
    f.write_text("bad json")
    result = read_protondb_probe_cache(f, max_age_seconds=86400)
    assert result == {}

def test_read_probe_cache_fresh_tracked(tmp_path):
    f = tmp_path / "cache.json"
    now = int(time.time())
    f.write_text(json.dumps({
        "apps": {"730": {"tracked": True, "title": "CS2", "checked_at": now}}
    }))
    result = read_protondb_probe_cache(f, max_age_seconds=86400)
    assert "730" in result
    assert result["730"]["tracked"] is True

def test_read_probe_cache_expired_filtered(tmp_path):
    f = tmp_path / "cache.json"
    f.write_text(json.dumps({
        "apps": {"730": {"tracked": True, "title": "CS2", "checked_at": 1}}
    }))
    result = read_protondb_probe_cache(f, max_age_seconds=60)
    assert "730" not in result

def test_read_probe_cache_invalid_apps(tmp_path):
    f = tmp_path / "cache.json"
    f.write_text(json.dumps({"apps": ["not", "a", "dict"]}))
    result = read_protondb_probe_cache(f, max_age_seconds=86400)
    assert result == {}

def test_read_probe_cache_non_numeric_skipped(tmp_path):
    f = tmp_path / "cache.json"
    now = int(time.time())
    f.write_text(json.dumps({
        "apps": {"abc": {"tracked": True, "checked_at": now}}
    }))
    result = read_protondb_probe_cache(f, max_age_seconds=86400)
    assert "abc" not in result


# ── write_protondb_probe_cache ────────────────────────────────────────────────

def test_write_probe_cache(tmp_path):
    f = tmp_path / "out" / "probe.json"
    write_protondb_probe_cache({"730": {"tracked": True}}, f)
    assert f.exists()
    data = json.loads(f.read_text())
    assert "apps" in data
    assert data["apps"]["730"]["tracked"] is True


# ── probe_cache_to_catalog ────────────────────────────────────────────────────

def test_probe_cache_to_catalog_basic():
    cache = {
        "730": {"tracked": True, "title": "CS2"},
        "570": {"tracked": False, "title": "Dota 2"},
    }
    result = probe_cache_to_catalog(cache)
    assert "730" in result
    assert "570" not in result

def test_probe_cache_to_catalog_empty():
    assert probe_cache_to_catalog({}) == {}


# ── _is_tracked_protondb_summary ──────────────────────────────────────────────

def test_is_tracked_with_total():
    assert _is_tracked_protondb_summary({"total": 5}) is True

def test_is_tracked_with_zero_total():
    assert _is_tracked_protondb_summary({"total": 0}) is False

def test_is_tracked_with_tier():
    assert _is_tracked_protondb_summary({"tier": "gold"}) is True

def test_is_tracked_with_confidence():
    assert _is_tracked_protondb_summary({"confidence": "weak"}) is True

def test_is_tracked_not_dict():
    assert _is_tracked_protondb_summary("not a dict") is False

def test_is_tracked_empty():
    assert _is_tracked_protondb_summary({}) is False


# ── _format_duration ──────────────────────────────────────────────────────────

def test_format_duration_seconds():
    assert _format_duration(45.0) == "45s"

def test_format_duration_minutes():
    assert _format_duration(90.0) == "1m 30s"

def test_format_duration_hours():
    assert _format_duration(3723.0) == "1h 2m"


# ── retry_http decorator ──────────────────────────────────────────────────────

def test_retry_http_succeeds_first_try():
    @retry_http(attempts=3)
    def ok():
        return "done"
    assert ok() == "done"

def test_retry_http_raises_on_404():
    @retry_http(attempts=3)
    def fn():
        raise _make_http_error(404)
    with pytest.raises(HTTPError) as exc_info:
        fn()
    assert exc_info.value.code == 404

def test_retry_http_retries_on_500():
    call_count = 0

    @retry_http(attempts=3, base_delay_seconds=0)
    def fn():
        nonlocal call_count
        call_count += 1
        raise _make_http_error(500)

    with pytest.raises(HTTPError):
        fn()
    assert call_count == 3

def test_retry_http_429_with_retry_after():
    call_count = 0

    @retry_http(attempts=2, base_delay_seconds=0, max_delay_seconds=0)
    def fn():
        nonlocal call_count
        call_count += 1
        raise _make_http_error(429, {"Retry-After": "0.01"})

    with patch("time.sleep"):
        with pytest.raises(HTTPError):
            fn()
    assert call_count == 2


# ── fetch_protondb_signal_catalog ─────────────────────────────────────────────

def test_fetch_protondb_signal_catalog_basic():
    payload = {
        "proton": {
            "games": [
                {"appId": "730", "title": "CS2"},
                {"appId": "570", "title": "Dota 2"},
            ]
        }
    }
    result = fetch_protondb_signal_catalog(fetch_json_impl=lambda url: payload)
    assert "730" in result
    assert result["730"] == "CS2"

def test_fetch_protondb_signal_catalog_non_dict_raises():
    with pytest.raises(ValueError):
        fetch_protondb_signal_catalog(fetch_json_impl=lambda url: [1, 2, 3])

def test_fetch_protondb_signal_catalog_skips_non_numeric():
    payload = {"proton": {"games": [{"appId": "abc", "title": "Bad"}]}}
    result = fetch_protondb_signal_catalog(fetch_json_impl=lambda url: payload)
    assert "abc" not in result

def test_fetch_protondb_signal_catalog_skips_non_dict_section():
    payload = {"proton": ["not", "a", "dict"]}
    result = fetch_protondb_signal_catalog(fetch_json_impl=lambda url: payload)
    assert result == {}


# ── load_protondb_signal_catalog ──────────────────────────────────────────────

def test_load_protondb_signal_catalog_uses_cache(tmp_path):
    catalog_module._signal_catalog_memo = None
    now = int(time.time())
    cache_path = tmp_path / "signal.json"
    cache_path.write_text(json.dumps({"fetched_at": now, "apps": {"730": "CS2"}}))
    result = load_protondb_signal_catalog(cache_path=cache_path)
    assert "730" in result
    catalog_module._signal_catalog_memo = None

def test_load_protondb_signal_catalog_fetches_on_miss(tmp_path):
    catalog_module._signal_catalog_memo = None
    payload = {"proton": {"games": [{"appId": "730", "title": "CS2"}]}}
    cache_path = tmp_path / "signal.json"
    result = load_protondb_signal_catalog(
        fetch_json_impl=lambda url: payload,
        cache_path=cache_path,
    )
    assert "730" in result
    catalog_module._signal_catalog_memo = None

def test_load_protondb_signal_catalog_returns_memo():
    catalog_module._signal_catalog_memo = {"999": "Memoized"}
    result = load_protondb_signal_catalog()
    assert result == {"999": "Memoized"}
    catalog_module._signal_catalog_memo = None


# ── load_steam_game_catalog (with mock) ───────────────────────────────────────

def test_load_steam_game_catalog_uses_memo():
    catalog_module._steam_catalog_memo = {"730": "CS2"}
    result = load_steam_game_catalog("any-key")
    assert result == {"730": "CS2"}
    catalog_module._steam_catalog_memo = None

def test_load_steam_game_catalog_uses_disk_cache(tmp_path):
    catalog_module._steam_catalog_memo = None
    now = int(time.time())
    cache_path = tmp_path / "cache.json"
    cache_path.write_text(json.dumps({"fetched_at": now, "apps": {"730": "CS2"}}))
    result = load_steam_game_catalog("key", cache_path=cache_path)
    assert "730" in result
    catalog_module._steam_catalog_memo = None

def test_load_steam_game_catalog_fetches_on_miss(tmp_path):
    catalog_module._steam_catalog_memo = None
    cache_path = tmp_path / "cache.json"

    mock_scraper = MagicMock()
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "response": {
            "apps": [{"appid": 730, "name": "Counter-Strike 2"}],
            "have_more_results": False,
        }
    }
    mock_scraper.DoRequest.return_value = mock_response

    result = load_steam_game_catalog(
        "key", cache_path=cache_path, scraper_module=mock_scraper
    )
    assert "730" in result
    catalog_module._steam_catalog_memo = None


# ── Additional retry_http coverage ────────────────────────────────────────────

def test_retry_http_429_invalid_retry_after():
    """Invalid Retry-After header triggers TypeError/ValueError branch (line 136-137)."""
    call_count = 0

    @retry_http(attempts=2, base_delay_seconds=0, max_delay_seconds=0)
    def fn():
        nonlocal call_count
        call_count += 1
        raise _make_http_error(429, {"Retry-After": "not-a-number"})

    with patch("time.sleep"):
        with pytest.raises(HTTPError):
            fn()
    assert call_count == 2


def test_retry_http_urlError_retries():
    """URLError is caught and retried (line 146-147)."""
    call_count = 0

    @retry_http(attempts=2, base_delay_seconds=0)
    def fn():
        nonlocal call_count
        call_count += 1
        raise URLError("network down")

    with patch("time.sleep"):
        with pytest.raises(URLError):
            fn()
    assert call_count == 2


# ── fetch_steam_game_catalog edge cases ───────────────────────────────────────

from scripts.pipeline.catalog import fetch_steam_game_catalog


def test_fetch_steam_game_catalog_response_none_raises():
    """DoRequest returning None raises ValueError (line 270)."""
    mock_scraper = MagicMock()
    mock_scraper.DoRequest.return_value = None
    with pytest.raises(ValueError, match="no response"):
        fetch_steam_game_catalog("key", scraper_module=mock_scraper)


def test_fetch_steam_game_catalog_non_list_apps_raises():
    """apps being a non-list raises ValueError (line 276)."""
    mock_scraper = MagicMock()
    mock_response = MagicMock()
    mock_response.json.return_value = {"response": {"apps": "not-a-list"}}
    mock_scraper.DoRequest.return_value = mock_response
    with pytest.raises(ValueError, match="missing apps array"):
        fetch_steam_game_catalog("key", scraper_module=mock_scraper)


def test_fetch_steam_game_catalog_non_dict_app_skipped():
    """Non-dict app entries are skipped (line 281)."""
    mock_scraper = MagicMock()
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "response": {"apps": ["not-a-dict", {"appid": 730, "name": "CS2"}], "have_more_results": False}
    }
    mock_scraper.DoRequest.return_value = mock_response
    result = fetch_steam_game_catalog("key", scraper_module=mock_scraper)
    assert "730" in result


def test_fetch_steam_game_catalog_pagination_stalls_raises():
    """Pagination not advancing raises ValueError (line 295)."""
    mock_scraper = MagicMock()
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "response": {
            "apps": [{"appid": 730, "name": "CS2"}],
            "have_more_results": True,
            "last_appid": None,  # stalled pagination
        }
    }
    mock_scraper.DoRequest.return_value = mock_response
    with pytest.raises(ValueError, match="did not advance"):
        fetch_steam_game_catalog("key", scraper_module=mock_scraper)


# ── fetch_protondb_signal_catalog skips non-dict sections ────────────────────

from scripts.pipeline.catalog import fetch_protondb_signal_catalog as _fpsc


def test_fetch_protondb_signal_catalog_non_dict_section_skipped():
    """Non-dict section skipped (line 347)."""
    payload = {"proton": "not-a-dict"}
    result = _fpsc(fetch_json_impl=lambda url: payload)
    assert result == {}


def test_fetch_protondb_signal_catalog_non_list_games_skipped():
    """Non-list games skipped (line 350)."""
    payload = {"proton": {"games": "not-a-list"}}
    result = _fpsc(fetch_json_impl=lambda url: payload)
    assert result == {}


# ── probe_protondb_app_ids edge cases ─────────────────────────────────────────

from scripts.pipeline.catalog import probe_protondb_app_ids, fetch_protondb_summary


def test_probe_protondb_app_ids_all_cached_returns_early():
    """All candidates already in cache returns early (lines 491-492)."""
    cache = {"730": {"tracked": True, "title": "CS2", "ts": 999}}
    result_cache, catalog = probe_protondb_app_ids(
        ["730"], existing_cache=cache, write_cache_impl=lambda c, p=None: None
    )
    assert "730" in catalog


def test_probe_protondb_app_ids_non_404_http_error_reraises():
    """Non-404 HTTPError increments failed and re-raises (lines 509-510)."""
    def bad_fetch(app_id, fetch_json_impl=None):
        raise _make_http_error(500)

    with pytest.raises(HTTPError):
        probe_protondb_app_ids(
            ["730"],
            fetch_json_impl=bad_fetch,
            write_cache_impl=lambda c, p=None: None,
        )


def test_fetch_protondb_signal_catalog_skips_non_dict_game():
    """Non-dict game entry in games list is skipped (line 350)."""
    payload = {"proton": {"games": ["not-a-dict", {"appId": "730", "title": "CS2"}]}}
    result = _fpsc(fetch_json_impl=lambda url: payload)
    assert "730" in result


def test_retry_http_exhausted_without_exception():
    """retry_http with attempts=0 raises RuntimeError (line 161)."""
    @retry_http(attempts=0)
    def fn():
        return "ok"
    with pytest.raises(RuntimeError, match="exhausted"):
        fn()
