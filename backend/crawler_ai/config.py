"""Settings from the environment (and backend/.env). Dev defaults point at the Codex shim (dev/codex_openai.py).

ON INTEGRATION: set AI_BASE_URL / AI_API_KEY / AI_CHAT_MODEL / AI_NAV_MODEL for the corporate gateway; nothing else here changes.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent


def _dotenv(path: Path) -> dict[str, str]:
    """Tiny KEY=value reader (comments allowed), so we don't need a dependency for one file."""
    if not path.exists():
        return {}
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.split(" #")[0].strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip("\"'")
    return out


@dataclass(frozen=True)
class Settings:
    ai_base_url: str = "http://127.0.0.1:8787/v1"
    ai_api_key: str = "dev"
    ai_chat_model: str = "codex"
    ai_nav_model: str = "codex"
    proto_url: str = "http://localhost:5173/__proto"
    url_map: Path = field(default_factory=lambda: BACKEND.parent / "url-map.json")
    chat_timeout: float = 180.0  # Codex needs this; a real gateway answers in seconds
    nav_timeout: float = 15.0  # Codex takes ~6 s; set AI_NAV_TIMEOUT=3 against the real gateway


def load_settings() -> Settings:
    env = {**_dotenv(BACKEND / ".env"), **os.environ}
    d = Settings()
    return Settings(
        ai_base_url=env.get("AI_BASE_URL", d.ai_base_url),
        ai_api_key=env.get("AI_API_KEY", d.ai_api_key),
        ai_chat_model=env.get("AI_CHAT_MODEL", d.ai_chat_model),
        ai_nav_model=env.get("AI_NAV_MODEL", d.ai_nav_model),
        proto_url=env.get("PROTO_URL", d.proto_url).rstrip("/"),
        url_map=Path(env["URL_MAP"]) if "URL_MAP" in env else d.url_map,
        chat_timeout=float(env.get("AI_CHAT_TIMEOUT", d.chat_timeout)),
        nav_timeout=float(env.get("AI_NAV_TIMEOUT", d.nav_timeout)),
    )
