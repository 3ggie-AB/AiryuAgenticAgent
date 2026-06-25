#!/bin/bash
# ── Quick Start Script ────────────────────────────────────────

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔══════════════════════════════════════╗"
echo "║   PROJECT KNOWLEDGE ENGINE  v1.0.0   ║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"

# Check for .env
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  No .env file found. Creating from template...${NC}"
    cp .env.example .env
    echo -e "${RED}❗ Please set your GROQ_API_KEY in .env before continuing${NC}"
    exit 1
fi

# Load env
export $(grep -v '^#' .env | xargs)

if [ -z "$GROQ_API_KEY" ] || [ "$GROQ_API_KEY" = "your_groq_api_key_here" ]; then
    echo -e "${RED}❌ GROQ_API_KEY not set in .env${NC}"
    echo "Get your free key at: https://console.groq.com"
    exit 1
fi

TARGET=${1:-${TARGET_DIR:-$(pwd)}}
MODE=${2:-serve}

echo -e "${GREEN}✓ GROQ_API_KEY configured${NC}"
echo -e "📁 Target: ${TARGET}"
echo -e "🎯 Mode:   ${MODE}"
echo ""

case "$MODE" in
  "docker")
    echo -e "${BLUE}🐳 Starting with Docker...${NC}"
    TARGET_DIR="$TARGET" docker compose build
    TARGET_DIR="$TARGET" docker compose --profile index up indexer
    TARGET_DIR="$TARGET" docker compose up knowledge-engine
    ;;
  "index")
    echo -e "${BLUE}📇 Indexing project...${NC}"
    bun run src/index.ts index "$TARGET"
    ;;
  "watch")
    echo -e "${BLUE}👁  Starting watch mode...${NC}"
    bun run src/index.ts watch "$TARGET"
    ;;
  "serve"|*)
    echo -e "${BLUE}🚀 Indexing and starting API server...${NC}"
    bun run src/index.ts index "$TARGET"
    bun run src/index.ts serve "$TARGET"
    ;;
esac
