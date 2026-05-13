/**
 * Removes the original text from the source image so the translation can be
 * laid over a clean background — no covering rectangle.
 *
 * Per block: the region around the detected box is segmented into areas of
 * locally-similar colour. The largest area touching the box is the surface the
 * text sits on (a bubble interior, a flat panel, or a smooth gradient — found
 * without guessing its colour). The glyphs are the smaller areas it encloses;
 * those are masked and reconstructed by diffusing the surface inward, while the
 * outline / artwork beyond the box is left untouched.
 *
 * `inpaintTextRegions` mutates the canvas in place; `encodeImage` exports it.
 */
export function inpaintTextRegions(canvas, blocks) {
    let ctx;

    try {
        ctx = canvas.getContext("2d");
    } catch {
        return;
    }

    for (const block of blocks || []) {
        try {
            inpaintBlock(ctx, canvas.width, canvas.height, block);
        } catch {
            // A single bad block must not abort the whole image.
        }
    }
}

export function encodeImage(canvas) {
    // @napi-rs/canvas takes JPEG quality on a 0–100 scale.
    const buffer = canvas.toBuffer("image/jpeg", 92);
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

// Two adjacent pixels belong to the same region when they differ by less than
// this. Smooth gradients chain together (each step is tiny) while a glyph edge
// — a sharp jump from ink to background — does not, so glyphs stay separate.
const REGION_SIMILARITY = 26;

function inpaintBlock(ctx, canvasWidth, canvasHeight, block) {
    // Pad the box just enough to catch a glyph's anti-aliased spill past the
    // detected bounds. A wider pad risks swallowing a separate nearby caption.
    const margin = 12;
    const boxX = Math.round(block.coords.x);
    const boxY = Math.round(block.coords.y);
    const x = clamp(boxX - margin, 0, canvasWidth - 1);
    const y = clamp(boxY - margin, 0, canvasHeight - 1);
    const width = clamp(Math.round(block.coords.width) + (boxX - x) + margin, 1, canvasWidth - x);
    const height = clamp(Math.round(block.coords.height) + (boxY - y) + margin, 1, canvasHeight - y);

    if (width < 3 || height < 3) {
        return;
    }

    // The detected box, expressed in region-local coordinates.
    const innerBox = {
        x: boxX - x,
        y: boxY - y,
        width: Math.round(block.coords.width),
        height: Math.round(block.coords.height),
    };

    const imageData = ctx.getImageData(x, y, width, height);
    const pixelCount = width * height;

    // The region to reconstruct from: the largest connected run of pixels
    // joined by local similarity that touches the detected box. This finds the
    // bubble interior, a flat panel, OR a smooth gradient — whatever colour it
    // is — without guessing a background colour up front (a guess fails when a
    // thick white glyph halo is mistaken for the background). The glyphs, being
    // sharply different from what they sit on, remain as separate regions.
    const interior = largestSmoothRegion(imageData.data, width, height, innerBox);

    if (!interior) {
        return;
    }

    // Fallback colour for any masked pixel the reconstruction cannot reach:
    // the median of the interior region.
    const background = medianColorOfMask(imageData.data, interior, pixelCount);

    // Everything reachable from the region border without entering the
    // interior — the outline and the artwork beyond it.
    const outside = floodFill(width, height, borderSeeds(width, height), (index) => interior[index] === 0);

    // Glyphs are the non-interior pixels the outside flood could not reach:
    // holes fully enclosed by the bubble interior.
    const mask = new Uint8Array(pixelCount);

    for (let index = 0; index < pixelCount; index += 1) {
        mask[index] = !interior[index] && !outside[index] ? 1 : 0;
    }

    dilateMask(mask, width, height, 3);

    // Dilation may have crept onto outline/artwork pixels — keep those frozen.
    for (let index = 0; index < pixelCount; index += 1) {
        if (outside[index]) {
            mask[index] = 0;
        }
    }

    reconstruct(imageData.data, mask, interior, width, height, background);
    ctx.putImageData(imageData, x, y);
}

/** Iterative 4-connected flood fill; returns a visited mask. */
function floodFill(width, height, seeds, passable) {
    const visited = new Uint8Array(width * height);
    const stack = [];

    for (const seed of seeds) {
        if (seed >= 0 && !visited[seed] && passable(seed)) {
            visited[seed] = 1;
            stack.push(seed);
        }
    }

    while (stack.length > 0) {
        const index = stack.pop();
        const x = index % width;
        const y = (index / width) | 0;

        if (x > 0) {
            visit(index - 1);
        }
        if (x < width - 1) {
            visit(index + 1);
        }
        if (y > 0) {
            visit(index - width);
        }
        if (y < height - 1) {
            visit(index + width);
        }
    }

    return visited;

    function visit(neighbor) {
        if (!visited[neighbor] && passable(neighbor)) {
            visited[neighbor] = 1;
            stack.push(neighbor);
        }
    }
}

function borderSeeds(width, height) {
    const seeds = [];

    for (let x = 0; x < width; x += 1) {
        seeds.push(x, (height - 1) * width + x);
    }

    for (let y = 0; y < height; y += 1) {
        seeds.push(y * width, y * width + width - 1);
    }

    return seeds;
}

/**
 * Segments the region into areas of locally-similar colour and returns a mask
 * of the largest such area that touches `innerBox`. Two 4-connected pixels join
 * when their colour difference is below REGION_SIMILARITY, so a flat colour or
 * a smooth gradient becomes one area while sharp glyph edges break it — the
 * glyphs (and their haloes) end up as separate, smaller areas.
 */
function largestSmoothRegion(data, width, height, innerBox) {
    const pixelCount = width * height;
    const visited = new Uint8Array(pixelCount);
    let bestComponent = null;
    let bestSize = 0;

    const touchesBox = (index) => {
        const x = index % width;
        const y = (index / width) | 0;
        return x >= innerBox.x && x < innerBox.x + innerBox.width && y >= innerBox.y && y < innerBox.y + innerBox.height;
    };

    const similar = (a, b) => {
        const ao = a * 4;
        const bo = b * 4;
        return Math.sqrt((data[ao] - data[bo]) ** 2 + (data[ao + 1] - data[bo + 1]) ** 2 + (data[ao + 2] - data[bo + 2]) ** 2) < REGION_SIMILARITY;
    };

    for (let start = 0; start < pixelCount; start += 1) {
        if (visited[start]) {
            continue;
        }

        const component = [];
        const stack = [start];
        visited[start] = 1;
        let inBox = false;

        while (stack.length > 0) {
            const index = stack.pop();
            component.push(index);

            if (!inBox && touchesBox(index)) {
                inBox = true;
            }

            const x = index % width;
            const y = (index / width) | 0;

            for (const neighbor of [
                x > 0 ? index - 1 : -1,
                x < width - 1 ? index + 1 : -1,
                y > 0 ? index - width : -1,
                y < height - 1 ? index + width : -1,
            ]) {
                if (neighbor >= 0 && !visited[neighbor] && similar(index, neighbor)) {
                    visited[neighbor] = 1;
                    stack.push(neighbor);
                }
            }
        }

        if (inBox && component.length > bestSize) {
            bestSize = component.length;
            bestComponent = component;
        }
    }

    if (!bestComponent) {
        return null;
    }

    const interior = new Uint8Array(pixelCount);

    for (const index of bestComponent) {
        interior[index] = 1;
    }

    return interior;
}

/** Median colour of the pixels flagged in `mask`. */
function medianColorOfMask(data, mask, pixelCount) {
    const channels = [[], [], []];

    for (let index = 0; index < pixelCount; index += 1) {
        if (mask[index]) {
            const offset = index * 4;
            channels[0].push(data[offset]);
            channels[1].push(data[offset + 1]);
            channels[2].push(data[offset + 2]);
        }
    }

    if (channels[0].length === 0) {
        return [255, 255, 255];
    }

    return channels.map((values) => {
        values.sort((a, b) => a - b);
        return values[values.length >> 1];
    });
}

/** Binary dilation by `passes` pixels — widens the mask to swallow glyph halos. */
function dilateMask(mask, width, height, passes) {
    for (let pass = 0; pass < passes; pass += 1) {
        const source = mask.slice();

        for (let index = 0; index < mask.length; index += 1) {
            if (source[index]) {
                continue;
            }

            const x = index % width;
            const y = (index / width) | 0;

            if (
                (x > 0 && source[index - 1]) ||
                (x < width - 1 && source[index + 1]) ||
                (y > 0 && source[index - width]) ||
                (y < height - 1 && source[index + width])
            ) {
                mask[index] = 1;
            }
        }
    }
}

/**
 * Fills the masked (glyph) pixels by growing the known bubble interior inward
 * ring by ring, then smoothing so the reconstruction blends without seams.
 * Anchoring only on the interior keeps the bubble outline and the artwork
 * beyond it from bleeding dark colour into the fill.
 */
function reconstruct(data, fillMask, knownMask, width, height, background) {
    const pixelCount = width * height;
    const red = new Float32Array(pixelCount);
    const green = new Float32Array(pixelCount);
    const blue = new Float32Array(pixelCount);

    for (let index = 0; index < pixelCount; index += 1) {
        const offset = index * 4;
        red[index] = data[offset];
        green[index] = data[offset + 1];
        blue[index] = data[offset + 2];
    }

    const filled = knownMask.slice();
    let guard = width + height + 16;
    let progressed = true;

    while (progressed && guard > 0) {
        guard -= 1;
        progressed = false;
        const pending = [];

        for (let index = 0; index < pixelCount; index += 1) {
            if (filled[index] || !fillMask[index]) {
                continue;
            }

            const x = index % width;
            const y = (index / width) | 0;
            let sumRed = 0;
            let sumGreen = 0;
            let sumBlue = 0;
            let count = 0;

            if (x > 0 && filled[index - 1]) {
                sumRed += red[index - 1];
                sumGreen += green[index - 1];
                sumBlue += blue[index - 1];
                count += 1;
            }
            if (x < width - 1 && filled[index + 1]) {
                sumRed += red[index + 1];
                sumGreen += green[index + 1];
                sumBlue += blue[index + 1];
                count += 1;
            }
            if (y > 0 && filled[index - width]) {
                sumRed += red[index - width];
                sumGreen += green[index - width];
                sumBlue += blue[index - width];
                count += 1;
            }
            if (y < height - 1 && filled[index + width]) {
                sumRed += red[index + width];
                sumGreen += green[index + width];
                sumBlue += blue[index + width];
                count += 1;
            }

            if (count > 0) {
                pending.push(index, sumRed / count, sumGreen / count, sumBlue / count);
            }
        }

        for (let cursor = 0; cursor < pending.length; cursor += 4) {
            const index = pending[cursor];
            red[index] = pending[cursor + 1];
            green[index] = pending[cursor + 2];
            blue[index] = pending[cursor + 3];
            filled[index] = 1;
            progressed = true;
        }
    }

    for (let index = 0; index < pixelCount; index += 1) {
        if (fillMask[index] && !filled[index]) {
            red[index] = background[0];
            green[index] = background[1];
            blue[index] = background[2];
        }
    }

    for (let pass = 0; pass < 28; pass += 1) {
        for (let index = 0; index < pixelCount; index += 1) {
            if (!fillMask[index]) {
                continue;
            }

            const x = index % width;
            const y = (index / width) | 0;
            let sumRed = 0;
            let sumGreen = 0;
            let sumBlue = 0;
            let count = 0;

            if (x > 0 && anchored(index - 1)) {
                sumRed += red[index - 1];
                sumGreen += green[index - 1];
                sumBlue += blue[index - 1];
                count += 1;
            }
            if (x < width - 1 && anchored(index + 1)) {
                sumRed += red[index + 1];
                sumGreen += green[index + 1];
                sumBlue += blue[index + 1];
                count += 1;
            }
            if (y > 0 && anchored(index - width)) {
                sumRed += red[index - width];
                sumGreen += green[index - width];
                sumBlue += blue[index - width];
                count += 1;
            }
            if (y < height - 1 && anchored(index + width)) {
                sumRed += red[index + width];
                sumGreen += green[index + width];
                sumBlue += blue[index + width];
                count += 1;
            }

            if (count > 0) {
                red[index] = sumRed / count;
                green[index] = sumGreen / count;
                blue[index] = sumBlue / count;
            }
        }
    }

    for (let index = 0; index < pixelCount; index += 1) {
        if (fillMask[index]) {
            const offset = index * 4;
            data[offset] = red[index];
            data[offset + 1] = green[index];
            data[offset + 2] = blue[index];
        }
    }

    // Smoothing blends only with the interior or already-filled glyph pixels,
    // never with the frozen outline/artwork, so dark edges cannot bleed in.
    function anchored(index) {
        return knownMask[index] === 1 || fillMask[index] === 1;
    }
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
