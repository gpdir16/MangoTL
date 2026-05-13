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
    const textColor = pickTextColor(ink, background);

    return {
        background: toHex(background),
        textColor: toHex(textColor),
        strokeColor: toHex(luminance(textColor) < 0.5 ? [255, 255, 255] : [18, 18, 18]),
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
        strokeColor: "#ffffff",
    };
}
