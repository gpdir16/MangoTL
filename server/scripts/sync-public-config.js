import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { loadServerConfig } from "../src/config/load-server-config.js";
import { buildPublicConfig } from "../src/config/public-config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicConfigPath = path.join(root, "extension/config/public-config.json");

const config = await loadServerConfig();
const publicConfig = buildPublicConfig(config);
const prettierOptions = (await prettier.resolveConfig(publicConfigPath)) || {};
const formatted = await prettier.format(JSON.stringify(publicConfig), {
    ...prettierOptions,
    filepath: publicConfigPath,
});

await writeFile(publicConfigPath, formatted);
console.log(`Synced ${path.relative(root, publicConfigPath)}`);
