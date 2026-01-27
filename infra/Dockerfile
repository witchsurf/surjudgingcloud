# 1. Build du frontend (Vite) à partir du dossier frontend/
FROM node:20 AS builder

WORKDIR /app

# Installer les deps (lockfile à jour)
COPY frontend/package*.json ./
RUN npm ci

# Copier le code front et builder
COPY frontend/ .
RUN npm run build

# 2. Nginx pour servir le build
FROM nginx:alpine

# Config Nginx spécifique à l'app (SPA)
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf

# Fichiers statiques buildés par Vite
COPY --from=builder /app/dist /usr/share/nginx/html
