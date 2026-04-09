# Video Skills Platform

An AI-orchestrated video editing automation platform. Design DAG workflows on a visual canvas, where each node maps to a **skill** — the LLM agent executes them step-by-step using tools, sub-agents, and cloud services.

## How It Works

1. **Skills** live in the `skills/` directory (gitignored). Each skill is a folder with a `SKILL.md` describing its purpose, parameters, and execution steps. The registry auto-discovers them at startup.

2. **Workflows** are directed acyclic graphs. Each node references a skill and can define execution policies, parameter overrides, and quality gates. Workflows are validated (cycle detection + topological sort) before execution.

3. **Orchestrator** is a LangChain agent that receives the workflow as a structured message, loads skills on demand, runs system tools (bash, file read/write, download), and can delegate to **sub-agents** with different LLM profiles for specialized tasks.

4. **Sessions** unify interactive chat and batch execution. The agent streams responses via SSE; node-level status updates flow through WebSocket.

## Getting Started

### Setup

```bash
# Clone and enter the project
git clone <repo-url> && cd video-skills-plateform

# Configure environment
cp .env.example .env
# Edit .env — at minimum set API_KEY, BASE_URL, MODEL for your LLM

# Add skills to the skills/ directory (see Skills section below)
```

### Run

**Quick start (both services):**

```bash
./start.sh
```

**Or start separately:**

```bash
# Backend
uv run python main.py          # http://localhost:8000

# Frontend
cd frontend && npm install && npm run dev   # http://localhost:5173
```

API docs available at `http://localhost:8000/docs`.

## Configuration

All config is via `.env` at the project root. See `.env.example` for the full list.

| Variable | Required | Description |
|----------|----------|-------------|
| `API_KEY` / `BASE_URL` / `MODEL` | Yes | OpenAI-compatible LLM endpoint |
| `LLM_PROFILES` | No | JSON map of named profiles for sub-agents with different models |
| `VOLCENGINE_*` | No | Volcengine ASR and video workflow credentials |
| `ALIYUN_OSS_*` | No | Aliyun OSS upload credentials |
| `ALIYUN_ICE_*` | No | Aliyun ICE video processing credentials |

## Skills

Skills are the atomic units of work. Each skill is a folder under `skills/` containing at minimum a `SKILL.md` file with:

- Skill metadata (id, name, category, parameters, I/O)
- Detailed execution instructions for the agent
- Optional `preferred_model` to route execution to a specific LLM profile

The `skills/` directory is gitignored — populate it with your own skill definitions.

## API Overview

| Endpoint | Description |
|----------|-------------|
| `GET /api/skills` | List available skills (with search/filter) |
| `POST /api/workflows` | Create a workflow |
| `POST /api/workflows/{id}/run` | Run a published workflow (batch) |
| `POST /api/sessions` | Create an interactive session |
| `POST /api/sessions/{id}/messages` | Chat with agent (SSE stream) |
| `WS /ws/execution/{id}` | Real-time execution status |

## License

MIT
