# Runtime-only image:
# the frontend is built on the Mac before deployment, and the VM only serves
# the generated static assets. This keeps offline/LAN deploys fast and stable.
FROM nginx:alpine

# Config Nginx spécifique à l'app (SPA)
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf

# Fichiers statiques buildés par Vite localement
COPY frontend/dist /usr/share/nginx/html
