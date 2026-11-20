"""Make the project root importable during test collection.

Running the ``pytest`` console script (as documented in README) puts the
``tests`` directory on ``sys.path`` rather than the repository root, so
``import main`` in the test modules would otherwise fail. Running
``python -m pytest`` adds the current directory automatically, but this keeps
both invocation styles working.
"""

import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)
