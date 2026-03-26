#!/bin/bash
# ============================================================
# Budowlaniec Bot — skrypt deployment na serwer
# Uruchom na serwerze: bash deploy.sh
# ============================================================

set -e

echo "🏗️ Budowlaniec Bot — Deployment"
echo "================================"

# === 1. Instalacja Docker (jeśli nie ma) ===
if ! command -v docker &> /dev/null; then
    echo "📦 Instaluję Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "✅ Docker zainstalowany"
else
    echo "✅ Docker już zainstalowany"
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "📦 Instaluję Docker Compose..."
    apt-get update && apt-get install -y docker-compose-plugin
    echo "✅ Docker Compose zainstalowany"
else
    echo "✅ Docker Compose już zainstalowany"
fi

# === 2. Katalog projektu ===
PROJECT_DIR="/opt/budowlaniec-bot"
mkdir -p $PROJECT_DIR
cd $PROJECT_DIR

echo "📁 Katalog projektu: $PROJECT_DIR"

# === 3. Instalacja Nginx ===
if ! command -v nginx &> /dev/null; then
    echo "📦 Instaluję Nginx..."
    apt-get update && apt-get install -y nginx
    systemctl enable nginx
    echo "✅ Nginx zainstalowany"
else
    echo "✅ Nginx już zainstalowany"
fi

# === 4. Konfiguracja Nginx (reverse proxy) ===
echo "⚙️ Konfiguruję Nginx..."
cat > /etc/nginx/sites-available/budowlaniec <<'NGINX'
server {
    listen 80;
    server_name _;

    # Landing page
    location / {
        proxy_pass http://localhost:3000/landing;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Dashboard
    location /dashboard {
        proxy_pass http://localhost:3000/dashboard;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # WebApp (Telegram Mini App)
    location /webapp {
        proxy_pass http://localhost:3000/webapp;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # API
    location /api/ {
        proxy_pass http://localhost:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Agents
    location /agents/ {
        proxy_pass http://localhost:3000/agents/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # Health
    location /health {
        proxy_pass http://localhost:3000/health;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/budowlaniec /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "✅ Nginx skonfigurowany"

# === 5. SSL z Let's Encrypt (opcjonalnie) ===
echo ""
echo "🔒 SSL/HTTPS:"
echo "   Jeśli masz domenę, uruchom:"
echo "   apt install certbot python3-certbot-nginx"
echo "   certbot --nginx -d twojadomena.pl"
echo ""

# === 6. Informacja o następnych krokach ===
echo "================================"
echo "✅ Serwer przygotowany!"
echo ""
echo "Teraz skopiuj pliki projektu na serwer:"
echo "  scp -r . root@46.225.131.52:/opt/budowlaniec-bot/"
echo ""
echo "Lub użyj git:"
echo "  cd /opt/budowlaniec-bot"
echo "  git clone <twoje-repo-url> ."
echo ""
echo "Potem:"
echo "  cd /opt/budowlaniec-bot"
echo "  cp .env.example .env"
echo "  # Uzupełnij .env (token Telegram + klucz Anthropic)"
echo "  docker compose up -d"
echo ""
echo "Bot będzie dostępny na: http://46.225.131.52"
echo "Dashboard: http://46.225.131.52/dashboard"
echo "WebApp: http://46.225.131.52/webapp"
echo "================================"
