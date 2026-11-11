import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyImages, imageNote } from "./images.js";
import { structuredViaText } from "./jsonText.js";
import { isolatedDir, runCli, tempFile } from "./spawn.js";
import type { CallOptions, LlmProvider } from "./types.js";
import { logUsage } from "./usage.js";

/**
 * Provedor "gemini-cli": Gemini CLI em modo headless (`gemini -p ... -o json`) com o login da conta
 * Google (ou GEMINI_API_KEY). A CLI não tem saída estruturada nativa: pedimos JSON e validamos.
 *
 * Isolamento: pasta temporária vazia (sem GEMINI.md) e system prompt próprio via GEMINI_SYSTEM_MD.
 * Ferramentas que pedem confirmação ficam bloqueadas no modo headless.
 */

const bin = () => process.env.AJF_GEMINI_BIN || "gemini";
const INSTALL = "Instale o Gemini CLI (npm i -g @google/gemini-cli) e faça login rodando 'gemini', ou defina AJF_GEMINI_BIN.";

export function geminiCliLoggedIn(): boolean {
  return (
    fs.existsSync(path.join(os.homedir(), ".gemini", "oauth_creds.json")) ||
    Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_CLOUD_PROJECT)
  );
}

async function run(opts: CallOptions, model: string | undefined, extra = ""): Promise<string> {
  const dir = isolatedDir("gemini-cli");
  const sysFile = tempFile(dir, "system", ".md", opts.system.join("\n\n"));
  // Imagem: copiada para a pasta da chamada; a CLI abre com read_file (ferramenta só de leitura).
  const images = copyImages(dir, opts.images);
  // -p é anexado ao fim do texto recebido pelo stdin.
  const args = ["-p", "Responda agora seguindo as instruções acima.", "-o", "json"];
  if (model) args.push("-m", model);
  try {
    const { stdout, stderr, code } = await runCli({
      bin: bin(),
      args,
      stdin: (extra ? `${opts.user}\n\n${extra}` : opts.user) + imageNote(images, "read_file"),
      cwd: dir,
      env: { GEMINI_SYSTEM_MD: sysFile },
      name: "gemini -p",
      installHint: INSTALL,
    });
    const start = stdout.indexOf("{");
    if (start < 0) throw new Error(`gemini -p saiu com código ${code}: ${(stderr || stdout).trim().slice(0, 800)}`);
    let parsed: { response?: string; error?: { message?: string }; stats?: unknown };
    try {
      parsed = JSON.parse(stdout.slice(start));
    } catch {
      throw new Error(`Resposta inesperada do gemini -p: ${stdout.slice(0, 500)}`);
    }
    if (parsed.error || parsed.response == null)
      throw new Error(`gemini -p falhou: ${parsed.error?.message ?? JSON.stringify(parsed.error ?? parsed).slice(0, 800)}`);
    logUsage({ label: opts.label, provider: "gemini-cli", model });
    return parsed.response.trim();
  } finally {
    fs.rmSync(sysFile, { force: true });
    for (const f of images) fs.rmSync(f, { force: true });
  }
}

export function geminiCliProvider(modelFor: (o: CallOptions) => string | undefined): LlmProvider {
  return {
    id: "gemini-cli",
    structured: (schema, opts) => structuredViaText(schema, opts.label, (fmt) => run(opts, modelFor(opts), fmt)),
    text: (opts) => run(opts, modelFor(opts)),
    // A CLI usa a ferramenta google_web_search dela quando a tarefa pede busca.
    webSearchStructured: (schema, opts) =>
      structuredViaText(schema, opts.label, (fmt) =>
        run(opts, modelFor(opts), `Use a ferramenta de busca na web (google_web_search) para encontrar informações atuais e reais.\n\n${fmt}`),
      ),
  };
}
