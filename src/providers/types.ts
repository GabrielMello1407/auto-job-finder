import type { z } from "zod";
import type { ImageInput } from "./images.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ProviderId =
  | "claude-code" // assinatura Claude (Pro/Max) via CLI `claude`
  | "codex" // assinatura ChatGPT (Plus/Pro) via CLI `codex`
  | "gemini-cli" // conta Google via CLI `gemini`
  | "anthropic" // API Anthropic (ANTHROPIC_API_KEY)
  | "bedrock" // Claude no Amazon Bedrock (credenciais AWS)
  | "vertex" // Claude no Google Cloud Vertex AI
  | "openai" // API OpenAI ou compatível (OPENAI_API_KEY / OPENAI_BASE_URL)
  | "gemini"; // API Gemini (GEMINI_API_KEY)

export interface CallOptions {
  label: string;
  /** Blocos estáveis (regras + perfil). Vão primeiro e ficam em cache entre chamadas quando o provedor suporta. */
  system: string[];
  user: string;
  /** Modelo explícito. Se vazio, usa o modelo do provedor para o `tier`. */
  model?: string;
  /** "fast" = triagem em lote (modelo mais barato, se configurado). */
  tier?: "main" | "fast";
  effort?: Effort;
  maxTokens?: number;
  /** Imagens junto com o pedido (ex.: print de uma pergunta de formulário). Ver providers/images.ts. */
  images?: ImageInput[];
}

export interface SearchOptions extends CallOptions {
  maxSearches?: number;
  blockedDomains?: string[];
}

export interface LlmProvider {
  id: ProviderId;
  /** Chamada com saída JSON validada pelo schema Zod. */
  structured<S extends z.ZodType>(schema: S, opts: CallOptions): Promise<z.infer<S>>;
  /** Chamada de texto livre (Markdown). */
  text(opts: CallOptions): Promise<string>;
  /** Busca na web + saída estruturada. Ausente = provedor sem busca web. */
  webSearchStructured?<S extends z.ZodType>(schema: S, opts: SearchOptions): Promise<z.infer<S>>;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  kind: "assinatura" | "api";
  /** Modelo padrão (vazio = o padrão da própria CLI/conta). */
  defaultModel: string;
  defaultFastModel: string;
  /** Como instalar/configurar, mostrado no doctor. */
  setup: string;
  webSearch: boolean;
}
