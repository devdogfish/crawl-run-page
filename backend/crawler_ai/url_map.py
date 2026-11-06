"""url-map.json: every route of the app, its URL parameters and their allowed values.

The model may only produce URLs that pass `UrlMap.validate`; the frontend validates again with the same file.
ON INTEGRATION: nothing to change; keep url-map.json in sync with the router (the frontend reads the same file).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urlsplit


class UrlError(ValueError):
    """The URL isn't one the app has. The message says what to use instead (it goes back to the model)."""


@dataclass
class Facts:
    """The data-dependent values a URL can mention: crawl ids per site, rule ids."""

    crawls: dict[str, list[str]] = field(default_factory=dict)  # newest first
    finished: dict[str, list[str]] = field(default_factory=dict)  # the finished ones: [0] is 'latest', [1] the baseline
    rules: set[str] = field(default_factory=set)


@dataclass
class ValidUrl:
    url: str  # canonical: defaults dropped, params in the map's order
    route: dict[str, Any]
    site: str | None
    path_params: dict[str, str]
    params: dict[str, str]  # non-default only


class UrlMap:
    def __init__(self, data: dict[str, Any]):
        self.sites: list[str] = data["sites"]
        self.routes: list[dict[str, Any]] = data["routes"]
        self._by_id = {r["id"]: r for r in self.routes}

    @classmethod
    def load(cls, path: Path) -> "UrlMap":
        return cls(json.loads(Path(path).read_text()))

    def route(self, route_id: str) -> dict[str, Any]:
        if route_id not in self._by_id:
            raise UrlError(f"Unknown route '{route_id}'. Routes: {', '.join(self._by_id)}.")
        return self._by_id[route_id]

    # ───────── prompts ─────────
    def describe(self) -> str:
        """Compact text for prompts: one line per route, then one per parameter with its allowed values."""
        out = [f"Sites: {', '.join(self.sites)}. Parameters left at their default are omitted from the URL."]
        for r in self.routes:
            out.append(f"\n{r['path']}  ({r['label']}; route id {r['id']})")
            for name, spec in {**r.get("path_params", {}), **r.get("params", {})}.items():
                out.append(f"  {name}{'  [path]' if name in r.get('path_params', {}) else ''}: {_spec_text(spec)}")
        return "\n".join(out)

    # ───────── validation ─────────
    def validate(self, url: str, facts: Facts) -> ValidUrl:
        parts = urlsplit(url.strip())
        if parts.scheme or parts.netloc or not parts.path.startswith("/") or parts.path.startswith("//"):
            raise UrlError("Use a path inside the app, starting with '/', for example /rbccm/issues?pri=P1.")
        segs = [s for s in parts.path.split("/") if s]
        route, values = self._match(segs)
        site = values.get("site")
        path_params = {k: v for k, v in values.items() if k != "site"}
        for k, v in path_params.items():
            _check(route["path_params"][k], k, v, site, facts)
        specs = route.get("params", {})
        given: dict[str, str] = {}
        for k, v in parse_qsl(parts.query, keep_blank_values=False):
            if k not in specs:
                raise UrlError(f"{route['path']} has no parameter '{k}'. Parameters: {', '.join(specs) or 'none'}.")
            _check(specs[k], k, v, site, facts)
            given[k] = v
        params = {k: given[k] for k in specs if k in given and given[k] != str(specs[k].get("default", ""))}
        return ValidUrl(self._join(route, site, path_params, params), route, site, path_params, params)

    def build(self, route_id: str, site: str | None, path_params: dict[str, str], params: dict[str, str]) -> str:
        return self._join(self.route(route_id), site, path_params, params)

    # ───────── internals ─────────
    def _match(self, segs: list[str]) -> tuple[dict[str, Any], dict[str, str]]:
        if not segs:
            return self._by_id["home"], {}
        if segs[0] not in self.sites:
            raise UrlError(f"'{segs[0]}' isn't a site. Sites: {', '.join(self.sites)}.")
        for r in self.routes:
            tmpl = [s for s in r["path"].split("/") if s]
            if len(tmpl) != len(segs) or not tmpl or tmpl[0] != ":site":
                continue
            values: dict[str, str] = {}
            for t, s in zip(tmpl, segs):
                if t.startswith(":"):
                    values[t[1:]] = s
                elif t != s:
                    break
            else:
                return r, values
        raise UrlError("No such page. Routes: " + ", ".join(r["path"] for r in self.routes))

    def _join(self, route: dict[str, Any], site: str | None, path_params: dict[str, str], params: dict[str, str]) -> str:
        path = route["path"].replace(":site", site or "")
        for k, v in path_params.items():
            path = path.replace(f":{k}", quote(str(v), safe=""))
        return path + (f"?{urlencode(params, safe=',:')}" if params else "")


def _spec_text(spec: dict[str, Any]) -> str:
    t = spec["type"]
    labels = spec.get("labels", {})
    if t in ("enum", "list"):
        vals = [f"{v}={labels[v]}" if v in labels else v for v in spec["values"]] + spec.get("extra", [])
        kind = "one of" if t == "enum" else "comma-separated list of"
        dflt = f"; default {spec['default']}" if "default" in spec else ""
        return f"{spec['label']}: {kind} {', '.join(vals)}{dflt}"
    hint = {"crawl": "a crawl id of the site" + (" or none" if "none" in spec.get("extra", []) else ""), "text": "free text", "int": "integer",
            "page": "a page id", "rule": "a rule id"}[t]
    return f"{spec.get('label', t)}: {hint}"


def _check(spec: dict[str, Any], name: str, value: str, site: str | None, facts: Facts) -> None:
    t = spec["type"]
    if t == "enum" and value not in spec["values"] + spec.get("extra", []):
        raise UrlError(f"'{value}' isn't valid for {name}. Allowed: {', '.join(spec['values'])}.")
    if t == "list":
        bad = [v for v in value.split(",") if v not in spec["values"]]
        if bad:
            raise UrlError(f"{', '.join(bad)} isn't valid for {name}. Allowed: {', '.join(spec['values'])}.")
    if t == "int" and not value.isdigit():
        raise UrlError(f"{name} must be a whole number.")
    if t == "text" and len(value) > 200:
        raise UrlError(f"{name} is too long.")
    if t == "page" and not value.isdigit():
        raise UrlError(f"{name} must be a page id (a number); find it with find_pages.")
    if t == "rule" and facts.rules and value not in facts.rules:
        raise UrlError(f"'{value}' isn't a rule id. Use list_rules.")
    if t == "crawl" and value not in spec.get("extra", []) and site in facts.crawls and value not in facts.crawls[site]:
        raise UrlError(f"Crawl {value} doesn't exist for {site}. Recent crawls: {', '.join(facts.crawls[site][:6])}.")


def display(spec: dict[str, Any], value: str) -> str:
    fallback = value[:1].upper() + value[1:] if spec["type"] == "enum" else value
    return spec.get("labels", {}).get(value, fallback)
