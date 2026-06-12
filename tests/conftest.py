"""Stub out optional heavy deps so tests can import pipeline modules without them."""
import sys
from unittest.mock import MagicMock

if 'ijson' not in sys.modules:
    sys.modules['ijson'] = MagicMock()
