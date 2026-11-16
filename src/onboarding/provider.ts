import { select } from "@inquirer/prompts";
import { setEnvVar } from "../config.js";
import { activeProviderId, detectProviders, NO_PROVIDER_MESSAGE, normalizeProviderId, providerInfo, searchProviderId, type ProviderId } from "../providers/index.js";

/** Lista as IAs detectadas nesta máquina. */
export function printProviders() {
  let active: ProviderId | null = null;
  try {
    active = activeProviderId();
  } catch (e) {
    console.log(`⚠ ${(e as Error).message}`);
  }
  console.log("IAs detectadas nesta máquina:");
  for (const d of detectProviders()) {
    const mark = d.info.id === active ? "👉" : d.ready ? "✅" : "  ";
    console.log(`${mark} ${d.info.label.padEnd(62)} ${d.detail}`);
  }
  if (active) {
    const forced = Boolean(process.env.AJF_PROVIDER);
    console.log(`\nEm uso: ${providerInfo(active).label}${forced ? " (AJF_PROVIDER)" : " (detectado automaticamente)"}`);
    if (process.env.AJF_MODEL) console.log(`Modelo: ${process.env.AJF_MODEL}${process.env.AJF_TRIAGE_MODEL ? ` · triagem: ${process.env.AJF_TRIAGE_MODEL}` : ""}`);
    const search = searchProviderId();
    if (search && search !== active) console.log(`Busca na web: ${providerInfo(search).label} (AJF_SEARCH_PROVIDER)`);
    else if (process.env.AJF_SEARCH_PROVIDER && !search)
      console.log(`⚠ AJF_SEARCH_PROVIDER=${process.env.AJF_SEARCH_PROVIDER} não está pronta ou não faz busca na web: a busca usa a IA principal.`);
  } else console.log(`\n${NO_PROVIDER_MESSAGE}`);
}

/** Pergunta qual IA usar (entre as disponíveis) e grava AJF_PROVIDER no .env. */
export async function chooseProvider(): Promise<ProviderId | null> {
  const det = detectProviders();
  const usable = det.filter((d) => d.ready || /AJF_PROVIDER=/.test(d.detail));
  if (!usable.length) {
    console.log(NO_PROVIDER_MESSAGE);
    return null;
  }
  let current: ProviderId | null = null;
  try {
    current = activeProviderId();
  } catch {
    /* AJF_PROVIDER inválido: a pessoa escolhe de novo */
  }
  if (usable.length === 1 && current === usable[0].info.id) {
    console.log(`🤖 IA: ${usable[0].info.label} (${usable[0].detail})`);
    return current;
  }
  const pick = await select<ProviderId>({
    message: "Qual IA o agente deve usar?",
    default: current ?? undefined,
    choices: usable.map((d) => ({
      name: `${d.info.label} — ${d.info.kind === "assinatura" ? "usa sua assinatura, sem custo extra" : "paga por uso"}${d.info.webSearch ? "" : " · sem busca web"}`,
      value: d.info.id,
      description: d.detail,
    })),
  });
  setEnvVar("AJF_PROVIDER", pick);
  console.log(`✅ Salvo no .env: AJF_PROVIDER=${pick}`);
  return pick;
}

/**
 * Escolhe a IA da busca na web (AJF_SEARCH_PROVIDER): outra IA só para buscar vagas e pesquisar empresas
 * na web. `id` vazio ou "principal" volta a usar a IA principal. Sem `id`, pergunta.
 */
export async function chooseSearchProvider(id?: string): Promise<void> {
  const options = detectProviders().filter((d) => d.ready && d.info.webSearch);
  let pick = id;
  if (pick === undefined) {
    pick = await select<string>({
      message: "Qual IA usar para a busca na web (achar vagas e pesquisar empresas)?",
      default: process.env.AJF_SEARCH_PROVIDER || "",
      choices: [{ name: "A mesma IA principal", value: "" }, ...options.map((d) => ({ name: d.info.label, value: d.info.id, description: d.detail }))],
    });
  }
  if (!pick || pick === "principal") {
    setEnvVar("AJF_SEARCH_PROVIDER", "");
    return console.log("✅ A busca na web usa a IA principal.");
  }
  const norm = normalizeProviderId(pick);
  if (!norm || !options.some((d) => d.info.id === norm))
    throw new Error(`A IA "${pick}" não está pronta nesta máquina ou não faz busca na web. Opções: ${options.map((d) => d.info.id).join(", ") || "nenhuma"}.`);
  setEnvVar("AJF_SEARCH_PROVIDER", norm);
  console.log(`✅ Salvo no .env: AJF_SEARCH_PROVIDER=${norm} (busca na web com ${providerInfo(norm).label})`);
}
