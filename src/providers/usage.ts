import fs from "node:fs";
import { ensureDir, paths } from "../config.js";

export interface UsageEntry {
  label: string;
  provider: string;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Custo estimado em US$ (só para APIs pagas por token). */
  estUsd?: number;
  /** Valor equivalente em API informado pela CLI (assinatura: conta no limite de uso, não é cobrado). */
  apiEquivalentUsd?: number;
}

/** Registra cada chamada em data/usage.jsonl. Opcional: nunca derruba a execução. */
export function logUsage(entry: UsageEntry) {
  try {
    ensureDir(paths.dataDir);
    fs.appendFileSync(paths.usageLog, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    /* log é opcional */
  }
}
