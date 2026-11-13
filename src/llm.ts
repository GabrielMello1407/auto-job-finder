import type { z } from "zod";
import { getProvider, providerInfo, type CallOptions, type SearchOptions } from "./providers/index.js";

/**
 * Ponto único de acesso à IA. Toda chamada passa por aqui e vai para o provedor ativo
 * (Claude Code, Codex, Gemini CLI, API Anthropic, Bedrock, Vertex, OpenAI ou Gemini API).
 */

export type { CallOptions, SearchOptions };

/** Desiste da chamada depois de `ms` (o provedor de CLI também encerra o processo; ver CallOptions.timeoutMs). */
export function withTimeout<T>(p: Promise<T>, ms: number | undefined, what = "A IA"): Promise<T> {
  if (!ms) return p;
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} não respondeu em ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

/** Chamada com saída estruturada validada por Zod. */
export function structured<S extends z.ZodType>(schema: S, opts: CallOptions): Promise<z.infer<S>> {
  return withTimeout(getProvider().structured(schema, opts), opts.timeoutMs);
}

/** Chamada de texto livre (Markdown). */
export function text(opts: CallOptions): Promise<string> {
  return getProvider().text(opts);
}

/** O provedor ativo consegue buscar na web? */
export function canWebSearch(): boolean {
  try {
    return Boolean(getProvider().webSearchStructured);
  } catch {
    return false;
  }
}

/**
 * Chamada com busca na web e JSON estruturado ao final. Usada para achar vagas em sites sem API
 * pública (LinkedIn, Gupy, Indeed, Glassdoor, sites de carreira).
 */
export function webSearchStructured<S extends z.ZodType>(schema: S, opts: SearchOptions): Promise<z.infer<S>> {
  const p = getProvider();
  if (!p.webSearchStructured)
    throw new Error(`O provedor ${providerInfo(p.id).label} não faz busca na web. As fontes por API continuam funcionando.`);
  return p.webSearchStructured(schema, opts);
}
