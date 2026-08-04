# Debian-based (glibc) image — required by the onnxruntime-node / ppu-ocv native modules.
FROM oven/bun:1

WORKDIR /app

# .npmrc must come first: it points bun at the JSR registry the lockfile uses.
COPY package.json bun.lock .npmrc ./
RUN bun install --frozen-lockfile --production

COPY LICENSE ./
COPY server ./server

# Persist settings and downloaded OCR models. The image result cache (.image-cache)
# is deliberately NOT a volume: the server wipes it at boot, and rmdir fails on mount points.
VOLUME ["/app/server/secrets", "/app/server/.ocr-cache"]

EXPOSE 8787
CMD ["bun", "server/index.js"]
