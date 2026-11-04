import type { z } from "zod";
import { getProvider, providerInfo, type CallOptions, type SearchOptions } from "./providers/index.js";

/**
 * Ponto único de acesso à IA. Toda chamada passa por aqui e vai para o provedor ativo
 * (Claude Code, Codex, Gemini CLI, API Anthropic, Bedrock, Vertex, OpenAI ou Gemini API).
 */

export type { CallOptions, SearchOptions };

/** Chamada com saída estruturada validada por Zod. */
export function structured<S extends z.ZodType>(schema: S, opts: CallOptions): Promise<z.infer<S>> {
  return getProvider().structured(schema, opts);
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
