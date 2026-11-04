import type { z } from "zod";
import { HttpError, postSse } from "./http.js";
import { extractJson, geminiJsonSchema, validate } from "./jsonText.js";
import type { CallOptions, LlmProvider, SearchOptions } from "./types.js";
import { logUsage } from "./usage.js";

/**
 * Provedor "gemini": API Gemini (Google AI Studio) com GEMINI_API_KEY (ou GOOGLE_API_KEY).
 * Saída estruturada via responseJsonSchema; busca web via ferramenta google_search.
 */

const BASE = () => (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
const key = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

interface GenCall {
  opts: CallOptions;
  model: string;
  schema?: object;
  search?: boolean;
}

async function generate({ opts, model, schema, search }: GenCall): Promise<string> {
  const generationConfig: Record<string, unknown> = { maxOutputTokens: opts.maxTokens ?? 32000 };
  if (schema) Object.assign(generationConfig, { responseMimeType: "application/json", responseJsonSchema: schema });
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: opts.system.join("\n\n") }] },
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig,
  };
  if (search) body.tools = [{ google_search: {} }];

  const parts: string[] = [];
  let usage: any;
  let finish = "";
  await postSse(`${BASE()}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { "x-goog-api-key": key() }, body, (ev) => {
    const cand = ev.candidates?.[0];
    for (const p of cand?.content?.parts ?? []) if (p.text && !p.thought) parts.push(p.text);
    if (cand?.finishReason) finish = cand.finishReason;
    if (ev.usageMetadata) usage = ev.usageMetadata;
  });
  logUsage({
    label: opts.label,
    provider: "gemini",
    model,
    input: usage?.promptTokenCount,
    cacheRead: usage?.cachedContentTokenCount,
    output: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
  });
  if (finish === "MAX_TOKENS") throw new Error(`[${opts.label}] resposta truncada por limite de tokens.`);
  if (finish && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(finish) && !parts.length)
    throw new Error(`[${opts.label}] Gemini encerrou sem resposta (${finish}).`);
  return parts.join("").trim();
}

export function geminiProvider(modelFor: (o: CallOptions) => string | undefined): LlmProvider {
  const model = (o: CallOptions) => modelFor(o) ?? (o.tier === "fast" ? "gemini-2.5-flash" : "gemini-2.5-pro");
  const structured = async <S extends z.ZodType>(schema: S, opts: CallOptions) => {
    const out = await generate({ opts, model: model(opts), schema: geminiJsonSchema(schema) });
    return validate(schema, extractJson(out), opts.label);
  };
  return {
    id: "gemini",
    structured,
    text: (opts) => generate({ opts, model: model(opts) }),
    async webSearchStructured<S extends z.ZodType>(schema: S, opts: SearchOptions) {
      try {
        const out = await generate({ opts, model: model(opts), schema: geminiJsonSchema(schema), search: true });
        return validate(schema, extractJson(out), opts.label);
      } catch (e) {
        // Modelos que não combinam busca + JSON: busca em texto e depois estrutura.
        if (!(e instanceof HttpError) || e.status !== 400) throw e;
        const found = await generate({ opts, model: model(opts), search: true });
        return structured(schema, {
          ...opts,
          label: `${opts.label}:estruturar`,
          user: `Converta o resultado da pesquisa abaixo para o formato pedido. Use só o que está no texto.\n\n<pesquisa>\n${found}\n</pesquisa>\n\n<tarefa_original>\n${opts.user}\n</tarefa_original>`,
        });
      }
    },
  };
}
