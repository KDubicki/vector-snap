# syntax=docker/dockerfile:1

FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
# Build, then keep a .gz copy of every text file for nginx's gzip_static: compressed
# once at the highest level here instead of on every request.
RUN npm run build \
    && find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \
        -o -name '*.svg' -o -name '*.json' \) -size +1k -exec gzip -9 -k {} +

FROM nginx:1.31-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
    CMD ["wget", "-q", "--spider", "http://127.0.0.1/"]
