import pytest
from unittest.mock import patch, MagicMock
from scripts.pipeline.cli import _parse_app_ids, build_parser


# ── _parse_app_ids ────────────────────────────────────────────────────────────

def test_parse_app_ids_none():
    assert _parse_app_ids(None) is None

def test_parse_app_ids_empty_string():
    assert _parse_app_ids("") is None

def test_parse_app_ids_whitespace():
    assert _parse_app_ids("  ") is None

def test_parse_app_ids_single():
    assert _parse_app_ids("730") == ["730"]

def test_parse_app_ids_multiple():
    assert _parse_app_ids("730,570,440") == ["730", "570", "440"]

def test_parse_app_ids_strips_whitespace():
    assert _parse_app_ids("730, 570 , 440") == ["730", "570", "440"]

def test_parse_app_ids_filters_non_numeric():
    assert _parse_app_ids("730,abc,570") == ["730", "570"]

def test_parse_app_ids_all_invalid():
    assert _parse_app_ids("abc,def") is None

def test_parse_app_ids_mixed_valid_invalid():
    result = _parse_app_ids("730,bad,570")
    assert result == ["730", "570"]


# ── build_parser ──────────────────────────────────────────────────────────────

def test_build_parser_returns_parser():
    parser = build_parser()
    assert parser is not None

def test_parser_finalize_subcommand():
    parser = build_parser()
    args = parser.parse_args(["finalize", "/tmp/out"])
    assert args.command == "finalize"
    assert args.output_dir == "/tmp/out"

def test_parser_finalize_skip_probe():
    parser = build_parser()
    args = parser.parse_args(["finalize", "--skip-probe", "/tmp/out"])
    assert args.skip_probe is True

def test_parser_backfill_subcommand():
    parser = build_parser()
    args = parser.parse_args(["backfill", "/tmp/out"])
    assert args.command == "backfill"

def test_parser_backfill_with_app_ids():
    parser = build_parser()
    args = parser.parse_args(["backfill", "--app-ids", "730,570", "/tmp/out"])
    assert args.app_ids == "730,570"

def test_parser_probe_subcommand():
    parser = build_parser()
    args = parser.parse_args(["probe", "/tmp/out"])
    assert args.command == "probe"

def test_parser_probe_plan_subcommand():
    parser = build_parser()
    args = parser.parse_args(["probe-plan", "/tmp/out"])
    assert args.command == "probe-plan"

def test_parser_probe_backfill_subcommand():
    parser = build_parser()
    args = parser.parse_args(["probe-backfill", "/tmp/out"])
    assert args.command == "probe-backfill"

def test_parser_reindex_subcommand():
    parser = build_parser()
    args = parser.parse_args(["reindex", "--app-ids", "730", "/tmp/out"])
    assert args.command == "reindex"
    assert args.app_ids == "730"

def test_parser_most_played_subcommand():
    parser = build_parser()
    args = parser.parse_args(["most-played", "/tmp/out"])
    assert args.command == "most-played"

def test_parser_most_played_limit():
    parser = build_parser()
    args = parser.parse_args(["most-played", "--limit", "50", "/tmp/out"])
    assert args.limit == 50

def test_parser_coverage_backfill():
    parser = build_parser()
    args = parser.parse_args(["coverage-backfill", "--issue-type", "no-titles", "/tmp/out"])
    assert args.command == "coverage-backfill"
    assert args.issue_type == "no-titles"

def test_parser_coverage_backfill_with_limit():
    parser = build_parser()
    args = parser.parse_args(["coverage-backfill", "--issue-type", "bad-app-id", "--limit", "10", "/tmp/out"])
    assert args.limit == 10

def test_parser_steam_catalog_subcommand():
    parser = build_parser()
    args = parser.parse_args(["steam-catalog"])
    assert args.command == "steam-catalog"

def test_parser_process_with_url():
    parser = build_parser()
    args = parser.parse_args(["process", "--url", "https://github.com/foo/bar", "/tmp/out"])
    assert args.url == "https://github.com/foo/bar"
    assert args.output_dir == "/tmp/out"

def test_parser_process_with_subfolder():
    parser = build_parser()
    args = parser.parse_args(["process", "--url", "https://github.com/foo/bar",
                               "--subfolder", "data", "/tmp/out"])
    assert args.subfolder == "data"

def test_parser_debug_flag():
    parser = build_parser()
    args = parser.parse_args(["--debug", "finalize", "/tmp/out"])
    assert args.debug is True

def test_parser_no_debug_flag():
    parser = build_parser()
    args = parser.parse_args(["finalize", "/tmp/out"])
    assert args.debug is False
