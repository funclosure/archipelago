// shiki's core, its oniguruma engine, and the twelve grammars the judge may use (html for a demo's code). Built once per
// process by `vendorBundle("shiki")` and served at /vendor/shiki.js; the engine's wasm is served
// beside it at /vendor/onig.wasm. Add a language here and in `LANGS` in src/web/code-model.js together.
export { createHighlighterCore } from "shiki/core";
export { createOnigurumaEngine } from "shiki/engine/oniguruma";
export { default as swift } from "@shikijs/langs/swift";
export { default as objectiveC } from "@shikijs/langs/objective-c";
export { default as kotlin } from "@shikijs/langs/kotlin";
export { default as typescript } from "@shikijs/langs/typescript";
export { default as tsx } from "@shikijs/langs/tsx";
export { default as javascript } from "@shikijs/langs/javascript";
export { default as json } from "@shikijs/langs/json";
export { default as bash } from "@shikijs/langs/bash";
export { default as python } from "@shikijs/langs/python";
export { default as sql } from "@shikijs/langs/sql";
export { default as yaml } from "@shikijs/langs/yaml";
export { default as html } from "@shikijs/langs/html";
