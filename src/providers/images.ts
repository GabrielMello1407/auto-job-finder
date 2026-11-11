import fs from "node:fs";
import path from "node:path";

/**
 * Imagens que vão junto com o pedido para a IA (ex.: o print de uma pergunta de formulário).
 * Cada provedor manda do seu jeito:
 * - APIs (Anthropic, Bedrock, Vertex, OpenAI, Gemini): a imagem vai no corpo do pedido, em base64;
 * - Codex CLI: `codex exec --image`;
 * - Claude Code e Gemini CLI: a imagem é copiada para a pasta isolada da chamada e a IA a abre com a
 *   ferramenta de ler arquivos (só essa ferramenta fica liberada).
 */

export type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
export interface ImageInput {
  path: string;
  mime: ImageMime;
}

export const IMAGE_EXT: Record<ImageMime, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
/** Limite das APIs para uma imagem (a da Anthropic é 5 MB). */
export const IMAGE_MAX_BYTES = 5_000_000;

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

/** Tipo da imagem pelos primeiros bytes (não confia na extensão nem no que o navegador diz). */
export function imageMime(buf: Uint8Array): ImageMime | null {
  if (buf.length >= 8 && buf[0] === 0x89 && ascii(buf, 1, 4) === "PNG") return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(ascii(buf, 0, 6))) return "image/gif";
  return null;
}

const base64 = (img: ImageInput) => fs.readFileSync(img.path).toString("base64");
const dataUrl = (img: ImageInput) => `data:${img.mime};base64,${base64(img)}`;

/** Copia as imagens para a pasta da chamada (CLIs). Devolve os caminhos, para apagar no fim. */
export function copyImages(dir: string, images: ImageInput[] = []): string[] {
  return images.map((img, i) => {
    const file = path.join(dir, `imagem-${process.pid}-${Date.now()}-${i + 1}${IMAGE_EXT[img.mime]}`);
    fs.copyFileSync(img.path, file);
    return file;
  });
}

/** Pedido para as CLIs que abrem a imagem com a ferramenta de ler arquivos. */
export function imageNote(files: string[], tool: string): string {
  if (!files.length) return "";
  const list = files.map((f) => `./${path.basename(f)}`).join(", ");
  return `\n\n<imagens>\nEste pedido vem com ${files.length === 1 ? "uma imagem" : `${files.length} imagens`}: ${list}. Abra com a ferramenta ${tool} antes de responder; ${files.length === 1 ? "ela faz" : "elas fazem"} parte do pedido.\n</imagens>`;
}

/** Conteúdo da mensagem na API da Anthropic (também Bedrock e Vertex). */
export function anthropicContent(text: string, images: ImageInput[] = []) {
  if (!images.length) return text;
  return [
    ...images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mime, data: base64(img) } })),
    { type: "text" as const, text },
  ];
}

/** `input` da Responses API da OpenAI. */
export function openaiResponsesInput(text: string, images: ImageInput[] = []) {
  if (!images.length) return text;
  return [{ role: "user", content: [...images.map((img) => ({ type: "input_image", image_url: dataUrl(img) })), { type: "input_text", text }] }];
}

/** Conteúdo da mensagem no Chat Completions (endpoints compatíveis com a OpenAI). */
export function openaiChatContent(text: string, images: ImageInput[] = []) {
  if (!images.length) return text;
  return [...images.map((img) => ({ type: "image_url", image_url: { url: dataUrl(img) } })), { type: "text", text }];
}

/** `parts` da API Gemini. */
export function geminiParts(text: string, images: ImageInput[] = []) {
  return [...images.map((img) => ({ inline_data: { mime_type: img.mime, data: base64(img) } })), { text }];
}
