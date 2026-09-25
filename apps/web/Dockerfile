# --- Aşama 1: build ---
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Prod'da API ve Keycloak aynı origin'den (gateway) servis edilir.
ENV VITE_KEYCLOAK_URL=/auth \
    VITE_KEYCLOAK_REALM=hr360 \
    VITE_KEYCLOAK_CLIENT_ID=hr360-web \
    VITE_API_BASE=
RUN npm run build

# --- Aşama 2: serve ---
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
