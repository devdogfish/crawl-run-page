"""DEV ONLY (delete on integration): an OpenAI-compatible /v1/chat/completions server answered by `codex exec`.

It lets crawler_ai.gateway.OpenAIGateway run unchanged without gateway access. Codex has no native tool calling here, so
tools are emulated: the prompt lists them (name, description, JSON schema) and `--output-schema` forces the reply into
{"content": str, "tool_calls": [{"name", "arguments_json"}]}; that is turned back into OpenAI tool_calls. With
`response_format: json_schema` the requested schema is passed to Codex directly. `stream: true` yields OpenAI-format
SSE chunks (Codex answers all at once, so the text is cut into small pieces).

    uv run --directory backend python -m dev.codex_openai --port 8787
Env: CODEX_MODEL (chat, default gpt-5.6-terra), CODEX_EFFORT (chat, default medium), CODEX_NAV_MODEL (response_format requests,
Cmd+K navigation; default gpt-5.6-luna, the fast one) at low effort.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MODEL = os.environ.get("CODEX_MODEL", "gpt-5.6-terra")
EFFORT = os.environ.get("CODEX_EFFORT", "medium")
NAV_MODEL = os.environ.get("CODEX_NAV_MODEL", "gpt-5.6-luna")  # navigation only maps a phrase to a URL: the fastest model is enough
WORKDIR = Path(tempfile.gettempdir()) / "crawler-codex-shim"  # empty folder: Codex has nothing to read
TIMEOUT = 300

REPLY_SCHEMA = {
    "type": "object",
    "properties": {
        "content": {"type": "string"},
        "tool_calls": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"name": {"type": "string"}, "arguments_json": {"type": "string"}},
                "required": ["name", "arguments_json"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["content", "tool_calls"],
    "additionalProperties": False,
}


def run_codex(prompt: str, schema: dict[str, Any] | None, effort: str, model: str = MODEL) -> str:
    WORKDIR.mkdir(exist_ok=True)
    cmd = ["codex", "exec", "-m", model, "-c", f'model_reasoning_effort="{effort}"', "--ignore-user-config", "--ephemeral",
           "--skip-git-repo-check", "-s", "read-only", "--json"]
    schema_file = None
    if schema:
        schema_file = WORKDIR / f"schema-{uuid.uuid4().hex[:8]}.json"
        schema_file.write_text(json.dumps(schema))
        cmd += ["--output-schema", str(schema_file)]
    try:
        p = subprocess.run([*cmd, "-"], input=prompt, capture_output=True, text=True, cwd=WORKDIR, timeout=TIMEOUT)
    finally:
        if schema_file:
            schema_file.unlink(missing_ok=True)
    events = []
    for line in p.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    text = "\n\n".join(e["item"]["text"] for e in events if e.get("type") == "item.completed" and e.get("item", {}).get("type") == "agent_message")
    if text:
        return text
    failed = next((e.get("error", {}).get("message") for e in events if e.get("type") == "turn.failed"), None)
    raise RuntimeError(failed or (p.stderr.strip().splitlines() or ["Codex returned no answer"])[-1])


def render_conversation(messages: list[dict[str, Any]]) -> str:
    out = []
    for m in messages:
        role, content = m["role"], m.get("content") or ""
        if isinstance(content, list):
            content = "".join(part.get("text", "") for part in content)
        if role == "system":
            out.append(content)
        elif role == "user":
            out.append(f"=== User ===\n{content}")
        elif role == "assistant":
            calls = "".join(f"\n[you called tool {c['function']['name']} with {c['function']['arguments']}]" for c in m.get("tool_calls") or [])
            out.append(f"=== Assistant ===\n{content}{calls}")
        elif role == "tool":
            out.append(f"=== Result of tool call {m.get('tool_call_id')} ===\n{content}")
    return "\n\n".join(out)


def render_tools(tools: list[dict[str, Any]]) -> str:
    lines = ["=== Tools you can call ===",
             "You cannot run commands or read files. You can call the tools below (the application runs them and shows you the results).",
             "Each tool: name, description, JSON schema of its arguments."]
    for t in tools:
        f = t["function"]
        lines.append(f"\n- {f['name']}: {f.get('description', '')}\n  arguments schema: {json.dumps(f.get('parameters', {}))}")
    lines.append(
        '\nReply with one JSON object {"content": string, "tool_calls": [{"name": string, "arguments_json": string}]}.'
        '\nEither (a) call one or more tools: put them in tool_calls (arguments_json is a JSON object as text, valid for that tool\'s schema) and leave content empty;'
        "\nor (b) answer the user: put the full answer in content and leave tool_calls empty."
        "\nCall tools only for data you don't have; once tool results answer the question, answer. Write only the next assistant turn.")
    return "\n".join(lines)


def complete(body: dict[str, Any]) -> dict[str, Any]:
    """Returns {"content": str, "tool_calls": [{"id","name","arguments"}]}."""
    messages, tools = body["messages"], body.get("tools") or []
    rf = body.get("response_format") or {}
    if rf.get("type") == "json_schema":
        schema = rf["json_schema"]["schema"]
        prompt = render_conversation(messages) + "\n\nAnswer with a JSON object matching the required schema, nothing else."
        return {"content": run_codex(prompt, schema, "low", NAV_MODEL), "tool_calls": []}
    if not tools:
        return {"content": run_codex(render_conversation(messages) + "\n\nWrite only the next assistant message. Don't run commands or read files.", None, EFFORT), "tool_calls": []}
    names = {t["function"]["name"] for t in tools}
    raw = json.loads(run_codex(render_conversation(messages) + "\n\n" + render_tools(tools), REPLY_SCHEMA, EFFORT))
    for _ in range(2):  # the model sometimes nests its whole reply object inside "content": unwrap it
        c = raw["content"].strip()
        if not (c.startswith("{") and '"content"' in c):
            break
        try:
            inner = json.loads(c)
        except json.JSONDecodeError:
            break
        if not isinstance(inner, dict) or "content" not in inner:
            break
        raw = {"content": inner["content"], "tool_calls": raw["tool_calls"] + inner.get("tool_calls", [])}
    calls = [{"id": f"call_{uuid.uuid4().hex[:8]}", "name": c["name"], "arguments": c["arguments_json"] or "{}"}
             for c in raw["tool_calls"] if c["name"] in names]
    return {"content": raw["content"], "tool_calls": calls}


def chunk(cid: str, delta: dict[str, Any], finish: str | None = None) -> bytes:
    obj = {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()), "model": MODEL,
           "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
    return f"data: {json.dumps(obj)}\n\n".encode()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quiet
        pass

    def _json(self, status: int, obj: Any) -> None:
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.rstrip("/") == "/v1/models":
            return self._json(200, {"object": "list", "data": [{"id": "codex", "object": "model"}]})
        self._json(404, {"error": {"message": "not found"}})

    def do_POST(self):
        if self.path.rstrip("/") != "/v1/chat/completions":
            return self._json(404, {"error": {"message": "not found"}})
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        try:
            out = complete(body)
        except Exception as e:  # shown to the caller as a gateway error
            return self._json(502, {"error": {"message": str(e), "type": "codex_error"}})
        cid = f"chatcmpl-{uuid.uuid4().hex[:12]}"
        finish = "tool_calls" if out["tool_calls"] else "stop"
        if not body.get("stream"):
            msg: dict[str, Any] = {"role": "assistant", "content": out["content"] or None}
            if out["tool_calls"]:
                msg["tool_calls"] = [{"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"]}} for c in out["tool_calls"]]
            return self._json(200, {"id": cid, "object": "chat.completion", "created": int(time.time()), "model": MODEL,
                                    "choices": [{"index": 0, "message": msg, "finish_reason": finish}]})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        def write(b: bytes) -> None:
            self.wfile.write(f"{len(b):x}\r\n".encode() + b + b"\r\n")
            self.wfile.flush()

        write(chunk(cid, {"role": "assistant", "content": ""}))
        text = out["content"]
        for i in range(0, len(text), 24):
            write(chunk(cid, {"content": text[i:i + 24]}))
            time.sleep(0.008)
        for idx, c in enumerate(out["tool_calls"]):
            write(chunk(cid, {"tool_calls": [{"index": idx, "id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": ""}}]}))
            args = c["arguments"]
            for i in range(0, len(args), 40):  # arguments arrive in fragments, as from the real API
                write(chunk(cid, {"tool_calls": [{"index": idx, "function": {"arguments": args[i:i + 40]}}]}))
        write(chunk(cid, {}, finish))
        write(b"data: [DONE]\n\n")
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    port = ap.parse_args().port
    print(f"Codex shim (chat {MODEL}, navigation {NAV_MODEL}) on http://127.0.0.1:{port}/v1", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
