# 의존성 설치 전용 스테이지. npm/빌드 도구는 런타임 이미지에 남기지 않는다.
FROM node:22-bookworm-slim AS deps

WORKDIR /app

# .npmrc must come first: it points npm at the JSR registry the lockfile uses.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

# 런타임에는 node 바이너리만 가져온다.
FROM node:22-bookworm-slim AS node

# llama.cpp 공식 CPU 이미지를 그대로 사용하고 MangoTL만 추가한다.
FROM ghcr.io/ggml-org/llama.cpp:server

COPY --from=node /usr/local/bin/node /usr/local/bin/node

WORKDIR /app

ENV LOCAL_GGUF_MODE=native \
    LOCAL_GGUF_BINARY=/app/llama-server \
    LOCAL_GGUF_CACHE=/app/server/.llama-cache \
    LOCAL_GGUF_GPU_LAYERS=0 \
    LD_LIBRARY_PATH=/app \
    LLAMA_ARG_HOST=127.0.0.1 \
    LLAMA_ARG_PORT=9931

COPY --from=deps /app/node_modules ./node_modules

COPY LICENSE ./
COPY server ./server

# Persist settings, downloaded OCR models, and GGUF models. The image result cache
# (.image-cache) is deliberately NOT a volume: the server wipes it at boot.
VOLUME ["/app/server/secrets", "/app/server/.ocr-cache", "/app/server/.llama-cache"]

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch(\"http://127.0.0.1:8787/health\").then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
ENTRYPOINT ["node", "server/index.js"]
