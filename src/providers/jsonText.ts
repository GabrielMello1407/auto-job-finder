import { z } from "zod";

type Json = Record<string, unknown>;

/** JSON Schema gerado a partir do schema Zod (sem a chave $schema). */
export function toJsonSchema(schema: z.ZodType): Json {
  const js = z.toJSONSchema(schema) as Json;
  delete js.$schema;
  return js;
}

function walk(node: unknown, fn: (obj: Json) => void) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, fn));
  else if (node && typeof node === "object") {
    fn(node as Json);
    Object.values(node as Json).forEach((v) => walk(v, fn));
  }
}

/** Formato "strict" exigido por OpenAI/Codex: objetos fechados e todas as chaves obrigatórias. */
export function strictJsonSchema(schema: z.ZodType): Json {
  const js = toJsonSchema(schema);
  walk(js, (o) => {
    if (o.type === "object" && o.properties && typeof o.properties === "object") {
      o.additionalProperties = false;
      o.required = Object.keys(o.properties as Json);
    }
  });
  return js;
}

/** A API Gemini aceita um subconjunto de JSON Schema: remove o que costuma dar erro. */
export function geminiJsonSchema(schema: z.ZodType): Json {
  const js = toJsonSchema(schema);
  walk(js, (o) => {
    delete o.additionalProperties;
    delete o.$schema;
  });
  return js;
}

/** Instrução para provedores sem saída estruturada nativa. */
export function schemaInstruction(schema: z.ZodType): string {
  return `FORMATO DA RESPOSTA: responda APENAS com um único objeto JSON válido (sem texto antes ou depois, sem comentários) que siga exatamente este JSON Schema:
${JSON.stringify(toJsonSchema(schema))}`;
}

/** Extrai o objeto JSON de uma resposta em texto (tolera ```json ... ``` e texto em volta). */
export function extractJson(text: string): unknown {
  const t = text.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  for (const candidate of [t, fenced]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      /* tenta o próximo */
    }
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error("a resposta não contém JSON");
}

/** Valida a saída com o Zod e explica o erro de forma curta. */
export function validate<S extends z.ZodType>(schema: S, data: unknown, label: string): z.infer<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error(`[${label}] saída não bateu com o schema: ${parsed.error.message.slice(0, 500)}`);
  return parsed.data as z.infer<S>;
}

/**
 * Saída estruturada para provedores que só devolvem texto: pede JSON, valida e, se vier errado,
 * tenta mais uma vez explicando o erro.
 */
export async function structuredViaText<S extends z.ZodType>(
  schema: S,
  label: string,
  run: (formatInstruction: string) => Promise<string>,
): Promise<z.infer<S>> {
  const instruction = schemaInstruction(schema);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const extra = attempt === 0 ? instruction : `${instruction}\n\nATENÇÃO: a resposta anterior foi inválida (${lastError}). Corrija e responda só com o JSON.`;
    const out = await run(extra);
    try {
      const data = extractJson(out);
      const parsed = schema.safeParse(data);
      if (parsed.success) return parsed.data as z.infer<S>;
      lastError = parsed.error.message.slice(0, 600);
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  throw new Error(`[${label}] o modelo não devolveu JSON válido: ${lastError}`);
}
