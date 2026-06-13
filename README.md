# super helper

`super helper` is a chat-first super helper for diagnosing user problems across arbitrary project workspaces and configurable MCP tools.

The product intentionally separates two responsibilities:

- `super helper Agent` talks with the user, checks whether information is enough, asks follow-up questions, reviews evidence, and explains conclusions.
- Claude Code is a diagnostic tool used by the Agent. It should not talk directly to the user in the first MVP.

Start with the docs:

Development rules:

- [Coding Agent Rules](AGENTS.md): how AI coding agents and developers must modify this repository.
- [Development Standards](docs/development-standards.md): module boundaries, contracts, anti-patterns, and required verification.

Product Agent behavior:

- [Product Agents](src/agents/README.md): where the main Agent and sub-agent configs live.
- [Main Agent Config](src/agents/main.md): how the super helper user-facing main Agent behaves at runtime.
- [Product Requirements](docs/product-requirements.md)
- [Agent Design](docs/agent-design.md)
- [Technical Architecture](docs/technical-architecture.md)
- [Command Whitelist](docs/command-whitelist.md)
- [MVP Roadmap](docs/mvp-roadmap.md)

## Development

Before changing code, read [Development Standards](docs/development-standards.md). This project enforces module boundaries for gateway, runtime, sessions, workers, observability, and compatibility facades. Do not add new logic wherever it is convenient.

```bash
pnpm install
pnpm lint
pnpm typecheck
```

Main implementation entry points:

- Product Agent configs live under `src/agents/`; stage pairings are in `src/agents/registry.json`.
- Runtime orchestration lives in `src/runtime/diagnostic-runtime.ts`; `src/agent.ts` is the compatibility facade.
- Enterprise knowledge workspace helpers live in `src/knowledge/`.
- HTTP startup and route composition live in `src/gateway/http-server.ts`; `src/server.ts` is the compatibility export.
- Claude Code worker internals live under `src/workers/claude/`; `src/claude-worker.ts` is the compatibility export.
- Case repository and diagnostic context helpers live under `src/sessions/`.
- Log drawer block rendering lives in `src/observability/log-blocks.ts`.

## Local Run

```bash
pnpm install
pnpm build
node dist/cli.js init
node dist/cli.js knowledge init --workspace /path/to/your/workspace
node dist/cli.js knowledge update --workspace /path/to/your/workspace
node dist/cli.js dev --workspace /path/to/your/project
```

Then open the printed local URL.

The first run creates `~/.super-helper/config.json`. Case memory is stored under a workspace-specific subdirectory of `~/.super-helper/` by default, so starting separate services with different `--workspace` values keeps their sessions isolated.

Click the `super helper` brand in the upper-left corner to open local settings. The settings panel can save the Agent model provider, run a model connectivity test, and show the read-only multi-Agent configuration loaded from `src/agents/`.

## Future npm Install Shape

After publishing, the expected usage is:

```bash
npm install -g super-helper
super-helper init
super-helper knowledge init --workspace /path/to/your/workspace
super-helper knowledge update --workspace /path/to/your/workspace
super-helper dev --workspace /path/to/your/project
```

## Enterprise Knowledge Workspace MVP

The first knowledge-base MVP is local and file-based. It does not use vector databases, GraphRAG, RAG pipelines, or Obsidian runtime plugins.

Initialize a workspace skeleton:

```bash
pnpm knowledge:init -- --workspace /path/to/your/workspace
```

This creates:

```text
knowledge/
  _sources/
  _taxonomy/
  faq/
  runbooks/
  tickets/
  whitepapers/
  glossary/
  modules/
  indexes/
```

Update derived indexes after editing Markdown knowledge:

```bash
pnpm knowledge:update -- --workspace /path/to/your/workspace
```

Search the local knowledge index from the CLI:

```bash
pnpm build
node dist/cli.js knowledge search --workspace /path/to/your/workspace --query "课程发布后为什么学员端看不到"
```

Whitepaper PDFs should be preserved under `knowledge/_sources/whitepapers/`. Human-maintained Markdown parent slices live under `knowledge/whitepapers/`, while `knowledge/indexes/chunks.jsonl` is a derived recall index that can be rebuilt.

## Agent Model Configuration

The Agent can use an OpenAI-compatible chat completions provider for two jobs:

- preflight: decide whether to ask the user or dispatch Claude Code
- review: audit Claude Code results and write the final user-facing reply

If no model is configured, super helper falls back to deterministic local rules.

Example `~/.super-helper/config.json` fragment:

```json
{
  "agent": {
    "modelProvider": "default",
    "useModelForPreflight": true
  },
  "models": {
    "providers": {
      "default": {
        "type": "openai-compatible",
        "baseUrl": "https://api.example.com/v1",
        "apiKeyEnv": "SUPPER_HELPER_API_KEY",
        "model": "your-model-id",
        "temperature": 0
      }
    }
  }
}
```

Claude Code remains a diagnostic worker. The Agent decides whether to call it.

MiniMax example:

```json
{
  "agent": {
    "modelProvider": "minimax",
    "useModelForPreflight": true
  },
  "models": {
    "providers": {
      "minimax": {
        "type": "openai-compatible",
        "baseUrl": "https://api.minimaxi.com/v1",
        "api": "openai-completions",
        "apiKeyEnv": "MINIMAX_API_KEY",
        "model": "MiniMax-M3",
        "temperature": 0,
        "maxTokens": 1200,
        "contextWindowTokens": 1000000
      }
    }
  }
}
```

Keep the actual key in the environment:

```bash
export MINIMAX_API_KEY="..."
```

If `MINIMAX_API_KEY` is missing in the shell that starts `super-helper`, the Agent model will fail with `Missing API key for model MiniMax-M3` and fall back to local preflight rules. Use the settings panel's `测试模型` button to confirm the model is reachable before diagnosing real tickets.

The context meter uses the current model provider's `contextWindowTokens`. If the provider omits it, super helper falls back to built-in known model defaults and then to `agent.contextWindowTokens`.

You can also configure the model with the CLI:

```bash
super-helper model set default \
  --base-url https://api.example.com/v1 \
  --model your-model-id \
  --api-key-env SUPPER_HELPER_API_KEY
```

## Workspace and MCP Configuration

```bash
super-helper workspace set --path /path/to/your/project --name "My Project"
super-helper mcp add readonly-db --protocol stdio --permission read_only --config-json '{"command":"node","args":["server.js"]}'
```
