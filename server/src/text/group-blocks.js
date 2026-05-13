export function groupTextBlocks(ocrItems) {
    const usableItems = ocrItems.map(normalizeOcrItem).filter((item) => item.text && item.coords);

    const groups = [];

    for (const item of usableItems.sort(readingSort)) {
        const existingGroup = groups.find((group) => shouldJoinGroup(group, item));

        if (existingGroup) {
            existingGroup.items.push(item);
            existingGroup.coords = mergeRects([existingGroup.coords, item.coords]);
            continue;
        }

        groups.push({
            items: [item],
            coords: item.coords,
        });
    }

    return groups
        .map((group, index) => toTextBlock(group, index))
        .sort(readingSort)
        .map((block, index) => ({
            ...block,
            order: index + 1,
        }));
}

function normalizeOcrItem(item, index) {
    return {
        id: item.id || `ocr-${index + 1}`,
        text: String(item.text || "").trim(),
        confidence: typeof item.confidence === "number" ? item.confidence : null,
        coords: normalizeRect(item.coords),
    };
}

function normalizeRect(rect) {
    if (!rect) {
        return null;
    }

    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.width);
    const height = Number(rect.height);

    if (![x, y, width, height].every(Number.isFinite)) {
        return null;
    }

    return {
        x,
        y,
        width: Math.max(1, width),
        height: Math.max(1, height),
    };
}

function shouldJoinGroup(group, item) {
    const rect = group.coords;
    const gapX = horizontalGap(rect, item.coords);
    const gapY = verticalGap(rect, item.coords);
    const xOverlap = overlapRatio(rect.x, rect.x + rect.width, item.coords.x, item.coords.x + item.coords.width);
    const yOverlap = overlapRatio(rect.y, rect.y + rect.height, item.coords.y, item.coords.y + item.coords.height);
    // Only bridge gaps the size of normal line-leading / word-spacing. A wider
    // gap means a separate element (e.g. a date stamp above a speech bubble),
    // which must stay its own block rather than being merged into the dialogue.
    const maxGap = Math.max(17, Math.min(rect.height, item.coords.height) * 0.7);

    return (xOverlap > 0.35 && gapY <= maxGap) || (yOverlap > 0.35 && gapX <= maxGap);
}

function horizontalGap(a, b) {
    if (a.x <= b.x + b.width && b.x <= a.x + a.width) {
        return 0;
    }

    return Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
}

function verticalGap(a, b) {
    if (a.y <= b.y + b.height && b.y <= a.y + a.height) {
        return 0;
    }

    return Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
}

function overlapRatio(aStart, aEnd, bStart, bEnd) {
    const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
    const shortest = Math.min(aEnd - aStart, bEnd - bStart);
    return shortest > 0 ? overlap / shortest : 0;
}

function toTextBlock(group, index) {
    const direction = group.coords.height > group.coords.width * 1.25 ? "vertical" : "horizontal";
    const sortedItems = [...group.items].sort(direction === "vertical" ? topToBottomSort : readingSort);
    const sourceText = sortedItems.map((item) => item.text).join(direction === "vertical" ? "" : "\n");
    const confidenceValues = group.items.map((item) => item.confidence).filter((value) => value !== null);

    return {
        id: `block-${index + 1}`,
        sourceText,
        coords: roundRect(group.coords),
        type: classifyText(sourceText, group.coords),
        direction,
        confidence: confidenceValues.length ? confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length : null,
        sourceBlockIds: group.items.map((item) => item.id),
    };
}

function classifyText(text, coords) {
    const compact = text.replace(/\s+/g, "");

    if (compact.length <= 4 && Math.max(coords.width, coords.height) > Math.min(coords.width, coords.height) * 2.5) {
        return "sfx";
    }

    if (/^[!?！？…ー~〜]+$/.test(compact)) {
        return "sfx";
    }

    return "dialogue";
}

function readingSort(a, b) {
    const aRect = a.coords;
    const bRect = b.coords;
    const sameColumn = Math.abs(centerX(aRect) - centerX(bRect)) < Math.max(aRect.width, bRect.width) * 0.85;
    const sameBand = Math.abs(centerY(aRect) - centerY(bRect)) < Math.max(aRect.height, bRect.height) * 0.6;

    if (sameColumn) {
        return aRect.y - bRect.y;
    }

    if (sameBand) {
        return bRect.x - aRect.x;
    }

    return aRect.y - bRect.y;
}

function topToBottomSort(a, b) {
    return a.coords.y - b.coords.y;
}

function centerX(rect) {
    return rect.x + rect.width / 2;
}

function centerY(rect) {
    return rect.y + rect.height / 2;
}

function mergeRects(rects) {
    const minX = Math.min(...rects.map((rect) => rect.x));
    const minY = Math.min(...rects.map((rect) => rect.y));
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}

function roundRect(rect) {
    return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
    };
}
