import type { FollowedCompany, Preferences } from "../profile.js";
import type { Job } from "../schemas.js";
import { norm } from "../util/text.js";

/**
 * Seguir empresa: as vagas dela sobem na lista e entram na busca na web. Se o link da vaga é de uma página
 * de carreira que o agente já sabe ler (Greenhouse, Lever, Ashby), ela passa a ser monitorada na busca.
 * Tudo isto é puro: quem chama grava as preferências.
 */

type Board = NonNullable<FollowedCompany["board"]>;

/** A página de carreira da empresa, quando o link da vaga é de Greenhouse, Lever ou Ashby. */
export function boardFromUrl(url: string | undefined): Board | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const first = u.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  const id = (s: string | null | undefined) => (s && /^[a-z0-9][a-z0-9._-]{1,80}$/i.test(s) ? s.toLowerCase() : null);
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const board = first === "embed" ? id(u.searchParams.get("for")) : host.startsWith("boards-api") ? id(u.pathname.split("/")[3]) : id(first);
    return board ? { type: "greenhouse", id: board } : null;
  }
  if (/(^|\.)lever\.co$/.test(host) && host.startsWith("jobs.")) return id(first) ? { type: "lever", id: id(first)! } : null;
  if (/(^|\.)ashbyhq\.com$/.test(host) && host.startsWith("jobs.")) return id(first) ? { type: "ashby", id: id(first)! } : null;
  return null;
}

/** Nome da empresa sem sufixos jurídicos ("Acme Inc." e "ACME" são a mesma). */
export function companyKey(name: string): string {
  return norm(name)
    .replace(/[.,]/g, " ")
    .replace(/\b(inc|ltda|ltd|llc|s ?a|sa|gmbh|corp|corporation|co|company|me|eireli|plc|limited|group|grupo)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const sameCompany = (a: string, b: string) => {
  const x = companyKey(a);
  const y = companyKey(b);
  return Boolean(x) && x === y;
};

/** A pessoa segue a empresa desta vaga? */
export const isFollowed = (company: string, followed: FollowedCompany[]) => followed.some((f) => sameCompany(f.name, company));

/**
 * Passa a seguir a empresa da vaga. Se o link é de Greenhouse, Lever ou Ashby e essa página ainda não era
 * monitorada, ela entra na busca (e a fonte é ligada); a página fica anotada para sair junto ao deixar de seguir.
 */
export function follow(prefs: Preferences, job: Pick<Job, "company" | "url" | "applyUrl">): Preferences {
  if (isFollowed(job.company, prefs.followedCompanies)) return prefs;
  const board = boardFromUrl(job.applyUrl) ?? boardFromUrl(job.url);
  const boards = { ...prefs.companyBoards };
  let sources = prefs.defaultSources;
  let added: Board | undefined;
  if (board && !boards[board.type].includes(board.id)) {
    boards[board.type] = [...boards[board.type], board.id];
    added = board;
    if (!sources.includes(board.type)) sources = [...sources, board.type];
  }
  const entry: FollowedCompany = added ? { name: job.company, board: added } : { name: job.company };
  return { ...prefs, companyBoards: boards, defaultSources: sources, followedCompanies: [...prefs.followedCompanies, entry] };
}

/** Deixa de seguir. A página de carreira que entrou ao seguir sai junto; as que a pessoa pôs à mão ficam. */
export function unfollow(prefs: Preferences, company: string): Preferences {
  const gone = prefs.followedCompanies.filter((f) => sameCompany(f.name, company));
  if (!gone.length) return prefs;
  const boards = { ...prefs.companyBoards };
  for (const f of gone) if (f.board) boards[f.board.type] = boards[f.board.type].filter((b) => b !== f.board!.id);
  return { ...prefs, companyBoards: boards, followedCompanies: prefs.followedCompanies.filter((f) => !gone.includes(f)) };
}
