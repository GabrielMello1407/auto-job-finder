/** Comparação linha a linha (LCS) para mostrar o antes e o depois de um texto. */

export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
}

const MAX_CELLS = 4_000_000;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  // Texto grande demais para comparar linha a linha: mostra tudo como trocado.
  if (a.length * b.length > MAX_CELLS) return [...a.map((text) => ({ type: "del" as const, text })), ...b.map((text) => ({ type: "add" as const, text }))];

  // lcs[i][j] = tamanho da maior subsequência comum entre a[i..] e b[j..]
  const lcs: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ type: "del", text: a[i++] });
    else out.push({ type: "add", text: b[j++] });
  }
  while (i < a.length) out.push({ type: "del", text: a[i++] });
  while (j < b.length) out.push({ type: "add", text: b[j++] });
  return out;
}

/** Quantas linhas entraram e saíram. */
export function diffStats(lines: DiffLine[]) {
  return { added: lines.filter((l) => l.type === "add").length, removed: lines.filter((l) => l.type === "del").length };
}
