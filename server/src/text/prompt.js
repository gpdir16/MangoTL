const LANGUAGE_NAMES = {
    ja: "Japanese",
    ko: "Korean",
    en: "English",
    zh: "Chinese",
    "zh-CN": "Simplified Chinese",
    "zh-TW": "Traditional Chinese",
    es: "Spanish",
    fr: "French",
    de: "German",
};

function languageName(code) {
    return LANGUAGE_NAMES[code] || code || "the source language";
}

export function buildTranslationMessages({ sourceLanguage, targetLanguage, blocks }) {
    const source = languageName(sourceLanguage);
    const target = languageName(targetLanguage);

    return [
        {
            role: "system",
            content: [
                `You are a professional manga, manhwa, and webtoon localizer translating from ${source} into ${target}.`,
                "",
                "Translation quality:",
                `- Produce natural, fluent, idiomatic ${target} that reads as if the work were originally created in ${target}.`,
                "- Localize; do not translate word-for-word. A literal rendering that sounds stiff or awkward is wrong, even when it is technically accurate.",
                `- Dialogue must sound like real spoken ${target}, carrying the register, emotion, and character voice the scene implies.`,
                "- Preserve tone, character voice, nuance, politeness/honorific level, and punctuation intent.",
                "",
                "Input notes:",
                "- You receive only OCR text and coordinates, never the image itself.",
                "- The OCR text may contain recognition errors, wrong or missing characters, or stray fragments. Infer the intended original line and translate that intent.",
                "- Newlines inside a block's sourceText are OCR line wrapping, not sentence breaks. Treat each block as one continuous passage.",
                "- All blocks belong to the same page and scene. Use them together as context so the translation stays consistent and coherent.",
                "- The reading order is estimated from coordinates and may be wrong. Mentally reorder if the text implies a better flow, but keep every block id unchanged.",
                "",
                "Output:",
                "- Translate every block that carries real meaning: dialogue, sound effects, signs, background text.",
                `- For sound effects, use an equivalent ${target} onomatopoeia rather than a literal description.`,
                '- Set translatedText to an empty string "" for any block that should NOT be shown:',
                "  - the sourceText is clearly garbled OCR — unrecognizable characters, random disconnected fragments, or meaningless repeated symbols;",
                `  - the block needs no translation — it is already ${target}, or it is purely a number, a date code, a username/@handle, or a URL.`,
                "- When genuinely unsure whether a block is meaningful, translate it rather than emptying it.",
                '- Return strict JSON only. The top-level object must be { "translations": [...] }.',
                "- Keep each block id exactly as provided.",
            ].join("\n"),
        },
        {
            role: "user",
            content: JSON.stringify(
                {
                    task: "Translate the OCR blocks of one manga page for an on-image overlay.",
                    sourceLanguage: source,
                    targetLanguage: target,
                    outputSchema: {
                        translations: [
                            {
                                id: "block id from input (unchanged)",
                                translatedText: `natural ${target} translation, or "" to skip the block (garbled OCR / no translation needed)`,
                                type: "dialogue | sfx | background | sign",
                                direction: "horizontal | vertical",
                            },
                        ],
                    },
                    blocks: blocks.map((block) => ({
                        id: block.id,
                        order: block.order,
                        sourceText: block.sourceText,
                        type: block.type,
                        direction: block.direction,
                        coords: block.coords,
                    })),
                },
                null,
                2,
            ),
        },
    ];
}
