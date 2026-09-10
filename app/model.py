"""Client for the user-configured OpenAI-compatible model endpoint.

Any service exposing POST {base_url}/chat/completions works: OpenAI,
DeepSeek, Qwen (DashScope compatible mode), Moonshot, Zhipu GLM, Ollama,
vLLM, Xinference, One-API/NewAPI gateways, or a self-hosted model.
"""
import json

import httpx

from . import db

MODEL_KEYS = ("base_url", "api_key", "model", "temperature", "system_prompt")

DEFAULTS = {
    "base_url": "https://api.openai.com/v1",
    "api_key": "",
    "model": "gpt-4o-mini",
    "temperature": "0.7",
    "system_prompt": "",
}


def get_config():
    with db.connect() as conn:
        stored = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
    cfg = dict(DEFAULTS)
    cfg.update({k: v for k, v in stored.items() if k in MODEL_KEYS})
    return cfg


def save_config(cfg):
    with db.connect() as conn:
        for k in MODEL_KEYS:
            if k in cfg:
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (k, str(cfg[k])),
                )


def configured(cfg=None):
    cfg = cfg or get_config()
    return bool(cfg["api_key"].strip() and cfg["base_url"].strip() and cfg["model"].strip())


def _request_payload(cfg, messages, stream):
    payload = {
        "model": cfg["model"],
        "messages": messages,
        "stream": stream,
    }
    try:
        payload["temperature"] = float(cfg["temperature"])
    except (TypeError, ValueError):
        pass
    return payload


def _endpoint(cfg):
    return cfg["base_url"].rstrip("/") + "/chat/completions"


def _headers(cfg):
    return {"Authorization": "Bearer " + cfg["api_key"].strip()}


async def stream_chat(cfg, messages):
    """Yield (delta_text) strings; raise RuntimeError with a readable message on failure."""
    payload = _request_payload(cfg, messages, stream=True)
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=15.0)) as client:
        async with client.stream(
            "POST", _endpoint(cfg), json=payload, headers=_headers(cfg)
        ) as resp:
            if resp.status_code != 200:
                body = (await resp.aread()).decode("utf-8", "replace")[:600]
                raise RuntimeError(f"模型接口返回 {resp.status_code}: {body}")
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                for choice in chunk.get("choices", []):
                    delta = choice.get("delta") or {}
                    text = delta.get("content")
                    if text:
                        yield text


async def ping(cfg):
    """Connectivity check: list models if available, else a minimal completion."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(cfg["base_url"].rstrip("/") + "/models", headers=_headers(cfg))
        if resp.status_code == 200:
            try:
                ids = [m.get("id", "") for m in resp.json().get("data", [])]
            except Exception:
                ids = []
            return {"ok": True, "detail": "连接成功", "models": ids[:50]}
        resp2 = await client.post(
            _endpoint(cfg),
            json=_request_payload(cfg, [{"role": "user", "content": "ping"}], stream=False),
            headers=_headers(cfg),
        )
        if resp2.status_code == 200:
            return {"ok": True, "detail": "连接成功（chat/completions 可用）", "models": []}
        body = resp2.text[:400]
        return {"ok": False, "detail": f"HTTP {resp2.status_code}: {body}"}
