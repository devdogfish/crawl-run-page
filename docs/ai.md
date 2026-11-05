# AI in the crawler: three systems, one job each

Status: decided 2026-11-05 ([ADR 0003](adr/0003-three-ai-systems.md)). Ask AI exists in the prototype on scripted answers; navigation and the MCP server aren't built. Tickets are in [PLAN.md](../PLAN.md). Data, storage and ids are in [pages-and-issues.md](pages-and-issues.md). Terms are from [CONTEXT.md](../CONTEXT.md).

---

## 1. The three systems

| | **Navigation** (Cmd/Ctrl+K) | **MCP server** | **Ask AI** (the assistant) |
|---|---|---|---|
| **For** | Getting to the right place in the app | AI tools outside the app: Claude Code, Cursor, Claude Desktop | Understanding and fixing what you're looking at |
| **Does** | Turns what you type into a route and URL parameters (filters, crawl, tab, selected issue), then goes there | Gives open, unopinionated access to the app's data, not tied to any screen | Answers from the context it's given; shows issue and rule chips and component blocks such as a fix with its diff |
| **Can't** | Fetch data or answer questions | Show anything in the app | Fetch data, navigate or change anything |
| **Gets its input from** | Your query, the current URL, the URL map (§2) | The client's tool calls | Visible prompts: a button's instruction plus its context, and what you type |
| **Model** | Corporate gateway, via the backend | The client's own model | Corporate gateway, via the backend |
| **Status** | Not built | Not built | Prototype on scripted answers |

What separates them is what each can touch. Navigation only writes URLs, Ask AI only writes text, and the MCP server only reads data. None of them does another's job, so none of them needs another's permissions.

## 2. What they share (built once)

| Piece | Where | Used by |
|---|---|---|
| **URL map**: every route, its URL parameters and their allowed values | `url-map.json`, read by the frontend and the backend | Navigation (what it may write), Ask AI (chip and fix links), MCP (`ui_url` in results) |
| **Element id**: stable across crawls, resolvable on its own ([pages-and-issues.md](pages-and-issues.md) §3 "Ids") | `element.id` | Ask AI references, MCP `get_issue`, links |
| **Read-model core**: `core/pages.py`, `core/issues.py` | backend | MCP tools, the REST API, Ask AI's prompts |
| **Prompt text** for an issue or a page | `core/handoff.py` | Ask AI's buttons, Copy as prompt, the MCP prompt `fix_issue` |
| **Gateway client**: `stream_chat(messages, user)` and `complete_json(messages, user)` | `assistant/gateway.py` | Navigation, Ask AI |

The URL map is the one thing all three rely on, and the one thing that's easy to duplicate by accident. So it's one JSON file, not two lists kept in sync by hand. For each route it records the path pattern, each parameter, the parameter's allowed values (an enum, an id or free text) and its default. The pages already use these names (`/:site/pages?crawl=&vs=&q=&type=&year=&rule=&links=&sort=&change=`, `/:site/issues?…&cat=&pri=&markup=&seg=`, `/:site/pages/:pageId?issue=&tab=`).

---

## 3. Navigation (Cmd/Ctrl+K)

### 3.1 What it does

You type where you want to be; it sends you there with the filters set.

| You type | It goes to |
|---|---|
| "new P1 accessibility issues" | `/rbccm/issues?pri=P1&cat=accessibility&seg=new` |
| "the private credit article" | `/rbccm/pages?q=private+credit` |
| "podcasts from 2024 with the worst performance" | `/rbccm/pages?type=podcast&year=2024&sort=worst` |
| "image alt text across the site" | `/rbccm/issues/image-alt` |
| "crawl 806" | `/rbccm/crawls/806` |

It never fetches data, so it can't know which page has the most issues. It can only send you to the view that sorts them that way, and the view shows the answer.

### 3.2 How it behaves

1. **Cmd+K (Ctrl+K on Windows) opens the palette.** Typing first shows **instant matches** with no AI: sections, sites, rules by name, crawl numbers and recent places.
2. **The AI suggestion arrives by itself.** When typing pauses (around 400 ms) and the query isn't an exact match, one more result appears at the top: **Go to: Issues · P1 · Accessibility · New**. Enter takes the top result. You can also ask for it explicitly with Tab or "Ask".
3. **The app validates the URL before showing it.** It checks the model's answer against the URL map: unknown routes are dropped, and so are unknown parameters and values outside a parameter's enum. The filters it will set show as chips, so you see where you're going before you go.
4. **Going there is ordinary navigation.** Back works, the URL can be shared, and the page reads its state from the URL as it does today.

### 3.3 Route

`POST /api/v3/navigate` with `{query, current_url}` → `{path, params, label}`.

- The prompt holds the URL map, the current site and the latest crawl and baseline ids, and nothing else. It's not streamed.
- It uses a small, fast model through `gateway.complete_json`, with a timeout of about 3 s. If it times out, only the instant matches show.
- The server validates the answer against the URL map before returning it, and the frontend validates it again.

---

## 4. MCP server

### 4.1 What it's for

AI tools outside the app use the crawler's data directly, with no UI in the way: "get the P1 accessibility issues for /en/insights/2025/… and fix them in this repo", "which pages got new issues in the last crawl?", "why did crawl 806 fail?". The developer doesn't copy anything.

It's **unopinionated**: tools follow the data (sites, crawls, pages, issues, rules), not the app's screens, so a client can combine them however it needs. It runs in-process next to the REST API and calls the same core ([pages-and-issues.md](pages-and-issues.md) §1). It never calls the gateway; the client brings its own model.

### 4.2 Tools

Read-only to begin with, covering what the app shows:

| Data | Tools | Returns |
|---|---|---|
| Sites | `list_sites()` | id, name, URL, QA or production |
| Crawls | `find_crawls(site, status?, limit?)`, `get_crawl(crawl)` | status, timing, steps, facts, settings, `ui_url` |
| Logs | `get_crawl_logs(crawl, step?, level?, q?, limit?)` | log lines in the one format (SPEC §4.3) |
| Pages | `find_pages(site, q?, rule?, priority?, category?, change?, type?, year?, crawl?, baseline?, sort?, limit?)`, `get_page(page, crawl?)` | pages with issue counts by priority; one page's snapshot and change; `ui_url`, `next_cursor` |
| Issues | `find_issues(page, crawl?, priority?, category?, status?)`, `find_issues_by_rule(site, rule, crawl?)`, `get_issue(element_id)` | issues with their elements (selector, HTML, shared pages), how to fix, `ui_url` |
| Rules | `list_rules(category?)`, `get_rule(rule)`, `list_custom_rules(site)` | the catalog: title, severity, priority, WCAG, why, how to fix, references |
| Lighthouse | `get_lighthouse(crawl, scope?)` | median scores |

**One prompt** (MCP prompts are templates the user picks in their client): `fix_issue(element_id)` returns the text from `core/handoff.py`, the same as the app's **Fix with AI** button and **Copy as prompt**.

**Write tools come later,** once there's a need, auth and an audit trail for them: start, pause or resume a crawl, and add a custom rule. Each would be a separate tool marked as destructive, so clients ask before calling it.

### 4.3 Writing tools that models use well

- **Descriptions are for the model.** Say in one or two sentences when to use the tool and what comes back: "List the issues on one page of the site. Use this before fixing a page; each issue includes the failing HTML and how to fix it."
- **Constrain inputs.** Use enums for `priority` (`P1`…`P4`), `category`, `status`, `change`. Give sensible defaults (`crawl` = latest). Accept what a user would paste: a full URL as well as an id.
- **Return compact, structured results.** Return the typed model; FastMCP turns it into structured content plus text. Cap lists (`limit`, `next_cursor`), trim HTML snippets, and omit fields the model doesn't need. A page with 150 elements comes back grouped by issue, not as 150 flat rows.
- **Always include `ui_url`,** built from the URL map, so the model can hand the developer a link to the exact place in the app.
- **Errors say what to do next:** "Page /en/foo isn't in crawl 811. The latest crawl that has it is 806." Raise them as tool errors, not empty results.
- **One tool per question the data answers,** not per screen, and no two tools that overlap. Clear names let the model choose among a dozen reliably.
- **Mark every read tool `readOnlyHint`.**

### 4.4 Code

Use the official MCP Python SDK (`mcp` package; `FastMCP` is included). Check [the SDK README](https://github.com/modelcontextprotocol/python-sdk) for the current API and pin the version in `pyproject.toml`. The transport and mounting APIs have changed between releases.

```python
# mcp/server.py (shape)
from typing import Literal
from mcp.server.fastmcp import FastMCP
from crawler_api import db
from crawler_api.core import handoff, issues
from crawler_api.core.models import Issue

mcp = FastMCP("rbc-crawler", stateless_http=True)

Priority = Literal["P1", "P2", "P3", "P4"]
Category = Literal["accessibility", "performance", "seo", "security"]

@mcp.tool(annotations={"readOnlyHint": True})
def find_issues(page: str, crawl: int | Literal["latest"] = "latest",
                priority: list[Priority] = [], category: list[Category] = []) -> list[Issue]:
    """List the issues on one page. Use before fixing a page: each issue has the failing HTML and how to fix it."""
    with db.connect(readonly=True) as conn:
        return issues.find_issues(conn, page, crawl, priority=priority, category=category)

@mcp.prompt()
def fix_issue(element_id: str) -> str:
    """Fix one issue: the same prompt as the app's Fix with AI button."""
    with db.connect(readonly=True) as conn:
        return handoff.issue_prompt(conn, element_id, kind="fix")

# every other tool looks the same: parse, call core, return
```

```python
# mcp/__main__.py: local, over stdio
from crawler_api.mcp.server import mcp
mcp.run()                       # stdio is the default transport
```

```python
# api/app.py: the same server over HTTP, next to the REST API
app = FastAPI(lifespan=...)     # the lifespan must start mcp's session manager; see the SDK README
app.mount("/mcp", mcp.streamable_http_app())
```

The tool functions contain no logic beyond calling the core. If one starts growing an `if`, that logic belongs in the core, where the REST API gets it too.

### 4.5 Running it

You don't need to deploy anything to try it.

| Setup | How | When |
|---|---|---|
| **Local, stdio** | `claude mcp add rbc-crawler -- uv run --directory backend python -m crawler_api.mcp` | Developing the server, or a demo on your own machine. The client starts the process, which reads your local `intelligence.db`. |
| **Local, HTTP** | Run the API, then `claude mcp add --transport http rbc-crawler http://localhost:8000/mcp` | Same, but through the real API process (closest to production). |
| **Shared** | The FastAPI app on an internal host; teammates add `https://crawler.internal/mcp` | When others need it. Put it behind the company SSO or a read-only token. |

Debug with the MCP Inspector (`npx @modelcontextprotocol/inspector`). It lists the tools, shows their schemas and lets you call them by hand.

### 4.6 Testing

- **Core:** almost all tests live with the core ([pages-and-issues.md](pages-and-issues.md) §5).
- **Tools:** a few tests that the tools are registered, validate their input and return the core's result unchanged. Call them through the SDK's in-process client.
- **By hand:** the Inspector, then one real session in Claude Code: "list the P1 issues on /en/insights/… and fix them".

---

## 5. Ask AI (the assistant)

### 5.1 What it is

One assistant for the whole app, docked on the right and opened from the navbar. It works like copying a prompt into an external AI, except the prompt is written for you, you can see all of it, and the answer can show components. The prototype has the full behaviour on scripted answers: `src/components/assistant.tsx`, `src/lib/mock-ai.ts`, `src/lib/refs.ts`.

- **Visible prompts.** Buttons around the app (**Fix with AI**, **Explain with AI**, **Summarize with AI**) put a prompt into the conversation: a short instruction plus the context it's about, which the user can unfold. The only other thing sent is the system prompt, and the panel shows that too.
- **No tool calls.** The model answers from what's in the conversation. It doesn't fetch data, navigate or change anything.
- **Plain text in, components out.** The model writes text with two kinds of markup, and the frontend renders them:

| The model writes | The app shows |
|---|---|
| `@issue:ID` or `@rule:RULE_ID` in a sentence | an inline chip: priority and title, linking to the issue or rule |
| a ` ```ui ` block holding one JSON object, `{"type": "…", …}` | the component named by `type` |

Component types today:

| `type` | Fields | Shows |
|---|---|---|
| `fix` | `issue` (element id), `html` (the corrected element) | the issue title (linking to it), where it is, the shared-markup note, a diff against the original element, and Preview, Source and Copy |

The model only supplies ids and its own output, such as the corrected HTML. The original HTML, the page, the rule and the links all come from the id (`GET /api/v3/issues/{id}`), so a component works the same on any page. If a block doesn't parse, has an unknown `type` or names an unknown id, it shows as plain code. Adding a component means one entry in `COMPONENTS` in `assistant.tsx` and one line in the system prompt.

### 5.2 Routes

| Route | Does |
|---|---|
| `GET /api/v3/assistant/seed?kind=fix\|explain\|summarize&issue=ID` (or `&page=ID`) | Returns `{instruction, context}`, built by `core/handoff.py`. The frontend shows it, then sends it. |
| `POST /api/v3/chat` | Body: `{messages: [{role: "user"\|"assistant", content}]}`. Adds `SYSTEM_PROMPT` in front, calls `gateway.stream_chat` and streams server-sent events: `data: {"delta": "…"}`, then `data: [DONE]`. |
| `GET /api/v3/assistant/system` | The system prompt, so the panel can show it. |

```python
# assistant/routes.py (shape)
@router.post("/api/v3/chat")
async def chat(body: ChatRequest, user = Depends(current_user)):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *body.messages]
    async def events():
        async for delta in gateway.stream_chat(messages, user=user.id):
            yield f"data: {json.dumps({'delta': delta})}\n\n"
        yield "data: [DONE]\n\n"
    return StreamingResponse(events(), media_type="text/event-stream")
```

### 5.3 Rules for the chat route

- **The server doesn't store conversations.** The browser keeps the conversation and sends all of it each time. Add storage only if people ask for history.
- **Only the server writes the system message.** `ChatRequest` accepts the `user` and `assistant` roles only, and caps the number of messages and their total length.
- **Crawled HTML is untrusted, and that's fine here.** It goes into the context, but with no tools a hostile page can at most produce an odd answer.
- **The model's HTML never goes into the page.** The fix card shows it as text in a diff. Keep it that way: rendering it would let a crafted answer run in the app.
- **Errors the user can act on:** a rate limit or an unavailable gateway comes back as a short message in the panel, not a stack trace.

---

## 6. Backend layout and the gateway

```
assistant/
  gateway.py        # stream_chat(messages, user) and complete_json(messages, user): the only code that knows the gateway
  fake_gateway.py   # the same two functions with canned answers, for tests and for running without gateway access
  prompts.py        # SYSTEM_PROMPT (Ask AI) and the navigation prompt
  routes.py         # /api/v3/chat, /api/v3/assistant/seed, /api/v3/assistant/system, /api/v3/navigate
mcp/
  server.py         # tools and the fix_issue prompt (thin: parse, call core, return)
  __main__.py       # stdio entry
url-map.json        # routes, parameters, allowed values: read by the frontend and the backend
```

Open questions about the gateway. They only affect `gateway.py`:
1. **API format:** is it OpenAI-compatible (`/chat/completions`) or custom? Does it stream, and does it support a JSON output mode for navigation?
2. **Identity:** does it need each user's identity, or one service account for the app?
3. **Data policy:** what may be sent (page HTML is public), and what is logged, for how long?
4. **Models:** is a small, fast model available for navigation, separate from the one Ask AI uses?
