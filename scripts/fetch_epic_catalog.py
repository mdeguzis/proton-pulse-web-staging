"""Standalone script to fetch and cache the Epic Games Store catalog."""

import os
import sys
from pathlib import Path

script_dir = Path(__file__).resolve().parent
if str(script_dir) not in sys.path:
    sys.path.insert(0, str(script_dir))

from pipeline.epic_catalog import load_epic_catalog

force = os.environ.get("FORCE_REFRESH", "false").lower() == "true"
catalog = load_epic_catalog(force_refresh=force)
print(f"[epic-catalog] {len(catalog):,} entries loaded")
