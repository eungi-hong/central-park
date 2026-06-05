# --- Build stage -----------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .
RUN npm run build

# --- Serve stage -----------------------------------------------------------
FROM nginx:1.27-alpine

# nginx:alpine ships envsubst (gettext) and a stock default.conf we replace.
RUN rm -f /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY docker-entrypoint.sh /usr/local/bin/cp-entrypoint.sh
RUN chmod +x /usr/local/bin/cp-entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/usr/local/bin/cp-entrypoint.sh"]
