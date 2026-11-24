import { HttpError } from "../../utils/http-error.js";

const LANGUAGE_NAMES = {
    ja: { en: "Japanese", zh: "日语" },
    ko: { en: "Korean", zh: "韩语" },
    en: { en: "English", zh: "英语" },
    zh: { en: "Chinese", zh: "中文" },
    de: { en: "German", zh: "德语" },
};

const PROFILE_BUILDERS = {
    "plamo-3-translate": buildPlamoRequest,
    "hy-mt-2": buildHyMt2Request,
};

export function requireLocalModelProfile(profile) {
    const builder = PROFILE_BUILDERS[profile];
    if (!builder) {
        throw new HttpError(500, "local_model_profile_missing", `Local model profile is not registered: ${profile}.`);
    }
    return builder;
}

export function buildPlamoRequest({ model, block, blocks, sourceLanguage, targetLanguage }) {
    const context = blocks
        .filter((candidate) => String(candidate.id) !== String(block.id))
        .map((candidate) => candidate.sourceText)
        .join("\n")
        .slice(0, 4000);
    const templateOptions = {
        source_lang: plamoLanguage(sourceLanguage),
        target_lang: plamoLanguage(targetLanguage),
    };
    if (context) {
        templateOptions.context = context;
    }

    return {
        model,
        messages: [{ role: "user", content: block.sourceText }],
        chat_template_kwargs: templateOptions,
        temperature: 0,
        max_tokens: 1024,
        stop: ["<|plamo:tag|>", "<|plamo:bos|>"],
    };
}

export function buildHyMt2Request({ model, block, sourceLanguage, targetLanguage }) {
    const useChinese = sourceLanguage === "zh" || targetLanguage === "zh";
    const language = LANGUAGE_NAMES[targetLanguage] || { en: targetLanguage, zh: targetLanguage };
    const prompt = useChinese
        ? `将以下文本翻译为 ${language.zh} ，注意 只需要输出翻译后的结果，不要额外解释 ： ${block.sourceText}`
        : `Translate the following text into ${language.en} . Note that you should only output the translated result without any additional explanation : ${block.sourceText}`;

    return {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        top_p: 0.6,
        top_k: 20,
        repeat_penalty: 1.05,
        max_tokens: 1024,
    };
}

function plamoLanguage(language) {
    return language === "zh" ? "zh-hans" : language;
}
