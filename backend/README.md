# 🧠 Project Knowledge Engine

Multi-agent AI system yang menganalisis codebase secara paralel menggunakan **Bun + Groq (LLaMA) + SQLite Knowledge Graph**.

## Arsitektur

```
Source Code
      │
      ▼
Parser (TypeScript/Go/Python/Rust)
      │
      ▼ (Parallel Workers)
┌─────┬─────┬─────┬─────┬─────┐
│ W1  │ W2  │ W3  │ W4  │ W5  │
│auth/│pay/ │user/│api/ │util/│
└──┬──┴──┬──┴──┬──┴──┬──┴──┬──┘
   └─────┴─────┴─────┴─────┘
                  │
                  ▼
         Knowledge Graph (SQLite)
         ┌──────────────────┐
         │ Nodes: Functions │
         │ Structs, Routes  │
         │ Interfaces, etc  │
         │                  │
         │ Edges: calls,    │
         │ imports, extends │
         └──────────────────┘
                  │
      ┌───────────┼───────────┐
      ▼           ▼           ▼
Architecture   Coding     Security
  Agent         Agent      Agent
      │           │           │
      └─────── Groq AI ───────┘
            (LLaMA 3.3 70B)
```

## Setup

### 1. Clone

```bash
git clone <repo>
cd AiryuAgenticAgent/backend
```

### 2. Konfigurasi

```bash
cp .env.example .env
# Edit .env dan isi GROQ_API_KEY
```

Dapatkan Groq API key gratis di: https://console.groq.com

### 3. Jalankan

#### Docker

Cara paling praktis adalah lewat Docker Compose. Pastikan Docker sudah jalan, lalu siapkan `.env`:

```bash
cp .env.example .env
```

Edit `.env`:

```env
GROQ_API_KEY=isi_groq_api_key_kamu
TARGET_DIR=/path/ke/project/yang/mau/dianalisis
PORT=3000
```

Contoh kalau mau menganalisis folder contoh bawaan repo:

```env
TARGET_DIR=./example
```

Build image:

```bash
docker compose --profile index build
```

Jalankan API server di background:

```bash
docker compose up -d knowledge-engine
```

Index codebase sekali:

```bash
docker compose --profile index run --rm indexer
```

Setelah server jalan, test endpoint:

```bash
curl "http://localhost:${PORT:-3000}/health"
curl "http://localhost:${PORT:-3000}/stats"
```

Kalau mau mode watch supaya perubahan file otomatis di-index ulang:

```bash
docker compose --profile watch up watcher
```

Lihat log API server:

```bash
docker compose logs -f knowledge-engine
```

Stop semua container:

```bash
docker compose down
```

#### Local (tanpa Docker)

Kalau mau jalan langsung di mesin lokal, install dependency dulu:

```bash
bun install
```

```bash
# Index project kamu
bun run src/index.ts index /path/to/your/project

# Jalankan API server
bun run src/index.ts serve /path/to/your/project

# Watch mode (auto re-index saat file berubah)
bun run src/index.ts watch /path/to/your/project
```

## CLI Commands

```bash
# Index codebase
bun run src/index.ts index [dir]

# Watch untuk perubahan + auto re-index
bun run src/index.ts watch [dir]

# Jalankan API server
bun run src/index.ts serve [dir]

# Tanya tentang codebase
bun run src/index.ts query "siapa yang memanggil fungsi loginUser?"

# Jalankan agent spesifik
bun run src/index.ts agent security "cari vulnerability di auth service"
bun run src/index.ts agent architecture "jelaskan struktur payment module"
bun run src/index.ts agent performance "ada bottleneck di mana?"

# Impact analysis
bun run src/index.ts impact loginUser

# Summary project
bun run src/index.ts summary

# Stats graph
bun run src/index.ts stats
```

## API Endpoints

```
GET  /              - Info & daftar endpoints
GET  /health        - Health check + stats
GET  /stats         - Graph statistics
GET  /summary       - Project summary (text)

POST /search        - Cari node berdasarkan keyword
GET  /node/:id      - Get node by ID
GET  /file?path=    - Semua node di sebuah file
GET  /nodes/by-name/:name - Cari node by name

GET  /callers/:name      - Siapa yang memanggil fungsi ini?
GET  /callchain/:name    - Call graph (depth=3)
GET  /impact/:name       - Impact analysis (file mana yang terdampak?)

POST /query         - Tanya AI tentang codebase
POST /agent         - Jalankan multi-agent analysis
```

### Contoh API Call

```bash
# Search
curl -X POST http://localhost:3000/search \
  -H "Content-Type: application/json" \
  -d '{"query": "authentication login"}'

# Tanya AI
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"question": "Fungsi mana yang menangani JWT refresh token?"}'

# Multi-agent analysis
curl -X POST http://localhost:3000/agent \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Analisis auth service ini",
    "agents": ["security", "coding", "performance"],
    "searchQuery": "auth login jwt"
  }'

# Impact analysis
curl http://localhost:3000/impact/loginUser

# Call chain
curl http://localhost:3000/callchain/loginUser?depth=4
```

## Event System (Auto Re-index)

```
save auth/service.ts
        │
        ▼
  File Changed Event
        │
        ▼
  Re-parse file
        │
        ▼
  Delete old nodes/edges
        │
        ▼
  Insert new nodes/edges
        │
        ▼
  Knowledge Graph Updated ✓
```

Hanya file yang berubah yang diproses ulang — tidak perlu re-index seluruh project.

## Agent Types

| Agent | Fokus |
|-------|-------|
| `architecture` | Struktur sistem, module boundaries, dependency flows |
| `coding` | Code quality, patterns, implementation review |
| `security` | Vulnerabilities, SQL injection, exposed secrets |
| `performance` | N+1 queries, memory leaks, bottlenecks |
| `testing` | Test coverage, edge cases, test quality |
| `documentation` | Missing docs, API documentation quality |

## Knowledge Graph Queries

```
"Siapa yang memanggil fungsi ini?"     → GET /callers/:name
"Interface apa yang diimplementasikan?" → POST /search + type filter
"Endpoint mana yang pakai service ini?" → POST /search + route type
"File mana yang terdampak jika berubah?" → GET /impact/:name
```

## Tech Stack

- **Runtime**: Bun (TypeScript)
- **AI**: Groq API (LLaMA 3.3 70B)
- **Database**: SQLite (better-sqlite3)
- **API**: Hono
- **File Watch**: Chokidar
- **Parallelism**: Promise.all + p-limit
- **Container**: Docker + Docker Compose
