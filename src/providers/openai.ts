import type { z } from "zod";
import { postJson, postSse } from "./http.js";
import { openaiChatContent, openaiResponsesInput } from "./images.js";
import { strictJsonSchema, structuredViaText, validate } from "./jsonText.js";
import type { CallOptions, Effort, LlmProvider, SearchOptions } from "./types.js";
import { logUsage } from "./usage.js";

/**
 * Provedor "openai":
 * - API oficial (OPENAI_API_KEY): Responses API com saída estruturada e web search.
 * - Endpoint compatível (OPENAI_BASE_URL, ex.: OpenRouter, Groq, DeepSeek, Ollama, LM Studio):
 *   Chat Completions, JSON pedido no prompt e validado. Sem web search.
 */

const OFFICIAL = "https://api.openai.com/v1";
const baseUrl = () => (process.env.OPENAI_BASE_URL || OFFICIAL).replace(/\/+$/, "");
const isOfficial = () => baseUrl() === OFFICIAL;
const auth = (): Record<string, string> => (process.env.OPENAI_API_KEY ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {});

const EFFORT: Record<Effort, string> = { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" };
const isReasoningModel = (m: string) => /^(gpt-5|o\d)/i.test(m);

interface ResponsesCall {
  opts: CallOptions;
  model: string;
  format?: object;
  search?: boolean;
}

async function responses({ opts, model, format, search }: ResponsesCall): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    instructions: opts.system.join("\n\n"),
    input: openaiResponsesInput(opts.user, opts.images),
    max_output_tokens: opts.maxTokens ?? 32000,
    stream: true,
  };
  if (isReasoningModel(model)) body.reasoning = { effort: EFFORT[opts.effort ?? "high"] };
  if (format) body.text = { format: { type: "json_schema", name: "output", schema: format, strict: true } };
  if (search) body.tools = [{ type: "web_search" }];

  let final: any;
  let failure = "";
  await postSse(`${baseUrl()}/responses`, auth(), body, (ev) => {
    if (ev.type === "response.completed" || ev.type === "response.incomplete") final = ev.response;
    if (ev.type === "response.failed") failure = ev.response?.error?.message ?? "falhou";
    if (ev.type === "error") failure = ev.message ?? ev.error?.message ?? "erro";
  });
  if (!final) throw new Error(`[${opts.label}] OpenAI: ${failure || "sem resposta"}`);
  const u = final.usage ?? {};
  logUsage({ label: opts.label, provider: "openai", model, input: u.input_tokens, cacheRead: u.input_tokens_details?.cached_tokens, output: u.output_tokens });
  if (final.status === "incomplete") throw new Error(`[${opts.label}] resposta incompleta (${final.incomplete_details?.reason ?? "?"}). Aumente maxTokens.`);
  const parts: string[] = [];
  for (const item of final.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "refusal") throw new Error(`[${opts.label}] o modelo recusou a tarefa: ${c.refusal}`);
      if (c.type === "output_text") parts.push(c.text);
    }
  }
  return parts.join("\n").trim();
}

async function chat(opts: CallOptions, model: string, extra = ""): Promise<string> {
  const r = await postJson(`${baseUrl()}/chat/completions`, auth(), {
    model,
    messages: [
      { role: "system", content: opts.system.join("\n\n") },
      { role: "user", content: openaiChatContent(extra ? `${opts.user}\n\n${extra}` : opts.user, opts.images) },
    ],
    max_tokens: opts.maxTokens ?? 16000,
  });
  const u = r.usage ?? {};
  logUsage({ label: opts.label, provider: "openai-compat", model, input: u.prompt_tokens, output: u.completion_tokens });
  return String(r.choices?.[0]?.message?.content ?? "").trim();
}

export function openaiProvider(modelFor: (o: CallOptions) => string | undefined): LlmProvider {
  const model = (o: CallOptions) => {
    const m = modelFor(o);
    if (!m) throw new Error("Defina o modelo em AJF_MODEL (ex.: AJF_MODEL=gpt-5) para usar o provedor openai.");
    return m;
  };
  const provider: LlmProvider = {
    id: "openai",
    async structured<S extends z.ZodType>(schema: S, opts: CallOptions) {
      if (!isOfficial()) return structuredViaText(schema, opts.label, (fmt) => chat(opts, model(opts), fmt));
      const out = await responses({ opts, model: model(opts), format: strictJsonSchema(schema) });
      return validate(schema, JSON.parse(out), opts.label);
    },
    text: (opts) => (isOfficial() ? responses({ opts: { ...opts, effort: opts.effort ?? "medium" }, model: model(opts) }) : chat(opts, model(opts))),
  };
  if (isOfficial()) {
    provider.webSearchStructured = async <S extends z.ZodType>(schema: S, opts: SearchOptions) => {
      const out = await responses({ opts: { ...opts, effort: opts.effort ?? "medium" }, model: model(opts), format: strictJsonSchema(schema), search: true });
      return validate(schema, JSON.parse(out), opts.label);
    };
  }
  return provider;
}
