import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

await import("./sync-public-config.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionDir = path.join(root, "extension");
const distDir = path.join(root, "dist");
const archivePath = path.join(distDir, "mangotl-extension.zip");
const rootLicense = path.join(root, "LICENSE");
const extensionLicense = path.join(extensionDir, "LICENSE");

await mkdir(distDir, { recursive: true });
await rm(archivePath, { force: true });
await copyFile(rootLicense, extensionLicense);

try {
    const result = Bun.spawnSync(["zip", "-r", archivePath, ".", "-x", "*.DS_Store", "*.af", "*.zip"], {
        cwd: extensionDir,
        stdout: "pipe",
        stderr: "pipe",
    });

    if (result.exitCode !== 0) {
        const message = new TextDecoder().decode(result.stderr || result.stdout);
        throw new Error(message || `zip exited with code ${result.exitCode}`);
    }
} finally {
    await rm(extensionLicense, { force: true });
}

const archive = await stat(archivePath);
console.log(`Packaged ${path.relative(root, archivePath)} (${archive.size} bytes)`);
