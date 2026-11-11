/*
 * Textos da interface que precisam de tradução. O texto em português é a chave do dicionário
 * (src/ui/public/locales/<idioma>.json). Acha as chaves no código:
 *   - página (src/ui/public/js/*.js): t("..."), e as duas formas de plural(n, "um", "vários");
 *   - index.html: elementos com data-i18n, data-i18n-html e data-i18n-label;
 *   - servidor (src/ui/**\/*.ts): t("..."), c.t("..."), tr(idioma, "...") e new HttpError(status, "...");
 *   - textos que o servidor manda prontos para a página traduzir (nomes dos status, canais, fontes de vagas).
 *
 *   npx tsx scripts/i18n.ts        lista o que falta ou sobra em cada dicionário
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SOURCES } from "../src/jobs/sources/index.js";
import { APPLY_CHANNELS, STATUS_LABELS } from "../src/jobs/status.js";
import { LINKEDIN_EXPORT_HELP } from "../src/onboarding/sources.js";
import { PROVIDERS } from "../src/providers/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI = path.join(ROOT, "src", "ui");
export const LOCALES_DIR = path.join(UI, "public", "locales");

/**
 * Situações das IAs (detectProviders em src/providers/index.ts) que a rota /api/providers traduz.
 * O teste confere que cada uma ainda existe lá, para a lista não ficar velha.
 */
export const PROVIDER_DETAILS = [
  "CLI 'claude' não encontrada",
  "CLI 'codex' não encontrada",
  "CLI 'gemini' não encontrada",
  "instalado, mas sem login — rode 'codex login'",
  "instalado, mas sem login — rode 'gemini'",
  "chave definida",
  "sem ANTHROPIC_API_KEY",
  "credenciais Bedrock definidas",
  "credenciais AWS encontradas — use AJF_PROVIDER=bedrock para ativar",
  "sem credenciais AWS",
  "projeto Vertex definido",
  "sem ANTHROPIC_VERTEX_PROJECT_ID",
  "sem OPENAI_API_KEY",
  "sem GEMINI_API_KEY",
];

/** Começos fixos dos nomes de fonte do cadastro ("Currículo/documento: arquivo.pdf"), traduzidos na página. */
const SOURCE_LABELS = ["Texto colado", "Novidade contada", "Entrevista guiada", "LinkedIn (PDF exportado)", "Portfólio", "Currículo/documento", "GitHub", "Site/portfólio"];

const STRING = String.raw`"((?:[^"\\]|\\.)*)"`;
const unquote = (s: string) => JSON.parse(`"${s}"`) as string;

function walk(dir: string, ext: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "locales" ? [] : walk(p, ext);
    return ext.test(e.name) ? [p] : [];
  });
}

/** Chaves usadas em um trecho de código (página ou servidor). */
export function keysInCode(code: string): string[] {
  // Linhas de comentário ficam de fora (os exemplos de uso não são textos da tela).
  const src = code
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\/?\*)/.test(l))
    .join("\n");
  const out: string[] = [];
  const add = (re: RegExp, groups = [1]) => {
    for (const m of src.matchAll(re)) for (const g of groups) out.push(unquote(m[g]));
  };
  add(new RegExp(String.raw`\bt\(\s*${STRING}`, "g"));
  add(new RegExp(String.raw`\btr\([^,()]+(?:\([^()]*\))?,\s*${STRING}`, "g"));
  add(new RegExp(String.raw`\bHttpError\(\s*\d+\s*,\s*${STRING}`, "g"));
  add(new RegExp(String.raw`\bplural\([^,]+,\s*${STRING}\s*,\s*${STRING}\s*\)`, "g"), [1, 2]);
  return out;
}

/** Chaves do index.html (data-i18n, data-i18n-html, data-i18n-label). */
export function keysInHtml(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<(\w+)[^>]*\sdata-i18n(?:-html)?(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) out.push(m[2].trim());
  for (const m of html.matchAll(/\sdata-i18n-label="([^"]*)"/g)) out.push(m[1]);
  return out;
}

/** Todas as chaves da interface. */
export function uiKeys(): Set<string> {
  const keys = new Set<string>();
  for (const f of walk(path.join(UI, "public", "js"), /\.js$/)) keysInCode(fs.readFileSync(f, "utf8")).forEach((k) => keys.add(k));
  for (const f of walk(UI, /\.ts$/)) keysInCode(fs.readFileSync(f, "utf8")).forEach((k) => keys.add(k));
  keysInHtml(fs.readFileSync(path.join(UI, "public", "index.html"), "utf8")).forEach((k) => keys.add(k));
  for (const k of [
    ...Object.values(STATUS_LABELS),
    ...Object.values(APPLY_CHANNELS),
    ...Object.values(SOURCES).map((s) => s.description),
    ...PROVIDERS.flatMap((p) => [p.label, p.setup]),
    ...PROVIDER_DETAILS,
    LINKEDIN_EXPORT_HELP,
    ...SOURCE_LABELS,
  ])
    keys.add(k);
  return keys;
}

export const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

export function loadLocale(lang: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), "utf8"));
}

export const locales = () =>
  fs
    .readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const keys = uiKeys();
  for (const lang of locales()) {
    const dict = loadLocale(lang);
    const missing = [...keys].filter((k) => !(k in dict));
    const unused = Object.keys(dict).filter((k) => !keys.has(k));
    console.log(`${lang}: ${keys.size} chaves, ${missing.length} faltando, ${unused.length} sobrando`);
    if (missing.length) console.log(JSON.stringify(Object.fromEntries(missing.map((k) => [k, ""])), null, 2));
    if (unused.length) console.log(`Sobrando:\n${unused.map((k) => `  ${k}`).join("\n")}`);
  }
}
