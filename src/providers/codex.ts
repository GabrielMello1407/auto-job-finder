import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { z } from "zod";
import { copyImages } from "./images.js";
import { extractJson, strictJsonSchema, validate } from "./jsonText.js";
import { isolatedDir, runCli, tempFile } from "./spawn.js";
import type { CallOptions, Effort, LlmProvider } from "./types.js";
import { logUsage } from "./usage.js";

/**
 * Provedor "codex": OpenAI Codex CLI em modo não interativo (`codex exec`) com o login da assinatura
 * ChatGPT (Plus/Pro/Business). Sem chave de API.
 *
 * Isolamento: pasta temporária vazia, sandbox somente leitura, sem salvar sessão. Saída estruturada
 * via --output-schema (JSON Schema "strict").
 */

const bin = () => process.env.AJF_CODEX_BIN || "codex";
const INSTALL = "Instale o Codex CLI (npm i -g @openai/codex) e faça login rodando 'codex login', ou defina AJF_CODEX_BIN.";

const EFFORT: Record<Effort, string> = { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" };

export function codexLoggedIn(): boolean {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return fs.existsSync(path.join(home, "auth.json")) || Boolean(process.env.CODEX_API_KEY);
}

async function run(opts: CallOptions, model: string | undefined, schema?: object, search = false): Promise<string> {
  const dir = isolatedDir("codex");
  const outFile = tempFile(dir, "last", ".txt");
  const schemaFile = schema ? tempFile(dir, "schema", ".json", JSON.stringify(schema)) : undefined;
  const images = copyImages(dir, opts.images);
  const args = [
    "exec",
    // Imagem anexada ao pedido (a forma --image=arquivo não engole o "-" do stdin no fim).
    ...images.map((f) => `--image=${f}`),
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox", "read-only",
    "--color", "never",
    "-c", `model_reasoning_effort="${EFFORT[opts.effort ?? "high"]}"`,
    "-c", `web_search="${search ? "live" : "disabled"}"`,
    "-o", outFile,
  ];
  if (schemaFile) args.push("--output-schema", schemaFile);
  if (model) args.push("-m", model);
  args.push("-");

  // O Codex não tem flag de system prompt: as regras vão no início da mensagem.
  const prompt = `<instructions>\n${opts.system.join("\n\n")}\n</instructions>\n\n<task>\n${opts.user}\n</task>`;
  try {
    const { stdout, stderr, code } = await runCli({ bin: bin(), args, stdin: prompt, cwd: dir, name: "codex exec", installHint: INSTALL });
    let usage: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number } | undefined;
    let lastMessage = "";
    let failure = "";
    for (const line of stdout.split("\n")) {
      if (!line.trim().startsWith("{")) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === "turn.completed") usage = ev.usage;
        if (ev.type === "item.completed" && ev.item?.type === "agent_message") lastMessage = ev.item.text ?? lastMessage;
        if (ev.type === "turn.failed" || ev.type === "error") failure = ev.error?.message ?? ev.message ?? JSON.stringify(ev).slice(0, 300);
      } catch {
        /* linha não-JSON */
      }
    }
    const final = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").trim() || lastMessage : lastMessage;
    if (!final) throw new Error(`codex exec falhou (código ${code}): ${(failure || stderr).trim().slice(0, 800)}`);
    logUsage({
      label: opts.label,
      provider: "codex",
      model,
      input: usage?.input_tokens,
      cacheRead: usage?.cached_input_tokens,
      output: usage?.output_tokens,
    });
    return final;
  } finally {
    fs.rmSync(outFile, { force: true });
    if (schemaFile) fs.rmSync(schemaFile, { force: true });
    for (const f of images) fs.rmSync(f, { force: true });
  }
}

async function structuredWith<S extends z.ZodType>(schema: S, opts: CallOptions, model: string | undefined, search: boolean) {
  const out = await run(opts, model, strictJsonSchema(schema), search);
  let data: unknown;
  try {
    data = extractJson(out);
  } catch {
    throw new Error(`[${opts.label}] o Codex não devolveu JSON: ${out.slice(0, 300)}`);
  }
  return validate(schema, data, opts.label);
}

export function codexProvider(modelFor: (o: CallOptions) => string | undefined): LlmProvider {
  return {
    id: "codex",
    structured: (schema, opts) => structuredWith(schema, opts, modelFor(opts), false),
    text: (opts) => run({ ...opts, effort: opts.effort ?? "medium" }, modelFor(opts)),
    webSearchStructured: (schema, opts) => structuredWith(schema, { ...opts, effort: opts.effort ?? "medium" }, modelFor(opts), true),
  };
}
