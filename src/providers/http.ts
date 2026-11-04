/** Utilitários HTTP para os provedores sem SDK (OpenAI e Gemini). */

const TIMEOUT_MS = 20 * 60_000;

export async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text);
  return JSON.parse(text);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    body: string,
  ) {
    let msg = body.slice(0, 600);
    try {
      const j = JSON.parse(body);
      msg = j.error?.message ?? j.message ?? msg;
    } catch {
      /* corpo não-JSON */
    }
    super(`HTTP ${status}: ${msg}`);
  }
}

/**
 * POST com resposta em streaming (Server-Sent Events). Streaming evita o limite de 5 min do Node
 * para receber os cabeçalhos quando o modelo pensa por muito tempo.
 */
export async function postSse(url: string, headers: Record<string, string>, body: unknown, onEvent: (data: any, event?: string) => void) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw new HttpError(res.status, await res.text());
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (chunk: string) => {
    let event: string | undefined;
    const data: string[] = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    const payload = data.join("\n");
    if (!payload || payload === "[DONE]") return;
    try {
      onEvent(JSON.parse(payload), event);
    } catch (e) {
      if (e instanceof SyntaxError) return;
      throw e;
    }
  };
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(part, { stream: true });
    let idx: number;
    while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
      flush(chunk);
    }
  }
  if (buffer.trim()) flush(buffer);
}
