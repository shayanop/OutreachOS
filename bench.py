"""Run the team's chat cases against a deployed GrowthPilot API."""

import argparse
import hashlib
import json
from pathlib import Path
from statistics import median
from time import perf_counter
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parent
INPUT_PRICE = 0.10
OUTPUT_PRICE = 0.50


def chat(base_url: str, payload: dict) -> tuple[str, set[str], int, int]:
    request = Request(
        f"{base_url}/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=85) as response:
            result = json.load(response)
    except HTTPError as exc:
        raise ValueError(f"HTTP {exc.code}") from exc
    reply, tool_calls, tokens = result["reply"], result["tool_calls"], result["tokens"]
    if not isinstance(reply, str) or not isinstance(tool_calls, list):
        raise ValueError("Unexpected /chat response")
    tool_names = {call["name"] for call in tool_calls}
    if any(not isinstance(name, str) for name in tool_names):
        raise ValueError("Invalid tool names")
    in_tokens, out_tokens = tokens["in"], tokens["out"]
    if any(type(count) is not int or count < 0 for count in (in_tokens, out_tokens)):
        raise ValueError("Invalid token counts")
    return reply.casefold(), tool_names, in_tokens, out_tokens


def scoped_user(user_id: str, suffix: str) -> str:
    if len(user_id) + 1 + len(suffix) > 64:
        user_id = hashlib.sha256(user_id.encode()).hexdigest()[:32]
    return f"{user_id}_{suffix}"


def run_case(base_url: str, case: dict, suffix: str) -> dict:
    started = perf_counter()
    tokens_in = tokens_out = 0
    failures = []
    try:
        reply, tools = "", set()
        if not case["turns"]:
            raise ValueError("Case has no turns")
        for value in case["turns"]:
            turn = {"message": value} if isinstance(value, str) else value
            reply, tools, used_in, used_out = chat(base_url, {
                "user_id": scoped_user(turn.get("user_id", case.get("user_id")), suffix),
                "thread_id": turn.get("thread_id", case.get("thread_id")),
                "message": turn["message"],
            })
            tokens_in += used_in
            tokens_out += used_out

        missing_tools = set(case.get("expect_tools", [])) - tools
        if missing_tools:
            failures.append(f"missing tools: {', '.join(sorted(missing_tools))}")
        if case.get("expect_no_tools") and tools:
            failures.append(f"unexpected tools: {', '.join(sorted(tools))}")
        expected = case.get("expect_reply_any", [])
        if expected and not any(value.casefold() in reply for value in expected):
            failures.append("none of the expected reply phrases appeared")
        if any(value.casefold() in reply for value in case.get("expect_reply_none", [])):
            failures.append("a forbidden reply phrase appeared")
    except (URLError, TimeoutError, KeyError, ValueError, TypeError, AttributeError) as exc:
        failures.append(f"{type(exc).__name__}: {exc}")
    return {
        "passed": not failures,
        "failures": failures,
        "latency": round((perf_counter() - started) * 1000),
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }


def cell(text: object) -> str:
    return " ".join(str(text).split()).replace("|", "&#124;").replace("<", "&lt;")


def make_report(rows: list[tuple[dict, dict]]) -> str:
    lines = [
        "# GrowthPilot benchmark",
        "",
        "| # | Category | Expected behaviour | Result | Latency ms | Tokens in/out |",
        "|---|---|---|---|---:|---:|",
    ]
    for case, result in rows:
        status = "PASS" if result["passed"] else f"FAIL ({'; '.join(result['failures'])})"
        lines.append(
            f"| {cell(case['id'])} | {cell(case.get('category', ''))} | "
            f"{cell(case.get('expected_behaviour', ''))} | {cell(status)} | "
            f"{result['latency']} | {result['tokens_in']}/{result['tokens_out']} |"
        )
    results = [result for _, result in rows]
    passed = sum(result["passed"] for result in results)
    latencies = [result["latency"] for result in results]
    tokens_in = sum(result["tokens_in"] for result in results)
    tokens_out = sum(result["tokens_out"] for result in results)
    cost = (tokens_in * INPUT_PRICE + tokens_out * OUTPUT_PRICE) / 1_000_000
    lines.extend([
        "",
        f"{passed}/{len(results)} passed ({passed / len(results):.0%}). "
        f"Case latency p50 {median(latencies):g} ms, max {max(latencies)} ms. "
        f"Tokens {tokens_in} input / {tokens_out} output. Estimated cost ${cost:.6f}.",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("api_url")
    parser.add_argument("--tests", type=Path, default=ROOT / "tests.json")
    parser.add_argument("--report", type=Path, default=ROOT / "docs" / "bench.md")
    args = parser.parse_args()
    try:
        cases = json.loads(args.tests.read_text(encoding="utf-8"))
        if not isinstance(cases, list) or not cases or any(
            not isinstance(case, dict) or "id" not in case for case in cases
        ):
            raise ValueError("Expected a non-empty JSON array of cases with IDs")
    except (OSError, ValueError) as exc:
        parser.error(str(exc))

    suffix = uuid4().hex[:12]
    rows = []
    for case in cases:
        result = run_case(args.api_url.rstrip("/"), case, suffix)
        rows.append((case, result))
        status = "PASS" if result["passed"] else "FAIL"
        print(f"{case['id']} {status} ({result['latency']} ms)", flush=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(make_report(rows), encoding="utf-8")
    print(f"Report written to {args.report}")
    return int(not all(result["passed"] for _, result in rows))


if __name__ == "__main__":
    raise SystemExit(main())
