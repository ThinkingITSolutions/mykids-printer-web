# MyKids Printer Web — imagem única (painel + agente + renderizador iText).
# Coolify: usar docker-compose.yml (network_mode: host, necessário para achar as impressoras via mDNS).

# ---------- 1. modelos embutidos do app oficial (baixados do instalador público da Gileade)
FROM debian:trixie-slim AS vendor
ARG MYKIDS_INSTALLER_URL=https://s3.sa-east-1.amazonaws.com/web.gileadesistemas.com.br/DriverImpressora/MyKids+Printer+1.3.5.exe
RUN apt-get update && apt-get install -y --no-install-recommends innoextract unzip curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /work
COPY scripts/extract-templates.sh scripts/
RUN curl -fsSL -o installer.exe "$MYKIDS_INSTALLER_URL" \
 && innoextract -s -d extracted installer.exe \
 && sh scripts/extract-templates.sh extracted/app/mykids-printer-1.0.jar \
 && rm -rf installer.exe extracted

# ---------- 2. renderizador Java (iText html2pdf 2.1.3 / 7.1.6 do Maven Central)
FROM eclipse-temurin:21-jdk AS renderer
WORKDIR /renderer
COPY apps/renderer/fetch-libs.sh apps/renderer/src ./
RUN mkdir -p src && mv RenderServer.java src/ && sh fetch-libs.sh && mkdir build && javac --release 17 -cp "lib/*" -d build src/RenderServer.java

# ---------- 3. build Node (server + web)
FROM node:26-trixie-slim AS build
RUN npm install -g pnpm@11.3.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter web build && pnpm --filter server build \
 && pnpm --filter server deploy --prod --legacy /out/server

# ---------- 4. runtime
FROM node:26-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jre-headless poppler-utils ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=America/Sao_Paulo PORT=8080 DATA_DIR=/data \
    WEB_DIR=/app/web RENDERER_DIR=/app/renderer VENDOR_TEMPLATES_DIR=/app/vendor-templates
WORKDIR /app/server
COPY --from=build /out/server ./
COPY --from=build /app/apps/web/dist /app/web
COPY --from=renderer /renderer/build /app/renderer/build
COPY --from=renderer /renderer/lib /app/renderer/lib
COPY --from=vendor /work/vendor-templates /app/vendor-templates
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
