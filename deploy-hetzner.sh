#!/bin/bash
# ═══════════════════════════════════════════════════
#  Spektra Agent Network — Hetzner Deployment Script
#  Uruchom na serwerze: bash deploy-hetzner.sh
# ═══════════════════════════════════════════════════

set -e

echo "⚡ ════════════════════════════════════"
echo "⚡  Spektra Agent Network v3.0"
echo "⚡  Deployment na Hetzner"
echo "⚡ ════════════════════════════════════"

PROJECT_DIR="/root/projects/spektra"
REPO_URL="https://github.com/dsdgold/budowlaniec-bot.git"
BRANCH="claude/agent-network-hetzner-8qdZI"

# ─── 1. Docker & Docker Compose ───
echo ""
echo "📦 [1/6] Sprawdzam Docker..."
if ! command -v docker &> /dev/null; then
    echo "Instaluję Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "Instaluję Docker Compose..."
    apt-get update && apt-get install -y docker-compose-plugin
fi

echo "✅ Docker gotowy: $(docker --version)"

# ─── 2. Nginx ───
echo ""
echo "🌐 [2/6] Konfiguracja Nginx..."
if ! command -v nginx &> /dev/null; then
    apt-get update && apt-get install -y nginx
    systemctl enable nginx
fi

# Konfiguracja Nginx z WebSocket support
cat > /etc/nginx/sites-available/spektra <<'NGINX'
server {
    listen 80;
    server_name _;

    # Dashboard (domyślna strona)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket endpoint
    location /ws {
        proxy_pass http://127.0.0.1:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Agent triggers
    location /agents/ {
        proxy_pass http://127.0.0.1:3000/agents/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # Health
    location /health {
        proxy_pass http://127.0.0.1:3000/health;
    }

    # Landing page
    location /landing {
        proxy_pass http://127.0.0.1:3000/landing;
    }

    # WebApp
    location /webapp {
        proxy_pass http://127.0.0.1:3000/webapp;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/spektra /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "✅ Nginx skonfigurowany z WebSocket support"

# ─── 3. Klonowanie/aktualizacja repo ───
echo ""
echo "📥 [3/6] Pobieranie kodu..."
if [ -d "$PROJECT_DIR" ]; then
    cd "$PROJECT_DIR"
    git fetch origin "$BRANCH"
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
else
    git clone -b "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
fi
echo "✅ Kod pobrany"

# ─── 4. Plik .env ───
echo ""
echo "🔑 [4/6] Sprawdzam .env..."
if [ ! -f "$PROJECT_DIR/.env" ]; then
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    echo "⚠️  WAŻNE: Edytuj plik .env i ustaw TELEGRAM_BOT_TOKEN oraz ANTHROPIC_API_KEY!"
    echo "   nano $PROJECT_DIR/.env"
fi

# ─── 5. Build & Deploy ───
echo ""
echo "🏗️ [5/6] Buduję i uruchamiam kontenery..."
cd "$PROJECT_DIR"

# Zatrzymaj stare kontenery (jeśli istnieją)
docker compose down 2>/dev/null || true

# Build i uruchom
docker compose up -d --build

echo "⏳ Czekam na uruchomienie usług..."
sleep 10

# ─── 6. Weryfikacja ───
echo ""
echo "🔍 [6/6] Weryfikacja..."
echo ""

# Health check
HEALTH=$(curl -s http://localhost:3000/health 2>/dev/null || echo '{"status":"error"}')
echo "Health: $HEALTH"

# Network status
NETWORK=$(curl -s http://localhost:3000/api/network 2>/dev/null || echo '{"error":"not ready"}')
echo "Network: $NETWORK" | head -c 200

echo ""
echo ""
echo "⚡ ════════════════════════════════════"
echo "⚡  Spektra Agent Network DEPLOYED!"
echo "⚡ ════════════════════════════════════"
echo ""
echo "  🌐 Dashboard:  http://$(curl -s ifconfig.me):80"
echo "  📡 API:        http://$(curl -s ifconfig.me):80/api/network"
echo "  🔌 WebSocket:  ws://$(curl -s ifconfig.me):80/ws"
echo "  💚 Health:     http://$(curl -s ifconfig.me):80/health"
echo "  📋 Landing:    http://$(curl -s ifconfig.me):80/landing"
echo ""
echo "  📊 Zarządzanie:"
echo "  docker compose logs -f    # Logi"
echo "  docker compose restart    # Restart"
echo "  docker compose down       # Zatrzymaj"
echo ""
