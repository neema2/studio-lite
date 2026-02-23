# Studio Lite

A lightweight web IDE for [Legend Lite](https://github.com/neema2/legend-lite) — write Pure models, execute queries, ask questions in natural language, and visualize class diagrams.

## Features

- **Pure Editor** — Monaco-based editor with syntax highlighting, LSP diagnostics, and autocompletion
- **Pure Query Execution** — Write Pure queries and execute them against DuckDB with results in a data grid
- **Raw SQL** — Execute SQL directly against the runtime's database connection
- **Ask AI** — Natural language to Pure query (powered by Gemini LLM via the NLQ pipeline)
- **Class Diagram** — Interactive Cytoscape.js graph of classes, associations, and generalisations

## Quick Start

### Prerequisites

- **Node.js 18+**
- **Legend Lite backend** running on `http://localhost:8080` (see below)

### 1. Start the Backend

In the `legend-lite` repo:

```bash
# Without NLQ (engine only)
mvn exec:java -pl engine \
  -Dexec.mainClass="org.finos.legend.engine.server.LegendHttpServer"

# With NLQ (Ask AI feature)
GEMINI_API_KEY=your-key-here \
mvn exec:java -pl nlq \
  -Dexec.mainClass="org.finos.legend.engine.nlq.NlqHttpServer"
```

The backend starts on port 8080. The frontend expects this — if you change the port, update `BASE_URL` in `src/lspClient.ts`.

### 2. Start the Frontend

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. The app shows a connection indicator in the header — green means the backend is reachable.

---

## Tabs

| Tab | Description |
|-----|-------------|
| **Pure Query** | Write and execute Pure expressions against the model defined in the left editor |
| **Raw SQL** | Execute SQL directly against the runtime's DuckDB connection |
| **Ask AI** | Type a natural language question, get a Pure query back (requires NLQ backend) |
| **Diagram** | Interactive class diagram extracted from the Pure model |

### Ask AI Workflow

1. Type a question like *"show me total PnL by trader for the AMER equity desk"*
2. The pipeline runs: Retrieve classes → Route to root → Plan query → Generate Pure
3. The generated Pure query appears in the result panel
4. Click **"Open in Pure Editor →"** to copy it to the Pure Query tab and execute it

---

## Project Structure

```
src/
  App.tsx          — Main app component with all tabs and query execution
  App.css          — Full styling (dark theme)
  lspClient.ts     — HTTP client for all backend endpoints
  DiagramView.tsx  — Cytoscape.js class diagram renderer
```

## Backend Endpoints Used

| Endpoint | Used By |
|----------|---------|
| `POST /lsp` | Model editor (diagnostics, completions) |
| `POST /engine/execute` | Pure Query tab |
| `POST /engine/sql` | Raw SQL tab |
| `POST /engine/nlq` | Ask AI tab |
| `POST /engine/diagram` | Diagram tab |
| `GET /health` | Connection indicator |

## Configuration

The backend URL is configured in `src/lspClient.ts`:

```typescript
const BASE_URL = 'http://localhost:8080';
```

---

## Building

```bash
npm run build    # Production build → dist/
npm run preview  # Preview production build
```

## License

Apache 2.0
