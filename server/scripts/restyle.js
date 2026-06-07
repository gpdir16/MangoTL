/**
 * Dev-only: re-runs the style / inpaint / text-render stages against a cached
 * translation result so the rendering pipeline can be iterated without
 * re-running OCR or the AI translation. Writes the finished images to
 * test/out/ so they can be inspected directly.
 *
 *   bun server/scripts/restyle.js [translationPathOrDir] [fixturePath] [outDir]
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "ppu-ocv/canvas";
import { analyzeBlockStyles } from "../src/text/analyze-style.js";
import { encodeImage, inpaintTextRegions } from "../src/text/inpaint.js";
import { renderTranslatedText } from "../src/text/render-text.js";

const translationPath = process.argv[2] || "test-images/tmp";
const fixturePath = process.argv[3] || "test-images/tmp/restyle-fixture.json";
const outDir = process.argv[4] || path.join(path.dirname(fixturePath), "out");

const fixtures = await loadFixtures(translationPath);
await mkdir(path.dirname(fixturePath), { recursive: true });
await mkdir(outDir, { recursive: true });

for (const fixture of fixtures) {
    const { image, sourcePath } = fixture;
    const imagePath = await resolveImagePath(image, sourcePath);
    const basename = path.basename(imagePath);
    const buffer = await readFile(imagePath);
    const decoded = await loadImage(buffer);
    const canvas = createCanvas(decoded.width, decoded.height);
    canvas.getContext("2d").drawImage(decoded, 0, 0);

    image.localImage = `test-images/${basename}`;
    image.blocks = analyzeBlockStyles(image.blocks, canvas);
    inpaintTextRegions(canvas, image.blocks);
    renderTranslatedText(canvas, image.blocks);
    image.renderedImage = encodeImage(canvas);

    const outPath = path.join(outDir, `rendered-${basename}`);
    await writeFile(outPath, canvas.toBuffer("image/jpeg", 96));
    console.log(`# ${basename} (${decoded.width}x${decoded.height}) — ${image.blocks.length} blocks -> ${outPath}`);
}

await writeFile(
    fixturePath,
    JSON.stringify(
        fixtures.map((fixture) => fixture.image),
        null,
        2,
    ),
);
console.log(`\nRendered ${fixtures.length} image(s); fixture written to ${fixturePath}`);

async function loadFixtures(inputPath) {
    const inputStats = await stat(inputPath);

    if (inputStats.isDirectory()) {
        const entries = await readdir(inputPath);
        const jsonPaths = entries
            .filter((entry) => entry.endsWith(".json"))
            .filter((entry) => !entry.startsWith("restyle-"))
            .sort()
            .map((entry) => path.join(inputPath, entry));

        const loaded = await Promise.all(jsonPaths.map(loadFixtureFile));
        return loaded.flat();
    }

    return loadFixtureFile(inputPath);
}

async function loadFixtureFile(filePath) {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    const images = Array.isArray(parsed) ? parsed : [parsed];
    return images.map((image) => ({ image, sourcePath: filePath }));
}

async function resolveImagePath(image, sourcePath) {
    const candidates = [
        image.localImage,
        sourcePath ? path.join(path.dirname(sourcePath), `${path.basename(sourcePath, ".json")}.jpeg`) : null,
        sourcePath ? path.join(path.dirname(sourcePath), `${path.basename(sourcePath, ".json")}.jpg`) : null,
        image.imageUrl ? path.join("test-images", path.basename(new URL(image.imageUrl).pathname)) : null,
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            const candidateStats = await stat(candidate);

            if (candidateStats.isFile()) {
                return candidate;
            }
        } catch {
            // Try the next possible source image location.
        }
    }

    throw new Error(`Could not find source image for fixture: ${image.imageId || sourcePath}`);
}
