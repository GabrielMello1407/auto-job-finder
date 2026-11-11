import fs from "node:fs";
import type http from "node:http";
import { fileURLToPath } from "node:url";

/*
 * Idioma das respostas da interface (erros, rótulos, nomes de tarefas). Mesmo dicionário da página
 * (public/locales/<idioma>.json): o texto em português é a chave. A página manda o idioma escolhido
 * no cabeçalho x-ajf-lang de cada chamada.
 */

export type Lang = "pt-BR" | "en";
const LOCALES = fileURLToPath(new URL("./public/locales/", import.meta.url));
const cache = new Map<Lang, Record<string, string>>();

function dictionary(lang: Lang): Record<string, string> {
  if (lang === "pt-BR") return {};
  if (!cache.has(lang)) {
    try {
      cache.set(lang, JSON.parse(fs.readFileSync(`${LOCALES}${lang}.json`, "utf8")));
    } catch {
      cache.set(lang, {});
    }
  }
  return cache.get(lang)!;
}

export function langOf(req: http.IncomingMessage): Lang {
  return String(req.headers["x-ajf-lang"] ?? "") === "en" ? "en" : "pt-BR";
}

/** Preenche {variáveis} no texto. */
export function fill(text: string, vars?: Record<string, unknown>): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Tradução: o texto em português é a chave; sem tradução, volta o próprio texto. */
export function tr(lang: Lang, text: string, vars?: Record<string, unknown>): string {
  return fill(dictionary(lang)[text] ?? text, vars);
}
