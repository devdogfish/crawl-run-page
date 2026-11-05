# Three AI systems, each limited to one kind of output

The crawler gets three AI systems ([docs/ai.md](../ai.md)), and each can only produce one kind of thing:

1. **Navigation (Cmd/Ctrl+K)** only writes a URL: a route plus its parameters, checked against the URL map. It never fetches data or answers questions.
2. **The MCP server** only reads data, unopinionated and not tied to any screen, for AI tools outside the app. The client brings the model.
3. **Ask AI** only writes text: an explanatory assistant that gets visible prompts (a button's instruction plus its context) and answers with chips and ` ```ui ` component blocks, one JSON shape whose `type` picks the component. It has no tool calls.

We chose this over one agent that can fetch, navigate and act, because:
- **People see what each one does.** Navigation shows its filters before going, Ask AI shows everything it was given, and the MCP is a plain data API.
- **Little to build and secure.** There's no tool loop, no relaying of UI actions from the server to the browser, and no write permissions in the app's AI. Crawled pages are untrusted content, and none of the three can be talked into acting on them.
- **Shared pieces are built once:** the URL map, the element id, the core, the prompt text in `core/handoff.py`, and one gateway client.

## Consequences

- Ask AI can't look anything up. Getting new data into it means a new button with its own visible context, not a tool.
- Navigation can only send you to a view; that view shows the answer ("the page with the most P1s" opens Pages filtered and sorted).
- Writing through AI (starting crawls, adding custom rules) only happens through future MCP write tools, behind auth and the client's confirmation.
- Element ids must be stable and resolvable on their own, and the URL map must be the single list of routes and parameters, because all three depend on them.
