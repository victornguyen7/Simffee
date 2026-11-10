"""Tests run with the defaults the committed cache was filled with and with no provider
credentials, whatever the local .env says: no test may spend tokens or reach a local model
server, and a developer's SIMFFEE_MODEL must not change what the tests see
(AUDIT_FIX_PLAN #1, #10)."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import llm  # noqa: E402  -- importing loads .env, which is then undone below

for name in ("GROQ_API_KEY", "SIMFFEE_MODEL", "SIMFFEE_DECISION_MODEL", "SIMFFEE_MAX_TOKENS",
             "SIMFFEE_REASONING_EFFORT", "SIMFFEE_FALLBACK_MODEL", "SIMFFEE_FALLBACK_URL"):
    os.environ.pop(name, None)
llm.MODEL = llm.DEFAULT_MODEL
llm.DECISION_MODEL = None
llm.MAX_TOKENS = llm.DEFAULT_MAX_TOKENS
llm.FALLBACK_MODEL = ""            # tests that exercise the fallback enable it explicitly
llm._client = None
