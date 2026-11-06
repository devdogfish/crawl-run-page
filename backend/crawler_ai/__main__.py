"""`python -m crawler_ai`: the MCP server over stdio (Claude Code, Cursor, Claude Desktop start it as a subprocess).

    claude mcp add rbc-crawler -- uv run --directory backend python -m crawler_ai

ON INTEGRATION: build the server with the real Core instead of PrototypeCore.
"""
from crawler_ai.config import load_settings
from crawler_ai.core import PrototypeCore
from crawler_ai.mcp_server import build_mcp

if __name__ == "__main__":
    build_mcp(PrototypeCore(load_settings().proto_url)).run()  # stdio is the default transport; never print to stdout
