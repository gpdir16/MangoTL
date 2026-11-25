import { parse as parseYaml } from "yaml";
import { HttpError } from "../../utils/http-error.js";

export function parsePaddleDictionary(buffer, format) {
    const text = buffer.toString("utf-8");
    if (!format || format === "text") return text.split("\n");
    if (format !== "paddle-yaml") throw new HttpError(500, "ocr_config_invalid", `Unsupported Paddle dictionary format: ${format}`);
    const characters = parseYaml(text)?.PostProcess?.character_dict;
    if (!Array.isArray(characters) || !characters.length || characters.some((character) => typeof character !== "string" || !character.length)) {
        throw new HttpError(500, "ocr_dictionary_invalid", "Paddle model metadata must contain a non-empty character_dict of strings");
    }
    // Paddle CTC decoder: class zero is blank; use_space_char appends space.
    // Preserve Unicode whitespace entries; trimming changes class indices.
    return ["", ...characters, " "];
}
