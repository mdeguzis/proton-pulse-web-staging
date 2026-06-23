"""Standalone script to fetch and cache the GOG game catalog."""

import os
import sys
from pathlib import Path

repo_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo_root))

print(f"[debug] __file__     = {__file__}", flush=True)
print(f"[debug] repo_root    = {repo_root}", flush=True)
print(f"[debug] sys.path[:3] = {sys.path[:3]}", flush=True)
print(f"[debug] scripts dir exists: {(repo_root / 'scripts').is_dir()}", flush=True)
print(f"[debug] pipeline dir exists: {(repo_root / 'scripts' / 'pipeline').is_dir()}", flush=True)
print(f"[debug] gog_catalog.py exists: {(repo_root / 'scripts' / 'pipeline' / 'gog_catalog.py').is_file()}", flush=True)
print(f"[debug] scripts/__init__.py exists: {(repo_root / 'scripts' / '__init__.py').is_file()}", flush=True)

from scripts.pipeline.gog_catalog import load_gog_catalog

force = os.environ.get("FORCE_REFRESH", "false").lower() == "true"
catalog = load_gog_catalog(force_refresh=force)
print(f"[gog-catalog] {len(catalog):,} entries loaded")
