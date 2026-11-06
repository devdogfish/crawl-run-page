"""Cmd+K fallback: one destination for a free-text request, from a small fast model, validated against url-map.json.

Not a chat: the model only picks a URL, the server checks it, and the chips come from the validated parameters.
ON INTEGRATION: nothing to change (Gateway and Core are injected).
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass

from crawler_ai.core import FactsCache
from crawler_ai.gateway import Gateway
from crawler_ai.prompts import NAV_PROMPT
from crawler_ai.url_map import UrlError, UrlMap, ValidUrl, display

SCHEMA = {"type": "object", "properties": {"url": {"type": ["string", "null"]}}, "required": ["url"], "additionalProperties": False}


@dataclass
class Destination:
    url: str
    label: str
    chips: list[dict[str, str]]  # {name, value, label}


async def navigate(query: str, context: dict[str, str], gateway: Gateway, url_map: UrlMap, facts: FactsCache, timeout: float) -> Destination | None:
    f = await facts.get()
    site = context.get("site") if context.get("site") in url_map.sites else url_map.sites[0]
    crawls = f.finished.get(site, [])  # newest first
    values = {"url_map": url_map.describe(), "site": site, "url": context.get("url") or "/", "latest": crawls[0] if crawls else "none",
              "baseline": crawls[1] if len(crawls) > 1 else "none", "rules": ", ".join(sorted(f.rules))}
    prompt = NAV_PROMPT
    for k, v in values.items():  # not str.format: the prompt contains literal JSON braces
        prompt = prompt.replace("{" + k + "}", v)
    answer = await asyncio.wait_for(
        gateway.complete_json([{"role": "system", "content": prompt}, {"role": "user", "content": query[:300]}], SCHEMA, timeout=timeout), timeout + 1)
    url = answer.get("url")
    if not url:
        return None
    try:
        v = url_map.validate(url, f)
    except UrlError:
        return None
    label, chips = describe(v)
    return Destination(v.url, label, chips)


def describe(v: ValidUrl) -> tuple[str, list[dict[str, str]]]:
    """Label like 'Issues · P1 · Accessibility' and one chip per filter, with the map's own labels."""
    specs = {**v.route.get("path_params", {}), **v.route.get("params", {})}
    chips = []
    for name, raw in {**v.path_params, **v.params}.items():
        for value in raw.split(",") if specs[name]["type"] == "list" else [raw]:
            chips.append({"name": specs[name].get("label", name), "value": value, "label": display(specs[name], value)})
    return " · ".join([v.route["label"], *[c["label"] for c in chips]]), chips
