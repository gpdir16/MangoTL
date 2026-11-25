// A handwritten interjection can share pixels with the outline of a small
// white oval. Connected-component erasing cannot separate the two. Recover
// the outline from the exposed arcs above, right of, and below the text box.
export function eraseAttachedOvalLettering(ctx, canvasWidth, canvasHeight, block) {
    const box = block.coords;
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    if (
        width < 95 ||
        width > 210 ||
        height < 90 ||
        height > 210 ||
        !/^[\p{Script=Hiragana}\p{Script=Katakana}っッぁぃぅぇぉァィゥェォ!?！？]{1,4}$/u.test(String(block.originalText || "")) ||
        !block.style?.bubbleBox ||
        !/^#(?:f[0-9a-f]){3}$/iu.test(String(block.style.background || ""))
    ) {
        return false;
    }

    const bx = Math.round(box.x);
    const by = Math.round(box.y);
    const x0 = Math.max(0, Math.floor(bx - width * 0.07));
    const y0 = Math.max(0, Math.floor(by - height * 0.15));
    const x1 = Math.min(canvasWidth, Math.ceil(bx + width * 1.23));
    const y1 = Math.min(canvasHeight, Math.ceil(by + height * 1.57));
    if (x1 - x0 < 10 || y1 - y0 < 10) return false;

    const image = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    const points = [];
    const arcs = { top: 0, right: 0, bottom: 0 };
    for (let y = 0; y < image.height; y += 1) {
        const pageY = y0 + y;
        for (let x = 0; x < image.width; x += 1) {
            const pageX = x0 + x;
            if (pageX < bx + width * 0.13 || pageX > bx + width * 1.23) continue;
            if (pageY < by - height * 0.075 || pageY > by + height * 1.37) continue;
            if (pageX >= bx - width * 0.03 && pageX <= bx + width * 1.02 && pageY >= by && pageY <= by + height * 1.01) continue;
            const offset = (y * image.width + x) * 4;
            if (Math.max(image.data[offset], image.data[offset + 1], image.data[offset + 2]) > 105) continue;
            points.push([pageX, pageY]);
            if (pageY < by) arcs.top += 1;
            if (pageX > bx + width * 1.02) arcs.right += 1;
            if (pageY > by + height * 1.01) arcs.bottom += 1;
        }
    }
    if (points.length < 150 || arcs.top < 15 || arcs.right < 60 || arcs.bottom < 60) return false;

    const fit = fitOval(points, bx + width * 0.72, by + height * 0.7);
    if (!fit) return false;
    const { cx, cy, rx, ry, angle, support } = fit;
    if (
        support < 0.75 ||
        rx < width * 0.3 ||
        rx > width * 0.85 ||
        ry < height * 0.45 ||
        ry > height * 1.2 ||
        cx < bx + width * 0.4 ||
        cx > bx + width * 1.0 ||
        cy < by + height * 0.35 ||
        cy > by + height * 1.0 ||
        Math.abs(angle) > 0.45
    ) {
        return false;
    }

    const padX = Math.max(6, Math.round(width * 0.065));
    const padY = Math.max(3, Math.round(height * 0.045));
    const eraseX = bx;
    const eraseY = by - 2;
    const eraseWidth = Math.min(canvasWidth - eraseX, width + padX);
    const eraseHeight = Math.min(canvasHeight - eraseY, height + padY);
    ctx.save();
    ctx.fillStyle = block.style.background;
    ctx.fillRect(eraseX, eraseY, eraseWidth, eraseHeight);
    ctx.beginPath();
    ctx.rect(eraseX, eraseY, eraseWidth, eraseHeight);
    ctx.clip();
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.022));
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, angle, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return true;
}

// A vertical long-vowel mark may touch the bottom of a tiny balloon, making
// component-based inpainting mistake it for the outline. Remove only a stable,
// narrow stroke in the balloon's center and leave the wider bottom arc.
function eraseLongVowelTail(ctx, canvasWidth, canvasHeight, block) {
    const box = block.coords;
    if (
        !/^[\p{Script=Hiragana}\p{Script=Katakana}]{1,3}ー$/u.test(String(block.originalText || "")) ||
        box.width > 120 ||
        box.height > 110 ||
        (block.eraseCoords?.height || 0) < box.height + 35 ||
        !block.style?.bubbleBox ||
        !/^#(?:f[0-9a-f]){3}$/iu.test(String(block.style.background || ""))
    ) {
        return false;
    }
    const x0 = Math.max(0, Math.round(box.x));
    const y0 = Math.max(0, Math.round(box.y + box.height * 0.65));
    const width = Math.min(canvasWidth - x0, Math.round(box.width));
    const height = Math.min(canvasHeight - y0, Math.round(box.height * 0.85));
    if (width < 20 || height < 20) return false;
    const data = ctx.getImageData(x0, y0, width, height);
    const counts = new Uint16Array(width);
    const runs = [];
    for (let y = 0; y < height; y += 1) {
        const rowRuns = [];
        for (let x = 0; x < width;) {
            const pixel = (y * width + x) * 4;
            if ((data.data[pixel] + data.data[pixel + 1] + data.data[pixel + 2]) / 3 >= 150) {
                x += 1;
                continue;
            }
            const start = x;
            while (x < width) {
                const offset = (y * width + x) * 4;
                if ((data.data[offset] + data.data[offset + 1] + data.data[offset + 2]) / 3 >= 150) break;
                x += 1;
            }
            const previous = rowRuns.at(-1);
            if (previous && start - previous.end <= 4) previous.end = x;
            else rowRuns.push({ y, start, end: x });
        }
        for (const run of rowRuns) {
            if (run.end - run.start > 10 || run.start < width * 0.25 || run.end > width * 0.75) continue;
            runs.push(run);
            for (let column = run.start; column < run.end; column += 1) counts[column] += 1;
        }
    }
    const bestX = counts.indexOf(Math.max(...counts));
    if (counts[bestX] < 20) return false;
    ctx.save();
    ctx.fillStyle = block.style.background;
    for (const run of runs) {
        if (run.start - 5 > bestX || run.end + 5 < bestX) continue;
        ctx.fillRect(x0 + Math.max(0, run.start - 2), y0 + run.y, Math.min(width - run.start + 2, run.end - run.start + 4), 1);
    }
    ctx.restore();
    return true;
}

export function eraseSmallOvalLongVowel(ctx, canvasWidth, canvasHeight, block) {
    if (!eraseLongVowelTail(ctx, canvasWidth, canvasHeight, block)) return false;
    const box = block.coords;
    ctx.save();
    ctx.fillStyle = block.style.background;
    ctx.fillRect(
        Math.round(box.x + box.width * 0.34),
        Math.round(box.y + box.height * 0.18),
        Math.round(box.width * 0.23),
        Math.round(box.height * 0.2),
    );
    ctx.fillRect(
        Math.round(box.x + box.width * 0.15),
        Math.round(box.y + box.height * 0.36),
        Math.round(box.width * 0.62),
        Math.round(box.height * 0.45),
    );
    ctx.fillRect(
        Math.round(box.x + box.width * 0.455),
        Math.round(box.y + box.height * 1.34),
        Math.max(4, Math.round(box.width * 0.07)),
        Math.round(box.height * 0.12),
    );
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(box.x + box.width * 0.41, box.y + box.height * 1.44);
    ctx.quadraticCurveTo(box.x + box.width * 0.48, box.y + box.height * 1.47, box.x + box.width * 0.56, box.y + box.height * 1.41);
    ctx.stroke();
    ctx.restore();
    return true;
}

function fitOval(points, originX, originY) {
    // Fit x² + Bxy + Cy² + Dx + Ey + F = 0 around a nearby origin.
    const matrix = Array.from({ length: 5 }, () => Array(5).fill(0));
    const values = Array(5).fill(0);
    for (const [x, y] of points) {
        const u = x - originX;
        const v = y - originY;
        const row = [u * v, v * v, u, v, 1];
        for (let i = 0; i < 5; i += 1) {
            values[i] -= row[i] * u * u;
            for (let j = 0; j < 5; j += 1) matrix[i][j] += row[i] * row[j];
        }
    }
    const solution = solveLinear(matrix, values);
    if (!solution) return null;
    const [B, C, D, E, F] = solution;
    const denominator = 4 * C - B * B;
    if (denominator <= 0.05) return null;
    const uCenter = (B * E - 2 * C * D) / denominator;
    const vCenter = (B * D - 2 * E) / denominator;
    const angle = 0.5 * Math.atan2(B, 1 - C);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const first = cos * cos + B * cos * sin + C * sin * sin;
    const second = sin * sin - B * cos * sin + C * cos * cos;
    const scale = -(uCenter * uCenter + B * uCenter * vCenter + C * vCenter * vCenter + D * uCenter + E * vCenter + F);
    if (first <= 0 || second <= 0 || scale <= 0) return null;
    const rx = Math.sqrt(scale / first);
    const ry = Math.sqrt(scale / second);
    if (![rx, ry, uCenter, vCenter].every(Number.isFinite)) return null;

    const tolerance = Math.max(5, Math.min(rx, ry) * 0.12);
    let inliers = 0;
    for (const [x, y] of points) {
        const u = x - originX;
        const v = y - originY;
        const error = Math.abs(u * u + B * u * v + C * v * v + D * u + E * v + F);
        const gradient = Math.hypot(2 * u + B * v + D, B * u + 2 * C * v + E);
        if (gradient > 0 && error / gradient < tolerance) inliers += 1;
    }
    return { cx: originX + uCenter, cy: originY + vCenter, rx, ry, angle, support: inliers / points.length };
}

function solveLinear(matrix, values) {
    for (let col = 0; col < values.length; col += 1) {
        let pivot = col;
        for (let row = col + 1; row < values.length; row += 1) {
            if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
        }
        if (Math.abs(matrix[pivot][col]) < 1e-8) return null;
        [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
        [values[col], values[pivot]] = [values[pivot], values[col]];
        const divisor = matrix[col][col];
        for (let i = col; i < values.length; i += 1) matrix[col][i] /= divisor;
        values[col] /= divisor;
        for (let row = 0; row < values.length; row += 1) {
            if (row === col) continue;
            const factor = matrix[row][col];
            for (let i = col; i < values.length; i += 1) matrix[row][i] -= factor * matrix[col][i];
            values[row] -= factor * values[col];
        }
    }
    return values;
}
