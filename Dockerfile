FROM oven/bun:1 AS bun

# llama.cpp 공식 CPU 이미지를 그대로 사용하고 MangoTL만 추가한다.
FROM ghcr.io/ggml-org/llama.cpp:server

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

ENV LOCAL_GGUF_MODE=native \
    LOCAL_GGUF_BINARY=/app/llama-server \
    LOCAL_GGUF_CACHE=/app/server/.llama-cache \
    LOCAL_GGUF_GPU_LAYERS=0 \
    LD_LIBRARY_PATH=/app \
    LLAMA_ARG_HOST=127.0.0.1 \
    LLAMA_ARG_PORT=9931

# .npmrc must come first: it points bun at the JSR registry the lockfile uses.
COPY package.json bun.lock .npmrc ./
RUN bun install --frozen-lockfile --production

COPY LICENSE ./
COPY server ./server

# Persist settings, downloaded OCR models, and GGUF models. The image result cache
# (.image-cache) is deliberately NOT a volume: the server wipes it at boot.
VOLUME ["/app/server/secrets", "/app/server/.ocr-cache", "/app/server/.llama-cache"]

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["bun", "-e", "const response = await fetch(\"http://127.0.0.1:8787/health\"); process.exit(response.ok ? 0 : 1);"]
ENTRYPOINT ["bun", "server/index.js"]
