import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { settings } from "../config.js";
import type { CallOptions, LlmProvider, SearchOptions } from "./types.js";
import { logUsage } from "./usage.js";

/**
 * Provedores da família Claude via SDK oficial:
 * - "anthropic": API Anthropic (ANTHROPIC_API_KEY), com fallback server-side e web search dinâmico.
 * - "bedrock":   Claude no Amazon Bedrock (credenciais AWS). Sem web search no Bedrock.
 * - "vertex":    Claude no Google Cloud Vertex AI. Web search básico.
 */
type Platform = "anthropic" | "bedrock" | "vertex";

type StreamClient = { beta: { messages: Pick<Anthropic["beta"]["messages"], "stream"> } };

/** Preço aproximado por 1M tokens (entrada, saída) para estimar custo no log. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-fable-5-1": [10, 50],
};

const clients = new Map<Platform, Promise<StreamClient>>();

function client(platform: Platform): Promise<StreamClient> {
  if (!clients.has(platform)) {
    clients.set(
      platform,
      (async (): Promise<StreamClient> => {
        if (platform === "bedrock") {
          const { AnthropicBedrockMantle } = await import("@anthropic-ai/bedrock-sdk");
          return new AnthropicBedrockMantle({ maxRetries: 3 }) as unknown as StreamClient;
        }
        if (platform === "vertex") {
          const { AnthropicVertex } = await import("@anthropic-ai/vertex-sdk");
          return new AnthropicVertex({ maxRetries: 3 }) as unknown as StreamClient;
        }
        return new Anthropic({ maxRetries: 3 });
      })(),
    );
  }
  return clients.get(platform)!;
}

function buildSystem(blocks: string[]): Anthropic.Beta.BetaTextBlockParam[] {
  return blocks.map((text, i) => ({
    type: "text" as const,
    text,
    // Breakpoint no último bloco estável: regras + perfil ficam em cache (prefixo idêntico entre chamadas).
    ...(i === blocks.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

function fallbackParams(platform: Platform) {
  // `fallbacks` server-side só existe na API Anthropic.
  return platform === "anthropic" && settings.fallbacks
    ? { betas: ["server-side-fallback-2026-07-01" as const], fallbacks: "default" as const }
    : {};
}

function log(platform: Platform, label: string, msg: Anthropic.Beta.BetaMessage) {
  const u = msg.usage;
  const key = msg.model.replace(/^(?:[a-z]+\.)?anthropic\./, "").replace(/@.*$/, "");
  const price = PRICES[key];
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  logUsage({
    label,
    provider: platform,
    model: msg.model,
    input: u.input_tokens,
    cacheWrite: u.cache_creation_input_tokens ?? undefined,
    cacheRead: u.cache_read_input_tokens ?? undefined,
    output: u.output_tokens,
    estUsd: price ? Number(((input * price[0] + u.output_tokens * price[1]) / 1_000_000).toFixed(4)) : undefined,
  });
}

function assertUsable(label: string, msg: Anthropic.Beta.BetaMessage) {
  if (msg.stop_reason === "refusal") {
    const d = msg.stop_details;
    throw new Error(`[${label}] o modelo recusou a tarefa (${d?.category ?? "sem categoria"}): ${d?.explanation ?? ""}`);
  }
  if (msg.stop_reason === "max_tokens") throw new Error(`[${label}] resposta truncada por max_tokens. Aumente maxTokens.`);
}

export function anthropicProvider(platform: Platform, modelFor: (o: CallOptions) => string | undefined): LlmProvider {
  const model = (o: CallOptions) => modelFor(o) ?? (platform === "bedrock" ? "anthropic.claude-opus-5-5" : "claude-opus-5-5");

  const provider: LlmProvider = {
    id: platform,
    async structured<S extends z.ZodType>(schema: S, opts: CallOptions): Promise<z.infer<S>> {
      const c = await client(platform);
      const msg = await c.beta.messages
        .stream({
          model: model(opts),
          max_tokens: opts.maxTokens ?? 32000,
          thinking: { type: "adaptive" },
          output_config: { effort: opts.effort ?? "high", format: betaZodOutputFormat(schema) },
          system: buildSystem(opts.system),
          messages: [{ role: "user", content: opts.user }],
          ...fallbackParams(platform),
        })
        .finalMessage();
      log(platform, opts.label, msg);
      assertUsable(opts.label, msg);
      if (msg.parsed_output == null) throw new Error(`[${opts.label}] saída não bateu com o schema.`);
      return msg.parsed_output as z.infer<S>;
    },

    async text(opts) {
      const c = await client(platform);
      const msg = await c.beta.messages
        .stream({
          model: model(opts),
          max_tokens: opts.maxTokens ?? 32000,
          thinking: { type: "adaptive" },
          output_config: { effort: opts.effort ?? "medium" },
          system: buildSystem(opts.system),
          messages: [{ role: "user", content: opts.user }],
          ...fallbackParams(platform),
        })
        .finalMessage();
      log(platform, opts.label, msg);
      assertUsable(opts.label, msg);
      return msg.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
    },
  };

  if (platform !== "bedrock") {
    provider.webSearchStructured = async <S extends z.ZodType>(schema: S, opts: SearchOptions): Promise<z.infer<S>> => {
      const c = await client(platform);
      const tool =
        platform === "vertex"
          ? { type: "web_search_20250305" as const, name: "web_search" as const, max_uses: opts.maxSearches ?? 8 }
          : {
              type: "web_search_20260209" as const,
              name: "web_search" as const,
              max_uses: opts.maxSearches ?? 8,
              ...(opts.blockedDomains?.length ? { blocked_domains: opts.blockedDomains } : {}),
            };
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.user }];
      for (let turn = 0; turn < 6; turn++) {
        const msg = await c.beta.messages
          .stream({
            model: model(opts),
            max_tokens: opts.maxTokens ?? 32000,
            thinking: { type: "adaptive" },
            output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(schema) },
            system: buildSystem(opts.system),
            tools: [tool],
            messages,
            ...fallbackParams(platform),
          })
          .finalMessage();
        log(platform, opts.label, msg);
        if (msg.stop_reason === "pause_turn") {
          // O servidor pausou o loop de busca: reenvia a conversa e ele retoma sozinho.
          messages.push({ role: "assistant", content: msg.content });
          continue;
        }
        assertUsable(opts.label, msg);
        if (msg.parsed_output == null) throw new Error(`[${opts.label}] saída não bateu com o schema.`);
        return msg.parsed_output as z.infer<S>;
      }
      throw new Error(`[${opts.label}] busca web não terminou após várias continuações.`);
    };
  }
  return provider;
}
