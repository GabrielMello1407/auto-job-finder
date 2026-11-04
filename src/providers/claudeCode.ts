import fs from "node:fs";
import type { z } from "zod";
import { toJsonSchema, validate } from "./jsonText.js";
import { isolatedDir, runCli, tempFile } from "./spawn.js";
import type { CallOptions, LlmProvider, SearchOptions } from "./types.js";
import { logUsage } from "./usage.js";

/**
 * Provedor "claude-code": roda o Claude Code em modo headless (`claude -p`) com o login da assinatura
 * (Pro/Max). Não precisa de chave de API; o uso conta no limite da assinatura.
 *
 * Isolamento: pasta temporária vazia, system prompt próprio, sem ferramentas (exceto busca web quando
 * pedido), sem hooks/plugins/MCP/skills e sem salvar sessão.
 */

interface ClaudeCodeResult {
  result: string;
  structured_output?: unknown;
  is_error: boolean;
  subtype: string;
  total_cost_usd?: number;
  usage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
}

const bin = () => process.env.AJF_CLAUDE_BIN || "claude";
const INSTALL = "Instale o Claude Code (https://claude.com/claude-code) e faça login rodando 'claude', ou defina AJF_CLAUDE_BIN.";

async function run(opts: CallOptions, model: string | undefined, jsonSchema?: object, tools: string[] = []): Promise<ClaudeCodeResult> {
  const dir = isolatedDir("claude-code");
  const sysFile = tempFile(dir, "system", ".txt", opts.system.join("\n\n"));
  const args = [
    "-p",
    "--output-format", "json",
    "--system-prompt-file", sysFile,
    "--effort", opts.effort ?? "high",
    "--tools", tools.join(","),
    "--no-session-persistence",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
  ];
  if (model) args.push("--model", model);
  if (tools.length) args.push("--allowedTools", ...tools);
  if (jsonSchema) args.push("--json-schema", JSON.stringify(jsonSchema));
  try {
    const { stdout, stderr, code } = await runCli({ bin: bin(), args, stdin: opts.user, cwd: dir, name: "claude -p", installHint: INSTALL });
    if (!stdout.trim()) throw new Error(`claude -p saiu com código ${code}: ${stderr.trim().slice(0, 800)}`);
    let parsed: ClaudeCodeResult;
    try {
      parsed = JSON.parse(stdout.trim().split("\n").filter(Boolean).pop()!);
    } catch {
      throw new Error(`Resposta inesperada do claude -p: ${stdout.slice(0, 500)}`);
    }
    if (parsed.is_error || parsed.subtype !== "success")
      throw new Error(`claude -p falhou (${parsed.subtype}): ${String(parsed.result ?? "").slice(0, 800)}`);
    const u = parsed.usage;
    logUsage({
      label: opts.label,
      provider: "claude-code",
      model,
      input: u?.input_tokens,
      output: u?.output_tokens,
      cacheRead: u?.cache_read_input_tokens,
      cacheWrite: u?.cache_creation_input_tokens,
      apiEquivalentUsd: parsed.total_cost_usd,
    });
    return parsed;
  } finally {
    fs.rmSync(sysFile, { force: true });
  }
}

async function structuredWith<S extends z.ZodType>(schema: S, opts: CallOptions, model: string | undefined, tools?: string[]) {
  const r = await run(opts, model, toJsonSchema(schema), tools);
  let data = r.structured_output;
  if (data == null) {
    try {
      data = JSON.parse(r.result);
    } catch {
      throw new Error(`[${opts.label}] o Claude Code não devolveu JSON estruturado.`);
    }
  }
  return validate(schema, data, opts.label);
}

export function claudeCodeProvider(modelFor: (o: CallOptions) => string | undefined): LlmProvider {
  return {
    id: "claude-code",
    structured: (schema, opts) => structuredWith(schema, opts, modelFor(opts)),
    async text(opts) {
      const r = await run({ ...opts, effort: opts.effort ?? "medium" }, modelFor(opts));
      return r.result.trim();
    },
    webSearchStructured: (schema, opts: SearchOptions) =>
      structuredWith(schema, { ...opts, effort: opts.effort ?? "medium" }, modelFor(opts), ["WebSearch", "WebFetch"]),
  };
}

export async function claudeCodeVersion(): Promise<string | null> {
  try {
    const { stdout, code } = await runCli({ bin: bin(), args: ["--version"], cwd: isolatedDir("claude-code"), name: "claude", installHint: INSTALL, timeoutMs: 20_000 });
    return code === 0 ? stdout.trim() : null;
  } catch {
    return null;
  }
}
