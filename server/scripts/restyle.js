/**
 * Dev-only: re-runs the style / inpaint / text-render stages against a cached
 * translation result so the rendering pipeline can be iterated without
 * re-running OCR or the AI translation. Writes the finished images to
 * test/out/ so they can be inspected directly.
 *
 *   bun server/scripts/restyle.js [translationPath] [fixturePath]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createCanvas, loadImage } from "ppu-ocv/canvas";
import { analyzeBlockStyles } from "../src/text/analyze-style.js";
import { encodeImage, inpaintTextRegions } from "../src/text/inpaint.js";
import { renderTranslatedText } from "../src/text/render-text.js";

const translationPath = process.argv[2] || "test/translation-all.json";
const fixturePath = process.argv[3] || "test/fixture-all.json";

const result = JSON.parse(await readFile(translationPath, "utf8"));
await mkdir("test/out", { recursive: true });

for (const image of result) {
    const basename = new URL(image.imageUrl).pathname.split("/").pop();
    const buffer = await readFile(`test-images/${basename}`);
    const decoded = await loadImage(buffer);
    const canvas = createCanvas(decoded.width, decoded.height);
    canvas.getContext("2d").drawImage(decoded, 0, 0);

    image.localImage = `test-images/${basename}`;
    image.blocks = analyzeBlockStyles(image.blocks, canvas);
    inpaintTextRegions(canvas, image.blocks);
    renderTranslatedText(canvas, image.blocks);
    image.renderedImage = encodeImage(canvas);

    const outPath = `test/out/rendered-${basename}`;
    await writeFile(outPath, canvas.toBuffer("image/jpeg", 92));
    console.log(`# ${basename} (${decoded.width}x${decoded.height}) — ${image.blocks.length} blocks -> ${outPath}`);
}

await writeFile(fixturePath, JSON.stringify(result, null, 2));
console.log(`\nRendered ${result.length} image(s); fixture written to ${fixturePath}`);
