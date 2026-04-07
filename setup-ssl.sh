#!/bin/bash
set -e

echo "=== Requesting SSL certificate ==="
certbot certonly --webroot -w /var/www/html \
  -d aicmo.site -d www.aicmo.site \
  --non-interactive --agree-tos --email admin@aicmo.site

echo "=== Updating nginx config ==="
cat > /www/server/panel/vhost/nginx/ai-cmo.conf << 'NGXEOF'
# HTTP -> HTTPS redirect
server {
    listen 80;
    server_name www.aicmo.site aicmo.site 43.160.243.154;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://www.aicmo.site$request_uri;
    }
}

# aicmo.site -> www.aicmo.site redirect
server {
    listen 443 ssl;
    server_name aicmo.site;

    ssl_certificate /etc/letsencrypt/live/aicmo.site/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/aicmo.site/privkey.pem;

    return 301 https://www.aicmo.site$request_uri;
}

# Main HTTPS server
server {
    listen 443 ssl;
    http2 on;
    server_name www.aicmo.site;

    ssl_certificate /etc/letsencrypt/live/aicmo.site/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/aicmo.site/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-CHACHA20-POLY1305;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;

    access_log /www/wwwlogs/aicmo.site.log;
    error_log /www/wwwlogs/aicmo.site.error.log;

    location / {
        proxy_pass http://127.0.0.1:9010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api {
        proxy_pass http://127.0.0.1:9011;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
        proxy_buffering off;
        client_max_body_size 50M;
    }

    location /health {
        proxy_pass http://127.0.0.1:9011/health;
        proxy_set_header Host $host;
    }

    location /docs {
        proxy_pass http://127.0.0.1:9011/docs;
        proxy_set_header Host $host;
    }

    location /openapi.json {
        proxy_pass http://127.0.0.1:9011/openapi.json;
        proxy_set_header Host $host;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
    gzip_min_length 1000;
}
NGXEOF

echo "=== Testing nginx ==="
nginx -t && nginx -s reload

echo "=== Restarting backend (for CORS update) ==="
cd /home/ai-cmo && bash deploy.sh --be

echo "=== Done! ==="
echo "Visit: https://www.aicmo.site"
