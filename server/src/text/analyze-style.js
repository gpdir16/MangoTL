/**
 * Samples the source image to derive each text block's colours: the background
 * behind the original glyphs and the colours the translation is drawn in.
 *
 * `background` feeds the inpainting stage (which erases the original glyphs);
 * `textColor`/`strokeColor` are used by the text-rendering stage. Blocks whose
 * interior is textured (text over artwork) are flagged `skip`.
 *
 * Returns the blocks with an added `style` field; never throws — on any
 * failure it falls back to a neutral style.
 */
export function analyzeBlockStyles(blocks, canvas) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
        return blocks;
    }

    let ctx;
    let canvasWidth;
    let canvasHeight;

    try {
        ctx = canvas.getContext("2d");
        canvasWidth = canvas.width;
        canvasHeight = canvas.height;
    } catch {
        return blocks.map((block) => ({ ...block, style: neutralStyle() }));
    }

    return blocks.map((block) => {
        try {
            return { ...block, style: analyzeBlock(block, ctx, canvasWidth, canvasHeight) };
        } catch {
            return { ...block, style: neutralStyle() };
        }
    });
}

function analyzeBlock(block, ctx, canvasWidth, canvasHeight) {
    const box = clampBox(block.coords, canvasWidth, canvasHeight);

    if (!box) {
        return neutralStyle();
    }

    // The background colour is the dominant colour *inside* the detected box.
    // Glyph strokes are always the minority of a text region's pixels, so the
    // median reliably returns the bubble/page colour.
    const insidePixels = samplePixels(ctx, box, 5000);

    if (insidePixels.length < 8) {
        return neutralStyle();
    }

    const background = medianColor(insidePixels);
    const ink = estimateInkColor(insidePixels, background);
    const textColor = isLightNeutral(background) ? [26, 26, 26] : pickTextColor(ink, background);
    const bubbleBox = findBubbleInteriorBox(ctx, box, canvasWidth, canvasHeight, background);

    return {
        background: toHex(background),
        textColor: toHex(textColor),
        strokeColor: isLightNeutral(background) ? null : toHex(luminance(textColor) < 0.5 ? [255, 255, 255] : [18, 18, 18]),
        bubbleBox,
    };
}

function samplePixels(ctx, rect, maxSamples) {
    const { data } = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
    const totalPixels = rect.width * rect.height;
    const step = Math.max(1, Math.floor(Math.sqrt(totalPixels / maxSamples)));
    const pixels = [];

    for (let row = 0; row < rect.height; row += step) {
        for (let col = 0; col < rect.width; col += step) {
            const idx = (row * rect.width + col) * 4;
            pixels.push([data[idx], data[idx + 1], data[idx + 2]]);
        }
    }

    return pixels;
}

function estimateInkColor(pixels, background) {
    const far = pixels.filter((pixel) => colorDistance(pixel, background) > 80);

    if (far.length < Math.max(6, pixels.length * 0.02)) {
        return null;
    }

    return meanColor(far);
}

function pickTextColor(ink, background) {
    const bgIsDark = luminance(background) < 0.5;
    const fallback = bgIsDark ? [245, 245, 245] : [22, 22, 22];

    if (!ink || contrastRatio(ink, background) < 2.6) {
        return fallback;
    }

    // Anti-aliased edge pixels wash the sampled ink toward mid-grey. When the
    // ink is essentially greyscale, snap it back to a crisp near-black (or
    // near-white) so dialogue reads sharply; keep genuinely coloured ink as-is.
    const saturation = Math.max(...ink) - Math.min(...ink);

    if (saturation < 42) {
        return luminance(ink) < 0.5 ? [26, 26, 26] : [240, 240, 240];
    }

    return ink;
}

function clampBox(coords, canvasWidth, canvasHeight) {
    if (!coords) {
        return null;
    }

    const x = clamp(Math.round(coords.x), 0, canvasWidth - 1);
    const y = clamp(Math.round(coords.y), 0, canvasHeight - 1);
    const width = clamp(Math.round(coords.width), 1, canvasWidth - x);
    const height = clamp(Math.round(coords.height), 1, canvasHeight - y);

    if (width < 1 || height < 1) {
        return null;
    }

    return { x, y, width, height };
}

function medianColor(pixels) {
    return [0, 1, 2].map((channel) => {
        const values = pixels.map((pixel) => pixel[channel]).sort((a, b) => a - b);
        return values[Math.floor(values.length / 2)];
    });
}

function meanColor(pixels) {
    const totals = pixels.reduce((acc, pixel) => [acc[0] + pixel[0], acc[1] + pixel[1], acc[2] + pixel[2]], [0, 0, 0]);
    return totals.map((total) => Math.round(total / pixels.length));
}

function luminance([r, g, b]) {
    const linear = [r, g, b].map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a, b) {
    const lighter = Math.max(luminance(a), luminance(b));
    const darker = Math.min(luminance(a), luminance(b));
    return (lighter + 0.05) / (darker + 0.05);
}

function colorDistance(a, b) {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function toHex(color) {
    return `#${color.map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function neutralStyle() {
    return {
        background: "#ffffff",
        textColor: "#161616",
        strokeColor: null,
        bubbleBox: null,
    };
}

function findBubbleInteriorBox(ctx, box, canvasWidth, canvasHeight, background) {
    if (!isLightNeutral(background)) {
        return null;
    }

    const margin = Math.round(Math.max(44, Math.min(120, Math.max(box.width, box.height) * 0.85)));
    const windowBox = {
        x: clamp(box.x - margin, 0, canvasWidth - 1),
        y: clamp(box.y - margin, 0, canvasHeight - 1),
        width: clamp(box.width + margin * 2, 1, canvasWidth - clamp(box.x - margin, 0, canvasWidth - 1)),
        height: clamp(box.height + margin * 2, 1, canvasHeight - clamp(box.y - margin, 0, canvasHeight - 1)),
    };

    const { data } = ctx.getImageData(windowBox.x, windowBox.y, windowBox.width, windowBox.height);
    const localBox = {
        x: box.x - windowBox.x,
        y: box.y - windowBox.y,
        width: box.width,
        height: box.height,
    };
    const seed = findBackgroundSeed(data, windowBox.width, windowBox.height, localBox, background);

    if (seed < 0) {
        return null;
    }

    const region = floodSimilarBackground(data, windowBox.width, windowBox.height, seed, background);
    const regionBox = regionBounds(region, windowBox.width, windowBox.height);

    if (!regionBox) {
        return null;
    }

    const expanded = {
        x: windowBox.x + regionBox.x,
        y: windowBox.y + regionBox.y,
        width: regionBox.width,
        height: regionBox.height,
    };

    const originalArea = box.width * box.height;
    const expandedArea = expanded.width * expanded.height;

    if (expandedArea < originalArea * 1.18 || expandedArea > originalArea * 14) {
        return null;
    }

    return expanded;
}

function isLightNeutral(color) {
    const brightness = (color[0] + color[1] + color[2]) / 3;
    const saturation = Math.max(...color) - Math.min(...color);
    return brightness > 226 && saturation < 38;
}

function findBackgroundSeed(data, width, height, box, background) {
    const startX = clamp(Math.floor(box.x), 0, width - 1);
    const startY = clamp(Math.floor(box.y), 0, height - 1);
    const endX = clamp(Math.ceil(box.x + box.width), startX + 1, width);
    const endY = clamp(Math.ceil(box.y + box.height), startY + 1, height);

    for (let y = startY; y < endY; y += 2) {
        for (let x = startX; x < endX; x += 2) {
            const index = y * width + x;

            if (isBackgroundPixel(data, index, background)) {
                return index;
            }
        }
    }

    return -1;
}

function floodSimilarBackground(data, width, height, seed, background) {
    const visited = new Uint8Array(width * height);
    const stack = [seed];
    visited[seed] = 1;

    while (stack.length > 0) {
        const index = stack.pop();
        const x = index % width;
        const y = (index / width) | 0;

        for (const neighbor of [
            x > 0 ? index - 1 : -1,
            x < width - 1 ? index + 1 : -1,
            y > 0 ? index - width : -1,
            y < height - 1 ? index + width : -1,
        ]) {
            if (neighbor >= 0 && !visited[neighbor] && isBackgroundPixel(data, neighbor, background)) {
                visited[neighbor] = 1;
                stack.push(neighbor);
            }
        }
    }

    return visited;
}

function isBackgroundPixel(data, index, background) {
    const offset = index * 4;
    const color = [data[offset], data[offset + 1], data[offset + 2]];
    return colorDistance(color, background) < 44;
}

function regionBounds(region, width, height) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let index = 0; index < region.length; index += 1) {
        if (!region[index]) {
            continue;
        }

        const x = index % width;
        const y = (index / width) | 0;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }

    if (maxX < minX || maxY < minY) {
        return null;
    }

    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    };
}
