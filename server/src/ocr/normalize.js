/**
 * Normalizes a raw recognition result into the shape consumed by the
 * translation pipeline: an array of { id, text, confidence, coords }.
 *
 * Recognition engines (paddle, mangaocr) return:
 *   [{ text, box, confidence }]
 */
export function normalizeOcrResult(raw, detection, ocrEngineConfig) {
    const items = Array.isArray(raw) ? raw : [];
    const filters = ocrEngineConfig.filters || {};
    const imageSize = { width: detection.width, height: detection.height };

    return items
        .map((item, index) => ({
            id: item.id ?? `ocr-${index + 1}`,
            text: extractText(item),
            confidence: extractConfidence(item),
            coords: extractCoords(item),
        }))
        .filter((item) => isUsableOcrItem(item, filters, imageSize));
}

function isUsableOcrItem(item, filters, imageSize) {
    const text = item.text.replace(/\s+/g, "");

    if (!text) {
        return false;
    }

    if (!item.coords) {
        return false;
    }

    if (typeof item.confidence === "number" && item.confidence < (filters.minConfidence ?? 0)) {
        return false;
    }

    if ((filters.rejectSingleCharacters ?? false) && text.length < (filters.minTextLength ?? 1) && !/[!?！？…]/.test(text)) {
        return false;
    }

    if (filters.maxTextAreaRatio) {
        const textArea = item.coords.width * item.coords.height;
        const imageArea = imageSize.width * imageSize.height;

        if (imageArea > 0 && textArea / imageArea > filters.maxTextAreaRatio) {
            return false;
        }
    }

    return true;
}

function extractText(item) {
    const text = item.text || "";
    return String(text).trim();
}

function extractConfidence(item) {
    const confidence = item.confidence ?? null;

    if (confidence === null) {
        return null;
    }

    const numericConfidence = Number(confidence);

    return Number.isFinite(numericConfidence) ? numericConfidence : null;
}

function extractCoords(item) {
    const rawBox = item.coords || item.box;
    return boxToRect(rawBox);
}

function boxToRect(rawBox) {
    if (!rawBox) {
        return null;
    }

    if (Array.isArray(rawBox) && rawBox.length === 4 && rawBox.every((value) => Number.isFinite(Number(value)))) {
        const [x, y, third, fourth] = rawBox.map(Number);
        return {
            x,
            y,
            width: Math.max(1, third),
            height: Math.max(1, fourth),
        };
    }

    if (Array.isArray(rawBox) && rawBox.every((point) => Array.isArray(point) && point.length >= 2)) {
        const xs = rawBox.map((point) => Number(point[0])).filter(Number.isFinite);
        const ys = rawBox.map((point) => Number(point[1])).filter(Number.isFinite);
        return rectFromExtents(xs, ys);
    }

    if (typeof rawBox === "object") {
        const x = rawBox.x ?? rawBox.left ?? rawBox.minX ?? rawBox.x1;
        const y = rawBox.y ?? rawBox.top ?? rawBox.minY ?? rawBox.y1;
        const right = rawBox.right ?? rawBox.maxX ?? rawBox.x2;
        const bottom = rawBox.bottom ?? rawBox.maxY ?? rawBox.y2;
        const width = rawBox.width ?? rawBox.w ?? (right !== undefined ? right - x : undefined);
        const height = rawBox.height ?? rawBox.h ?? (bottom !== undefined ? bottom - y : undefined);

        if ([x, y, width, height].every((value) => Number.isFinite(Number(value)))) {
            return {
                x: Number(x),
                y: Number(y),
                width: Math.max(1, Number(width)),
                height: Math.max(1, Number(height)),
            };
        }
    }

    return null;
}

function rectFromExtents(xs, ys) {
    if (xs.length === 0 || ys.length === 0) {
        return null;
    }

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
    };
}
