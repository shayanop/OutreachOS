"""Run tests.json through run_turn with the in-memory fake DB (real Claude calls). Do not push."""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "agent"), os.path.join(ROOT, "dev")]
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(ROOT, ".env"))
import fake_db  # noqa: E402

sys.modules["db"] = fake_db
from graph import run_turn  # noqa: E402

tot_in = tot_out = passed = 0
cases = json.load(open(os.path.join(ROOT, "tests.json"), encoding="utf-8"))
for c in cases:
    t0 = time.time()
    for msg in c["turns"]:
        r = run_turn(c["user_id"], c["thread_id"], msg)
        tot_in += r["tokens"]["in"]; tot_out += r["tokens"]["out"]
    ms = int((time.time() - t0) * 1000)
    called = {tc["name"] for tc in r["tool_calls"]}
    ok = (set(c["expect_tools"]) <= called
          and (not c["expect_reply_any"] or any(s in r["reply"] for s in c["expect_reply_any"]))
          and not any(s in r["reply"] for s in c["expect_reply_none"]))
    passed += ok
    print(f"\n#{c['id']} {c['category']} {'PASS' if ok else 'FAIL'} {ms}ms tools={sorted(called)} tokens={r['tokens']}")
    print("   ", r["reply"][:400].replace("\n", "\n    "))

# risky action follow-up: confirming in the NEXT turn must actually send
r = run_turn("test_erin", "t1", "Yes, send it.")
tot_in += r["tokens"]["in"]; tot_out += r["tokens"]["out"]
sent = any(d["status"] == "sent" for d in fake_db.list_drafts("test_erin"))
print(f"\n#confirm-follow-up {'PASS' if sent else 'FAIL'} tools={[t['name'] for t in r['tool_calls']]}\n    {r['reply'][:300]}")

cost = tot_in * 0.10 / 1e6 + tot_out * 0.50 / 1e6
print(f"\n{passed}/{len(cases)} passed | tokens in={tot_in} out={tot_out} | est ${cost:.5f}")
