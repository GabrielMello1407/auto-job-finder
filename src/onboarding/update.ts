import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ensureDir, paths } from "../config.js";
import { structured } from "../llm.js";
import { loadBaseResume, loadRules, withoutDashesResume, withoutTranslatedTitles, type NeverClaimRule, type Rules } from "../profile.js";
import { renderBaseResumes } from "../render/base.js";
import type { Resume } from "../schemas.js";
import { lineDiff, type DiffLine } from "../util/diff.js";
import { today } from "../util/text.js";
import { buildBaseResume, SYSTEM, sourcesBlock } from "./build.js";
import { backupProfile } from "./backup.js";
import type { SourceDoc } from "./sources.js";

/**
 * Atualizar o perfil sem montar tudo de novo: a pessoa conta uma novidade (texto, currículo novo,
 * PDF do LinkedIn, link), a IA propõe o profile_truth.md atualizado, a pessoa vê o antes e o depois
 * e aprova. Ao aplicar, os currículos-base são refeitos a partir do perfil.
 *
 * A proposta fica em profile/atualizacao/proposta.json: sobrevive a fechar o `ajf`, e é recusada
 * se o perfil for editado depois dela.
 *
 * As regras de "nunca afirmar" (rules.json) acompanham: a novidade pode tornar uma regra falsa
 * (ex.: barrava "ISO 27001" e agora a pessoa trabalhou com a norma) ou pedir uma nova. A IA só aponta
 * o que tirar e o que acrescentar; as outras regras, inclusive as escritas à mão, ficam como estão.
 */

export const ProfileUpdateSchema = z.object({
  profileTruth: z.string().describe("O profile_truth.md COMPLETO já com as novidades, com os mesmos títulos de seção do atual"),
  changes: z.array(z.string()).describe("O que mudou no perfil, uma frase curta por mudança, em português"),
  toConfirm: z.array(z.string()).describe("O que ficou em dúvida e foi registrado em 'A confirmar'; vazio se nada"),
  removeRules: z
    .array(z.string())
    .describe("Regras de <regras_nunca_afirmar> que a novidade tornou falsas, copiadas exatamente (o valor de phrase ou de regex). Vazio se nenhuma"),
  addRules: z
    .array(z.object({ phrase: z.string().describe("Frase curta e literal"), message: z.string().describe("Por que não pode afirmar isso") }))
    .describe("Regras novas que a novidade pede (ex.: curso que não é certificação, ferramenta usada só em estudo). Vazio se nenhuma"),
});

export interface RuleChanges {
  /** phrase ou regex das regras que saem. */
  remove: string[];
  add: NeverClaimRule[];
}

const ruleKey = (r: NeverClaimRule) => (r.phrase ?? r.regex ?? "").trim().toLowerCase();

/** Aplica as mudanças nas regras: tira só as apontadas, acrescenta as que ainda não existem e mantém o resto. */
export function applyRuleChanges(rules: Rules, changes: RuleChanges): Rules {
  const remove = new Set(changes.remove.map((k) => k.trim().toLowerCase()));
  const kept = rules.neverClaim.filter((r) => !remove.has(ruleKey(r)));
  const have = new Set(kept.map(ruleKey));
  const added = changes.add.filter((r) => r.phrase?.trim() && r.message.trim() && !have.has(ruleKey(r)));
  return { ...rules, neverClaim: [...kept, ...added] };
}

export interface ProfileUpdateProposal {
  createdAt: string;
  sources: string[];
  changes: string[];
  toConfirm: string[];
  truth: string;
  /** Hash do profile_truth.md quando a proposta foi feita. */
  baseHash: string;
  /** Mudanças nas regras de "nunca afirmar" (rules.json). */
  rules?: RuleChanges;
}

const normalize = (t: string) => t.replace(/\r\n/g, "\n").trim() + "\n";
export const truthHash = (t: string) => crypto.createHash("sha256").update(normalize(t)).digest("hex").slice(0, 16);
const proposalFile = () => path.join(paths.profileDir, "atualizacao", "proposta.json");
const readTruth = () => fs.readFileSync(paths.profileTruth, "utf8");

/** Títulos de seção (## ...) que a proposta não pode tirar. */
export function missingHeadings(before: string, after: string): string[] {
  const heads = (t: string) => (t.match(/^## .+$/gm) ?? []).map((h) => h.trim());
  const now = new Set(heads(after));
  return heads(before).filter((h) => !now.has(h));
}

export async function proposeProfileUpdate(news: SourceDoc[]): Promise<ProfileUpdateProposal> {
  if (!news.length) throw new Error("Conte a novidade: escreva, mande um arquivo ou um link.");
  const current = readTruth();
  const rules = loadRules();
  const r = await structured(ProfileUpdateSchema, {
    label: "profile:update",
    effort: "high",
    maxTokens: 48000,
    system: [SYSTEM],
    user: `<profile_truth_atual>
${current}
</profile_truth_atual>

<regras_nunca_afirmar>
${JSON.stringify(rules.neverClaim, null, 2)}
</regras_nunca_afirmar>

<novidades>
${sourcesBlock(news)}
</novidades>

Hoje é ${today()}. A pessoa contou novidades sobre a carreira. Devolva o profile_truth atualizado incorporando SÓ o que está nas novidades:
- Mantenha exatamente os mesmos títulos de seção (## ...), na mesma ordem. Não remova seções.
- Mantenha palavra por palavra o que já existe, a não ser que a novidade mude aquilo (ex.: data de saída de um emprego, cargo novo na mesma empresa). Não reescreva nem "melhore" o resto.
- Experiência nova: uma subseção "### <Cargo> — <Empresa> (<MM/AAAA> – <MM/AAAA ou Atual>)" na ordem cronológica reversa, com local/modalidade e bullets de fatos. Se a pessoa saiu do emprego atual, troque "Atual" pela data de saída.
- Projeto, curso, certificação, competência ou resultado novo: na seção certa. Curso livre não vira certificação. Competência nova só com evidência na novidade.
- Números, datas, nomes e links exatamente como aparecem nas novidades. Se faltar algo importante (ex.: data de início), registre em "A confirmar" em vez de supor.
- Se a novidade contradiz o perfil, use a novidade (é mais recente) e registre a divergência em "A confirmar".
- Se a novidade resolve um item de "A confirmar", marque-o como resolvido ("- [x]"). Se ela cobre uma lacuna com evidência, atualize "Lacunas conhecidas".
- Se o perfil tiver uma seção de adendos/histórico de alterações, registre ali a data de hoje e o que mudou.
As seções "Lacunas", "A confirmar", "Nunca afirmar" e "Regras de comunicação" não são evidência: não coloque fatos novos nelas.

Regras de "nunca afirmar" (<regras_nunca_afirmar>), usadas pelas travas para barrar o currículo:
- removeRules: só as regras que a novidade torna falsas, porque agora há evidência (ex.: a regra "ISO 27001" quando a pessoa conta que trabalhou com a norma). Copie o phrase ou o regex exatamente. Na dúvida, não remova.
- addRules: o que a novidade pede para nunca afirmar (ex.: curso que não é certificação, ferramenta usada só em laboratório, projeto que não foi concluído). Frases curtas e literais.`,
  });

  const missing = missingHeadings(current, r.profileTruth);
  if (missing.length) throw new Error(`A proposta tirou seções do perfil (${missing.join(", ")}). Tente de novo.`);
  // Só remove regra que existe; só acrescenta regra que ainda não existe.
  const existing = new Set(rules.neverClaim.map(ruleKey));
  const ruleChanges: RuleChanges = {
    remove: [...new Set(r.removeRules.map((k) => k.trim()))].filter((k) => existing.has(k.toLowerCase())),
    add: r.addRules.filter((x) => x.phrase.trim() && !existing.has(x.phrase.trim().toLowerCase())),
  };
  const proposal: ProfileUpdateProposal = {
    createdAt: new Date().toISOString(),
    sources: news.map((s) => s.label),
    changes: [
      ...r.changes,
      ...ruleChanges.remove.map((k) => `Nunca afirmar: a regra "${k}" sai, porque a novidade traz evidência.`),
      ...ruleChanges.add.map((x) => `Nunca afirmar: regra nova "${x.phrase}" (${x.message}).`),
    ],
    toConfirm: r.toConfirm,
    truth: normalize(r.profileTruth),
    baseHash: truthHash(current),
    rules: ruleChanges,
  };
  ensureDir(path.dirname(proposalFile()));
  fs.writeFileSync(proposalFile(), JSON.stringify(proposal, null, 2));
  return proposal;
}

export function loadProposal(): ProfileUpdateProposal | null {
  try {
    return JSON.parse(fs.readFileSync(proposalFile(), "utf8"));
  } catch {
    return null;
  }
}

export function discardProposal() {
  fs.rmSync(proposalFile(), { force: true });
}

/** O perfil foi editado depois da proposta? (aí ela não pode mais ser aplicada) */
export const proposalOutdated = (p: ProfileUpdateProposal) => truthHash(readTruth()) !== p.baseHash;

export function proposalDiff(p: ProfileUpdateProposal): DiffLine[] {
  return lineDiff(normalize(readTruth()), p.truth);
}

/** Salva o perfil proposto (com backup) e refaz os currículos-base a partir dele. */
export async function applyProposal(): Promise<{ backup: string | null }> {
  const p = loadProposal();
  if (!p) throw new Error("Não há proposta de atualização para aplicar.");
  if (proposalOutdated(p)) throw new Error("O perfil foi editado depois da proposta. Descarte e gere de novo.");
  const backup = backupProfile();
  fs.writeFileSync(paths.profileTruth, p.truth);
  if (p.rules && (p.rules.remove.length || p.rules.add.length))
    fs.writeFileSync(paths.rules, JSON.stringify(applyRuleChanges(loadRules(), p.rules), null, 2) + "\n");
  console.log(`✅ Perfil atualizado${backup ? ` (o anterior está em ${backup})` : ""}.`);
  discardProposal();
  await rebuildBaseResumes({ backup: false });
  return { backup };
}

/**
 * Refaz os currículos-base (PT e EN) a partir do profile_truth.md atual, mantendo a redação do que não
 * mudou, e gera os PDFs de conferência. Use depois de editar o perfil à mão.
 */
export async function rebuildBaseResumes(opts: { backup?: boolean } = {}): Promise<void> {
  const truth = readTruth();
  let previous: Resume | undefined;
  try {
    previous = loadBaseResume("pt-BR");
  } catch {
    /* sem currículo-base anterior: monta do zero */
  }
  console.log("Refazendo o currículo-base em português...");
  const ptDraft = await buildBaseResume(truth, "pt-BR", undefined, previous);
  console.log("Refazendo o currículo-base em inglês...");
  const en = await buildBaseResume(truth, "en", ptDraft);
  // Cargo em inglês só no currículo em inglês; nos dois, sem travessão como pontuação.
  const pt = withoutDashesResume(withoutTranslatedTitles(ptDraft, en));
  if (opts.backup !== false) {
    const backup = backupProfile();
    if (backup) console.log(`Os currículos-base anteriores estão em ${backup}.`);
  }
  fs.writeFileSync(paths.baseResume("pt-BR"), JSON.stringify(pt, null, 2) + "\n");
  fs.writeFileSync(paths.baseResume("en"), JSON.stringify(withoutDashesResume(en), null, 2) + "\n");
  console.log("✅ Currículos-base atualizados.");
  try {
    await renderBaseResumes((m) => console.log(`   ${m}`));
  } catch (e) {
    console.log(`⚠ Não gerei os PDFs de conferência: ${(e as Error).message}`);
  }
}

/** Quando o perfil mudou pela última vez (texto ou currículos-base). Pacotes mais antigos ficam desatualizados. */
export function profileChangedAt(): number {
  return Math.max(
    ...[paths.profileTruth, paths.baseResume("pt-BR"), paths.baseResume("en")].map((f) => {
      try {
        return fs.statSync(f).mtimeMs;
      } catch {
        return 0;
      }
    }),
  );
}
