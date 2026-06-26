"""Generate game-images.json: correct Steam header image URLs for games where
the standard /header.jpg path is hashed (newer Steam releases).

Uses a unified cache (game-images-cache.json) tracking status + probe date per app ID:
  - status "ok":      standard CDN URL works, no frontend override needed.
  - status "hashed":  standard URL 404s; real URL stored and written to game-images.json.
  - status "missing": Steam API returned no header image.

Hot games (visible in recent-reports.json + most_played.json) are always probed
first and re-probed when their cache entry is older than STALE_DAYS. Backlog
entries (all other app IDs with ProtonDB data) are only probed when uncached,
capped at PROBE_CAP per run.

On first run after this format change, legacy game-images.json and
game-images-skip.json entries are migrated into the unified cache automatically.
"""

import json
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

from .common import log

STEAM_APPDETAILS_URL = "https://store.steampowered.com/api/appdetails?appids={appid}&filters=basic"
REQUEST_DELAY = 0.3   # seconds between Steam API calls
PROBE_CAP = 500       # max backlog IDs to probe per run (hot IDs are uncapped)
STALE_DAYS = 30       # re-probe hot games whose cache entry is older than this


def _standard_header_url(app_id: str) -> str:
    return f"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{app_id}/header.jpg"


def _url_is_ok(url: str, timeout: int = 8) -> bool:
    req = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def _fetch_steam_header(app_id: str, timeout: int = 10) -> tuple[str | None, bool]:
    """Return (header_url, delisted). delisted=True means Steam confirmed the
    app is not retrievable (success: false in the appdetails payload). A
    transient network failure leaves delisted=False so we do not falsely
    mark a live app as delisted on a flaky run.
    """
    url = STEAM_APPDETAILS_URL.format(appid=app_id)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        app_data = data.get(str(app_id), {})
        if not app_data.get("success"):
            return None, True
        return app_data.get("data", {}).get("header_image") or None, False
    except Exception as exc:
        log(f"[game-images] WARN: Steam appdetails fetch failed for {app_id}: {exc}")
        return None, False


def _collect_all_app_ids(data_dir: Path) -> list[str]:
    ids: set[str] = set()
    if data_dir.is_dir():
        for entry in data_dir.iterdir():
            if entry.is_dir() and entry.name.isdigit():
                ids.add(entry.name)
    return sorted(ids, key=lambda x: int(x))


def _hot_app_ids(output_dir: Path) -> list[str]:
    """App IDs currently visible on the site (recent-reports + most_played + steam-catalog), deduplicated."""
    ids: list[str] = []
    seen: set[str] = set()
    for fname in ("recent-reports.json", "most_played.json"):
        p = output_dir / fname
        if not p.exists():
            continue
        try:
            for entry in json.loads(p.read_text(encoding="utf-8")):
                aid = str(entry.get("appId", entry.get("app_id", ""))).strip()
                if aid.isdigit() and aid not in seen:
                    seen.add(aid)
                    ids.append(aid)
        except Exception as exc:
            log(f"[game-images] WARN: could not read {fname}: {exc}")
    # Catalog-only games (Steam chart games with no ProtonDB data) always probe images.
    catalog_path = output_dir / "steam-catalog.json"
    if catalog_path.exists():
        try:
            for aid in json.loads(catalog_path.read_text(encoding="utf-8")).keys():
                if str(aid).isdigit() and aid not in seen:
                    seen.add(aid)
                    ids.append(aid)
        except Exception as exc:
            log(f"[game-images] WARN: could not read steam-catalog.json: {exc}")
    return ids


def _load_cache(path: Path) -> dict:
    """Load unified cache: { appId: {status, url?, probed_at} }"""
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            log(f"[game-images] WARN: could not load cache {path.name}: {exc}")
    return {}


def _migrate_legacy(output_dir: Path, cache: dict) -> None:
    """One-time import of old game-images.json + game-images-skip.json into unified cache."""
    today = date.today().isoformat()
    migrated = 0

    overrides_path = output_dir / "game-images.json"
    if overrides_path.exists():
        try:
            old = json.loads(overrides_path.read_text(encoding="utf-8"))
            for aid, val in old.items():
                if aid not in cache and isinstance(val, str):
                    cache[aid] = {"status": "hashed", "url": val, "probed_at": today}
                    migrated += 1
        except Exception:
            pass

    skip_path = output_dir / "game-images-skip.json"
    if skip_path.exists():
        try:
            old = json.loads(skip_path.read_text(encoding="utf-8"))
            for aid in old.get("ids", []):
                if aid not in cache:
                    cache[aid] = {"status": "ok", "probed_at": today}
                    migrated += 1
        except Exception:
            pass

    if migrated:
        log(f"[game-images] migrated {migrated} entries from legacy cache files")


def _is_stale(entry: dict) -> bool:
    try:
        probed = date.fromisoformat(entry["probed_at"])
        return (date.today() - probed) > timedelta(days=STALE_DAYS)
    except Exception:
        return True


def build_game_images(output_dir) -> dict[str, str]:
    """Write game-images-cache.json (unified) and game-images.json (frontend).

    Returns the frontend override map: { appId: url } for hashed entries only.
    """
    output_dir = Path(output_dir)
    data_dir = output_dir / "data"
    cache_path = output_dir / "game-images-cache.json"

    cache = _load_cache(cache_path)
    if not cache:
        _migrate_legacy(output_dir, cache)

    all_ids = _collect_all_app_ids(data_dir)
    hot_ids = _hot_app_ids(output_dir)
    hot_set = set(hot_ids)

    # Hot: probe if uncached or stale
    hot_to_probe = [a for a in hot_ids if a not in cache or _is_stale(cache[a])]
    # Backlog: probe if uncached OR if hashed entry is stale (cover art hash may change), cap applies
    backlog_to_probe = [
        a for a in all_ids if a not in hot_set and (
            a not in cache or
            (cache[a].get("status") == "hashed" and _is_stale(cache[a]))
        )
    ]

    log(
        f"[game-images] {len(all_ids)} total app IDs | cache: {len(cache)} | "
        f"hot: {len(hot_to_probe)} to probe | backlog: {len(backlog_to_probe)} uncached/stale-hashed (cap {PROBE_CAP})"
    )

    today = date.today().isoformat()
    backlog_probed = 0

    for app_id in hot_to_probe + backlog_to_probe:
        is_backlog = app_id not in hot_set
        if is_backlog:
            if backlog_probed >= PROBE_CAP:
                log(f"[game-images] hit backlog cap ({PROBE_CAP}), deferring {len(backlog_to_probe) - backlog_probed}")
                break
            backlog_probed += 1

        standard_url = _standard_header_url(app_id)
        if _url_is_ok(standard_url):
            log(f"[game-images] {app_id}: standard URL ok", debug=True)
            cache[app_id] = {"status": "ok", "probed_at": today}
        else:
            log(f"[game-images] {app_id}: standard URL 404, fetching from Steam API")
            real_url, delisted = _fetch_steam_header(app_id)
            if real_url:
                url_clean = real_url.split("?")[0]
                cache[app_id] = {"status": "hashed", "url": url_clean, "probed_at": today}
                log(f"[game-images] {app_id}: hashed URL -> {url_clean}")
            elif delisted:
                # Steam confirmed the app is gone. Distinct from "missing"
                # (transient API hiccup) -- delisted is a positive signal we
                # surface as a chip on the frontend so users know why there
                # is no Steam page to visit.
                cache[app_id] = {"status": "delisted", "probed_at": today}
                log(f"[game-images] {app_id}: appdetails returned success=false (delisted)")
            else:
                cache[app_id] = {"status": "missing", "probed_at": today}
                log(f"[game-images] {app_id}: no image found via Steam API")
        time.sleep(REQUEST_DELAY)

    cache_path.write_text(json.dumps(cache, indent=2) + "\n", encoding="utf-8")
    log(f"[game-images] wrote unified cache ({len(cache)} entries) to {cache_path.name}")

    # Derive frontend game-images.json: hashed entries only, { appId: url }
    frontend = {aid: e["url"] for aid, e in cache.items() if e.get("status") == "hashed"}
    frontend_path = output_dir / "game-images.json"
    frontend_path.write_text(json.dumps(frontend, indent=2) + "\n", encoding="utf-8")
    log(f"[game-images] wrote {len(frontend)} hashed URL(s) to {frontend_path.name}")

    return frontend


def enrich_search_index_with_delisted(output_dir) -> None:
    """Write a delisted=True flag into column 7 of search-index.json for any
    Steam app the cache marked as delisted (appdetails returned success=false).

    Read-modify-write of search-index in place. Pads rows to length 8 so column
    7 lands consistently regardless of whether column 6 (releaseYear) was
    populated by release_years.py.
    """
    output_dir = Path(output_dir)
    index_path = output_dir / "search-index.json"
    cache_path = output_dir / "game-images-cache.json"
    if not index_path.exists() or not cache_path.exists():
        return
    try:
        entries = json.loads(index_path.read_text(encoding="utf-8"))
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception as exc:
        log(f"[delisted] WARN: could not read input files: {exc}")
        return
    if not isinstance(entries, list) or not isinstance(cache, dict):
        return

    delisted_ids = {aid for aid, e in cache.items() if isinstance(e, dict) and e.get("status") == "delisted"}
    if not delisted_ids:
        log("[delisted] no delisted Steam apps in cache, skipping enrich")
        return

    updated = 0
    for row in entries:
        if not isinstance(row, list) or len(row) < 1:
            continue
        if str(row[0]) in delisted_ids:
            # Pad to 8 columns: [id, title, tier, pdb, pulse, appType, releaseYear, delisted]
            while len(row) < 8:
                row.append(None)
            row[7] = True
            updated += 1

    if updated:
        index_path.write_text(json.dumps(entries, separators=(",", ":")), encoding="utf-8")
        log(f"[delisted] flagged {updated} entries as delisted in search-index.json")
