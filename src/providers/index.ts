import { anthropicProvider } from "./anthropic.js";
import { claudeCodeProvider } from "./claudeCode.js";
import { codexLoggedIn, codexProvider } from "./codex.js";
import { geminiProvider } from "./gemini.js";
import { geminiCliLoggedIn, geminiCliProvider } from "./geminiCli.js";
import { openaiProvider } from "./openai.js";
import { which } from "./spawn.js";
import type { CallOptions, LlmProvider, ProviderId, ProviderInfo } from "./types.js";

export type { CallOptions, Effort, LlmProvider, ProviderId, SearchOptions } from "./types.js";

/** Ordem = prioridade da detecção automática: assinaturas (sem custo extra) primeiro, depois APIs. */
export const PROVIDERS: ProviderInfo[] = [
  {
    id: "claude-code",
    label: "Claude — assinatura Pro/Max (CLI claude)",
    kind: "assinatura",
    defaultModel: "",
    defaultFastModel: "",
    setup: "Instale o Claude Code (https://claude.com/claude-code) e rode 'claude' uma vez para fazer login.",
    webSearch: true,
  },
  {
    id: "codex",
    label: "ChatGPT — assinatura Plus/Pro (CLI codex)",
    kind: "assinatura",
    defaultModel: "",
    defaultFastModel: "",
    setup: "npm i -g @openai/codex e depois 'codex login'.",
    webSearch: true,
  },
  {
    id: "gemini-cli",
    label: "Gemini — conta Google (CLI gemini)",
    kind: "assinatura",
    defaultModel: "",
    defaultFastModel: "",
    setup: "npm i -g @google/gemini-cli e rode 'gemini' uma vez para fazer login.",
    webSearch: true,
  },
  {
    id: "anthropic",
    label: "API Anthropic (ANTHROPIC_API_KEY)",
    kind: "api",
    defaultModel: "claude-opus-5-5",
    defaultFastModel: "claude-opus-5-5",
    setup: "Crie uma chave em https://platform.claude.com e coloque ANTHROPIC_API_KEY=... no .env.",
    webSearch: true,
  },
  {
    id: "bedrock",
    label: "Claude no Amazon Bedrock (credenciais AWS)",
    kind: "api",
    defaultModel: "anthropic.claude-opus-5-5",
    defaultFastModel: "anthropic.claude-opus-5-5",
    setup: "Configure AWS_REGION e credenciais (AWS_BEARER_TOKEN_BEDROCK, AWS_PROFILE ou chaves) e AJF_PROVIDER=bedrock. Sem busca web.",
    webSearch: false,
  },
  {
    id: "vertex",
    label: "Claude no Google Cloud Vertex AI",
    kind: "api",
    defaultModel: "claude-opus-5-5",
    defaultFastModel: "claude-opus-5-5",
    setup: "Defina ANTHROPIC_VERTEX_PROJECT_ID e CLOUD_ML_REGION e faça login com 'gcloud auth application-default login'.",
    webSearch: true,
  },
  {
    id: "openai",
    label: "API OpenAI ou compatível (OPENAI_API_KEY / OPENAI_BASE_URL)",
    kind: "api",
    defaultModel: "gpt-5",
    defaultFastModel: "gpt-5-mini",
    setup: "Coloque OPENAI_API_KEY=... no .env. Para OpenRouter/Groq/Ollama, defina também OPENAI_BASE_URL e AJF_MODEL.",
    webSearch: true,
  },
  {
    id: "gemini",
    label: "API Gemini (GEMINI_API_KEY)",
    kind: "api",
    defaultModel: "gemini-2.5-pro",
    defaultFastModel: "gemini-2.5-flash",
    setup: "Crie uma chave em https://aistudio.google.com e coloque GEMINI_API_KEY=... no .env.",
    webSearch: true,
  },
];

const ALIASES: Record<string, ProviderId> = { api: "anthropic", claude: "claude-code", chatgpt: "codex", "gemini-api": "gemini" };

export function normalizeProviderId(raw: string | undefined): ProviderId | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  const id = (ALIASES[v] ?? v) as ProviderId;
  return PROVIDERS.some((p) => p.id === id) ? id : undefined;
}

export interface Detection {
  info: ProviderInfo;
  /** Pode ser usado sem configurar mais nada. */
  ready: boolean;
  detail: string;
}

/** Detecta, sem chamar nenhum modelo, quais IAs estão disponíveis nesta máquina. */
export function detectProviders(): Detection[] {
  const env = process.env;
  const has = (...keys: string[]) => keys.some((k) => Boolean(env[k]));
  return PROVIDERS.map((info): Detection => {
    switch (info.id) {
      case "claude-code": {
        const p = which(env.AJF_CLAUDE_BIN || "claude");
        return { info, ready: Boolean(p), detail: p ? `encontrado em ${p}` : "CLI 'claude' não encontrada" };
      }
      case "codex": {
        const p = which(env.AJF_CODEX_BIN || "codex");
        if (!p) return { info, ready: false, detail: "CLI 'codex' não encontrada" };
        const logged = codexLoggedIn();
        return { info, ready: logged, detail: logged ? `encontrado em ${p}` : `instalado, mas sem login — rode 'codex login'` };
      }
      case "gemini-cli": {
        const p = which(env.AJF_GEMINI_BIN || "gemini");
        if (!p) return { info, ready: false, detail: "CLI 'gemini' não encontrada" };
        const logged = geminiCliLoggedIn();
        return { info, ready: logged, detail: logged ? `encontrado em ${p}` : `instalado, mas sem login — rode 'gemini'` };
      }
      case "anthropic":
        return { info, ready: has("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"), detail: has("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN") ? "chave definida" : "sem ANTHROPIC_API_KEY" };
      case "bedrock": {
        const explicit = has("AWS_BEARER_TOKEN_BEDROCK") || env.CLAUDE_CODE_USE_BEDROCK === "1";
        const aws = has("AWS_ACCESS_KEY_ID", "AWS_PROFILE") && has("AWS_REGION", "AWS_DEFAULT_REGION");
        return {
          info,
          ready: explicit,
          detail: explicit ? "credenciais Bedrock definidas" : aws ? "credenciais AWS encontradas — use AJF_PROVIDER=bedrock para ativar" : "sem credenciais AWS",
        };
      }
      case "vertex": {
        const ok = has("ANTHROPIC_VERTEX_PROJECT_ID") || env.CLAUDE_CODE_USE_VERTEX === "1";
        return { info, ready: ok, detail: ok ? "projeto Vertex definido" : "sem ANTHROPIC_VERTEX_PROJECT_ID" };
      }
      case "openai":
        return { info, ready: has("OPENAI_API_KEY", "OPENAI_BASE_URL"), detail: has("OPENAI_API_KEY", "OPENAI_BASE_URL") ? (env.OPENAI_BASE_URL ? `endpoint ${env.OPENAI_BASE_URL}` : "chave definida") : "sem OPENAI_API_KEY" };
      case "gemini":
        return { info, ready: has("GEMINI_API_KEY", "GOOGLE_API_KEY"), detail: has("GEMINI_API_KEY", "GOOGLE_API_KEY") ? "chave definida" : "sem GEMINI_API_KEY" };
    }
  });
}

/** Provedor escolhido: AJF_PROVIDER, ou o primeiro disponível na ordem de prioridade. */
export function activeProviderId(): ProviderId | null {
  const forced = normalizeProviderId(process.env.AJF_PROVIDER);
  if (process.env.AJF_PROVIDER && !forced)
    throw new Error(`AJF_PROVIDER="${process.env.AJF_PROVIDER}" não existe. Opções: ${PROVIDERS.map((p) => p.id).join(", ")}`);
  if (forced) return forced;
  return detectProviders().find((d) => d.ready)?.info.id ?? null;
}

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id)!;
}

/** Modelo para a chamada: explícito > AJF_TRIAGE_MODEL/AJF_MODEL > padrão do provedor (vazio = padrão da CLI). */
export function modelResolver(id: ProviderId) {
  const info = providerInfo(id);
  return (o: CallOptions): string | undefined =>
    o.model ||
    (o.tier === "fast"
      ? process.env.AJF_TRIAGE_MODEL || process.env.AJF_MODEL || info.defaultFastModel
      : process.env.AJF_MODEL || info.defaultModel) ||
    undefined;
}

const cache = new Map<ProviderId, LlmProvider>();

export function createProvider(id: ProviderId): LlmProvider {
  if (!cache.has(id)) {
    const m = modelResolver(id);
    const p =
      id === "claude-code" ? claudeCodeProvider(m)
      : id === "codex" ? codexProvider(m)
      : id === "gemini-cli" ? geminiCliProvider(m)
      : id === "openai" ? openaiProvider(m)
      : id === "gemini" ? geminiProvider(m)
      : anthropicProvider(id, m);
    cache.set(id, p);
  }
  return cache.get(id)!;
}

export const NO_PROVIDER_MESSAGE = `Nenhuma IA encontrada nesta máquina. Escolha uma opção (todas funcionam):
${PROVIDERS.map((p) => `  • ${p.label}: ${p.setup}`).join("\n")}
Depois rode 'ajf ia' para conferir.`;

export function getProvider(): LlmProvider {
  const id = activeProviderId();
  if (!id) throw new Error(NO_PROVIDER_MESSAGE);
  return createProvider(id);
}
