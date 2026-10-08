# Site do painel (React) servido pelo Caddy, que também faz o HTTPS e repassa /api para a API.
FROM node:20-bookworm-slim AS build
WORKDIR /src
COPY frontend/package.json ./
RUN corepack enable && yarn install --network-timeout 600000
COPY frontend/ ./
# vazio = o site chama a API no mesmo endereço em que foi aberto (/api)
ENV REACT_APP_BACKEND_URL="" GENERATE_SOURCEMAP=false CI=false NODE_OPTIONS=--max-old-space-size=3072
RUN yarn build

FROM caddy:2
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/build /srv
