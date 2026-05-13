/**
 * Draws the translated text directly onto the (already inpainted) canvas, so
 * the server produces a finished image and the extension only has to swap it
 * in. Text is fitted to each detected box with real canvas measurement.
 *
 * NOTE: rendering uses a system Korean font ("Apple SD Gothic Neo"). For
 * non-macOS deployment a font file should be bundled and registered via
 * `GlobalFonts` so output is consistent everywhere.
 */
const FONT_FAMILY = "'Apple SD Gothic Neo'";
const FONT_WEIGHT = 500;
const MIN_FONT = 9;
const MAX_FONT = 200;
const LINE_HEIGHT = 1.22;

export function renderTranslatedText(canvas, blocks) {
    let ctx;

    try {
        ctx = canvas.getContext("2d");
    } catch {
        return;
    }

    for (const block of blocks || []) {
        try {
            renderBlock(ctx, block);
        } catch {
            // One bad block must not abort the rest of the page.
        }
    }
}

function renderBlock(ctx, block) {
    const text = normalizeText(block.translatedText);
    const box = block.coords;

    if (!text || !box || box.width < 4 || box.height < 4) {
        return;
    }

    const padX = Math.min(box.width * 0.06, 8);
    const padY = Math.min(box.height * 0.06, 8);
    const maxWidth = box.width - padX * 2;
    const maxHeight = box.height - padY * 2;

    if (maxWidth < 2 || maxHeight < 2) {
        return;
    }

    const textColor = block.style?.textColor || "#161616";
    const strokeColor = block.style?.strokeColor || "#ffffff";

    if (block.direction === "vertical") {
        renderVertical(ctx, [...text], box, maxWidth, maxHeight, textColor, strokeColor);
    } else {
        renderHorizontal(ctx, text, box, maxWidth, maxHeight, textColor, strokeColor);
    }
}

function renderHorizontal(ctx, text, box, maxWidth, maxHeight, textColor, strokeColor) {
    let low = MIN_FONT;
    let high = Math.ceil(Math.min(MAX_FONT, maxHeight));
    let best = null;

    while (low <= high) {
        const mid = (low + high) >> 1;
        const layout = layoutHorizontal(ctx, text, mid, maxWidth);

        if (layout.maxLineWidth <= maxWidth && layout.totalHeight <= maxHeight) {
            best = { size: mid, layout };
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    if (!best) {
        best = { size: MIN_FONT, layout: layoutHorizontal(ctx, text, MIN_FONT, maxWidth) };
    }

    setFont(ctx, best.size);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.5, best.size * 0.12);
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = textColor;

    const centerX = box.x + box.width / 2;
    const startY = box.y + box.height / 2 - best.layout.totalHeight / 2 + best.layout.lineHeight / 2;

    for (let line = 0; line < best.layout.lines.length; line += 1) {
        const y = startY + line * best.layout.lineHeight;
        ctx.strokeText(best.layout.lines[line], centerX, y);
        ctx.fillText(best.layout.lines[line], centerX, y);
    }
}

function layoutHorizontal(ctx, text, size, maxWidth) {
    setFont(ctx, size);
    const widthOf = (value) => ctx.measureText(value).width;
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";

    const pushWord = (word) => {
        if (widthOf(word) <= maxWidth) {
            current = word;
            return;
        }

        const chunks = breakWord(word, widthOf, maxWidth);

        for (let index = 0; index < chunks.length - 1; index += 1) {
            lines.push(chunks[index]);
        }

        current = chunks[chunks.length - 1];
    };

    for (const word of words) {
        if (!current) {
            pushWord(word);
            continue;
        }

        if (widthOf(`${current} ${word}`) <= maxWidth) {
            current = `${current} ${word}`;
        } else {
            lines.push(current);
            current = "";
            pushWord(word);
        }
    }

    if (current) {
        lines.push(current);
    }

    const lineHeight = size * LINE_HEIGHT;
    const maxLineWidth = lines.reduce((widest, line) => Math.max(widest, widthOf(line)), 0);

    return { lines, lineHeight, totalHeight: lines.length * lineHeight, maxLineWidth };
}

function breakWord(word, widthOf, maxWidth) {
    const chunks = [];
    let chunk = "";

    for (const character of word) {
        if (chunk && widthOf(chunk + character) > maxWidth) {
            chunks.push(chunk);
            chunk = character;
        } else {
            chunk += character;
        }
    }

    if (chunk) {
        chunks.push(chunk);
    }

    return chunks.length > 0 ? chunks : [word];
}

function renderVertical(ctx, characters, box, maxWidth, maxHeight, textColor, strokeColor) {
    const glyphs = characters.filter((character) => character !== "\n");
    let low = MIN_FONT;
    let high = Math.ceil(Math.min(MAX_FONT, maxWidth));
    let best = null;

    while (low <= high) {
        const mid = (low + high) >> 1;
        const layout = layoutVertical(glyphs, mid, maxHeight);

        if (layout.totalWidth <= maxWidth) {
            best = { size: mid, layout };
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    if (!best) {
        best = { size: MIN_FONT, layout: layoutVertical(glyphs, MIN_FONT, maxHeight) };
    }

    setFont(ctx, best.size);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.5, best.size * 0.12);
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = textColor;

    const { columns, columnWidth, step } = best.layout;
    const blockWidth = columns.length * columnWidth;
    const startX = box.x + box.width / 2 + blockWidth / 2 - columnWidth / 2;

    for (let column = 0; column < columns.length; column += 1) {
        const x = startX - column * columnWidth;
        const startY = box.y + box.height / 2 - (columns[column].length * step) / 2 + step / 2;

        for (let row = 0; row < columns[column].length; row += 1) {
            const y = startY + row * step;
            ctx.strokeText(columns[column][row], x, y);
            ctx.fillText(columns[column][row], x, y);
        }
    }
}

function layoutVertical(glyphs, size, maxHeight) {
    const step = size * LINE_HEIGHT;
    const perColumn = Math.max(1, Math.floor(maxHeight / step));
    const columns = [];

    for (let index = 0; index < glyphs.length; index += perColumn) {
        columns.push(glyphs.slice(index, index + perColumn));
    }

    return { columns, columnWidth: size * 1.12, step, totalWidth: columns.length * size * 1.12 };
}

function setFont(ctx, size) {
    ctx.font = `${FONT_WEIGHT} ${size}px ${FONT_FAMILY}`;
}

function normalizeText(text) {
    return String(text || "")
        .replace(/\s*\n\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
