import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalUrl, DuplicateFinder, handledTwins, isPlaceholderCompany, sameCompany, similarTitles } from "../src/jobs/dedupe.js";
import { pageVerdict } from "../src/jobs/open.js";
import { jobPageText, WEB_SUMMARY_HEADER } from "../src/jobs/page.js";
import { gupySearchPage } from "../src/jobs/sources/gupy.js";
import { jobId } from "../src/jobs/sources/index.js";
import type { Job } from "../src/schemas.js";

/* ------------------------------ links ------------------------------ */

test("link canônico: sem rastreio, sem www, sem barra no fim", () => {
  assert.equal(
    canonicalUrl("https://www.Himalayas.app/companies/acme/jobs/dev/?utm_source=api&utm_medium=feed"),
    "https://himalayas.app/companies/acme/jobs/dev",
  );
  assert.equal(canonicalUrl("http://example.com/vaga#candidatar"), "https://example.com/vaga");
  // Rota de página feita em JavaScript faz parte do endereço.
  assert.equal(canonicalUrl("https://empresa.com/carreiras#/vaga/42"), "https://empresa.com/carreiras#/vaga/42");
  // Vaga colada sem link: o endereço inventado fica como está.
  assert.equal(canonicalUrl("manual://texto/abc123"), "manual://texto/abc123");
});

test("link canônico: o mesmo anúncio do LinkedIn, da Gupy e do Indeed escrito de vários jeitos", () => {
  const li = "https://linkedin.com/jobs/view/4479005605";
  assert.equal(canonicalUrl("https://br.linkedin.com/jobs/view/desenvolvedor-full-stack-at-empresa-4479005605?refId=x&trackingId=y"), li);
  assert.equal(canonicalUrl("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4479005605"), li);
  const token = Buffer.from(JSON.stringify({ jobId: 12734277, source: "gupy_portal" })).toString("base64");
  assert.equal(canonicalUrl(`https://stefanini.gupy.io/job/${token}?jobBoardSource=gupy_portal`), "https://stefanini.gupy.io/jobs/12734277");
  assert.equal(canonicalUrl("https://stefanini.gupy.io/jobs/12734277?jobBoardSource=gupy_portal"), "https://stefanini.gupy.io/jobs/12734277");
  assert.equal(canonicalUrl("https://br.indeed.com/jobs?q=dev&vjk=abc123"), "https://br.indeed.com/viewjob?jk=abc123");
});

test("ID da vaga: rastreio não muda, parâmetro que identifica a vaga muda", () => {
  assert.equal(jobId("https://empresa.com/vagas/1?utm_source=x"), jobId("https://empresa.com/vagas/1"));
  // Antes, tudo depois do "?" era cortado e vagas diferentes do Indeed viravam a mesma.
  assert.notEqual(jobId("https://br.indeed.com/viewjob?jk=aaa"), jobId("https://br.indeed.com/viewjob?jk=bbb"));
  assert.notEqual(jobId("https://empresa.com/vaga?id=1"), jobId("https://empresa.com/vaga?id=2"));
});

/* ------------------------------ vaga repetida ------------------------------ */

const WORDS =
  "equipe produto clientes plataforma dados integracao qualidade entrega processo melhoria pessoas negocio sistema servico atendimento projeto analise relatorio resultado impacto cultura beneficio contrato remoto horario ferramenta documentacao suporte operacao estrategia mercado".split(
    " ",
  );
/** Texto determinístico de ~n palavras: a mesma semente dá o mesmo texto; sementes diferentes, textos diferentes. */
function text(seed: number, n = 120): string {
  let x = seed;
  return Array.from({ length: n }, () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return WORDS[x % WORDS.length];
  }).join(" ");
}

let n = 0;
function job(p: Partial<Job> & Pick<Job, "title" | "company">): Job {
  n++;
  return { id: `j${n}`, source: "teste", location: "", remote: true, url: `https://site${n}.example/vaga/${n}`, tags: [], description: text(n), addedAt: "", status: "triaged", ...p };
}

test("títulos e empresas parecidos", () => {
  assert.ok(similarTitles("Senior React Full-stack Developer", "Senior React Full stack Developer"));
  assert.ok(similarTitles("Software Engineer, AI Coding Tasks", "Software Engineer, AI Coding Tasks (Contract)"));
  assert.ok(similarTitles("Desenvolvedor(a) Full Stack Sr", "Desenvolvedor Fullstack Sênior"));
  assert.ok(!similarTitles("Senior React Full-stack Developer", "Senior Angular Full-stack Developer"));
  assert.ok(!similarTitles("Desenvolvedor Full Stack - Pleno", "Desenvolvedor Full Stack - Junior"));
  // Nível diferente é outra vaga, mesmo com o resto igual (a mesma empresa abre para os dois níveis com o mesmo texto).
  assert.ok(!similarTitles("Software Engineer - Python/Golang", "Senior Software Engineer - Python/Golang"));
  assert.ok(!similarTitles("Analista de Suporte II", "Analista de Suporte III"));
  assert.ok(similarTitles("Desenvolvedor Pleno", "Desenvolvedor Full Stack - Pleno"));
  assert.ok(sameCompany("Stefanini Group", "Stefanini"));
  assert.ok(sameCompany("Lemon.io", "lemon io"));
  assert.ok(sameCompany("Fluence International, Inc.", "Fluence"));
  assert.ok(!sameCompany("Globo", "Globant"));
  assert.ok(isPlaceholderCompany("(ver na vaga)"));
  assert.ok(isPlaceholderCompany("Confidencial (seleção conduzida pela Sylision)"));
  assert.ok(isPlaceholderCompany("(empresa a confirmar)"));
  assert.ok(!isPlaceholderCompany("Askable"));
});

test("a mesma vaga em outro site é achada; vagas diferentes da mesma empresa, não", () => {
  const askable = job({ company: "Askable", title: "Software Engineer, AI Coding Tasks", description: text(1001) });
  const lemon = job({ company: "Lemon.io", title: "Senior React Full-stack Developer", description: text(1002) });
  const strider = job({ company: "(ver na vaga)", title: "Full-stack Engineer React.js • UX Design • Node.js (Strider)", description: text(1003) });
  const stefanini = job({ company: "Stefanini Group", title: "DESENVOLVEDOR FULL STACK SR", description: text(1004) });
  const improving = job({ company: "Improving", title: "AI Back-end Engineer", description: text(1005) });
  const noText = job({ company: "Acme", title: "Analista de Dados Pleno", description: "Vaga de analista." });
  const finder = new DuplicateFinder([askable, lemon, strider, stefanini, improving, noText]);
  const found = (p: Parameters<typeof finder.find>[0]) => finder.find(p)?.job.id;

  // Mesmo link, escrito de outro jeito.
  assert.equal(finder.find({ ...askable, url: `${askable.url}?utm_source=feed` })?.how, "link");
  // Mesmo texto (com uma frase a mais), título com sufixo, outro site.
  assert.equal(found({ url: "https://outro.example/1", company: "Askable", title: "Software Engineer, AI Coding Tasks (Contract)", description: `${text(1001)} contrato de seis meses` }), askable.id);
  assert.equal(found({ url: "https://outro.example/2", company: "Lemon io", title: "Senior React Full stack Developer", description: text(1002) }), lemon.id);
  // Empresa desconhecida dos dois lados: o texto decide.
  assert.equal(found({ url: "https://outro.example/3", company: "(ver na vaga)", title: "Full-stack Engineer React.js • UX Design • Node.js(Strider)", description: text(1003) }), strider.id);
  // Mesma empresa e mesmo título, mas outro texto: outra vaga (a Stefanini abre várias iguais para clientes diferentes).
  assert.equal(found({ url: "https://outro.example/4", company: "Stefanini", title: "Desenvolvedor Full Stack Sr", description: text(2004) }), undefined);
  // Título contém o outro, mas o texto é outro.
  assert.equal(found({ url: "https://outro.example/5", company: "Improving", title: "Back-end AI Engineer Python / LLM Orchestration", description: text(2005) }), undefined);
  // Sem texto para comparar: só empresa e título iguais.
  assert.equal(found({ url: "https://outro.example/6", company: "Acme Ltda", title: "Analista de Dados Pl", description: "Curta." }), noText.id);
  assert.equal(found({ url: "https://outro.example/7", company: "(empresa a confirmar)", title: "Analista de Dados Pleno", description: "Curta." }), undefined);
});

test("resumo da busca web: empresa e título iguais bastam (o texto do resumo é da IA, não da vaga)", () => {
  const sent = job({ company: "Programa Leilões", title: "Desenvolvedor(a) Backend / Full Stack (PRESENCIAL LONDRINA/PARANÁ)", status: "applied", description: text(4001, 400) });
  const finder = new DuplicateFinder([sent]);
  const summary = `${WEB_SUMMARY_HEADER}\n${text(5001, 90)}`;
  assert.equal(finder.find({ url: "https://vagas.solides.example/1", company: "Programa Leilões", title: sent.title, description: summary })?.job.id, sent.id);
  // Outro cargo na mesma empresa continua outra vaga.
  assert.equal(finder.find({ url: "https://vagas.solides.example/2", company: "Programa Leilões", title: "Analista de Suporte", description: summary }), null);
});

test("vaga que você já tratou: mesma empresa e mesmo título é repetida mesmo com outro texto", () => {
  const sent = job({ company: "Stefanini Group", title: "DESENVOLVEDOR FULL STACK SR", status: "applied", description: text(6001) });
  const waiting = job({ company: "Acme", title: "Analista de Dados Pleno", status: "triaged", description: text(6002) });
  const finder = new DuplicateFinder([sent, waiting]);
  assert.equal(finder.find({ url: "https://x.example/a", company: "Stefanini", title: "Desenvolvedor Full Stack Sr", description: text(7001) })?.job.id, sent.id);
  // Ainda não tratada: com outro texto, é outra vaga (a mesma empresa abre várias com o mesmo título).
  assert.equal(finder.find({ url: "https://x.example/b", company: "Acme", title: "Analista de Dados Pleno", description: text(7002) }), null);
});

test("vagas salvas que são a mesma de uma enviada; reabrir impede de marcar de novo", () => {
  const sent = job({ company: "Objective", title: "Desenvolvedor(a) Fullstack PL - Node.js / React", status: "applied", addedAt: "2026-11-04" });
  const again = job({ company: "Objective", title: "Desenvolvedor(a) Fullstack PL - Node.js / React", status: "shortlisted", addedAt: "2026-11-07", description: `${WEB_SUMMARY_HEADER}\nresumo` });
  const reopened = job({ ...again, id: "reaberta", url: "https://y.example/1", notDuplicate: true });
  const twins = handledTwins([sent, again, reopened]);
  assert.deepEqual(twins.map((t) => [t.job.id, t.twin.id]), [[again.id, sent.id]]);
  // Duas com pacote: a mais nova é a repetida, não as duas.
  const a = job({ company: "Acme", title: "Analista Pleno", status: "tailored", addedAt: "2026-11-01", description: text(8001) });
  const b = job({ company: "Acme", title: "Analista Pleno", status: "tailored", addedAt: "2026-11-05", description: text(8002) });
  assert.deepEqual(handledTwins([a, b]).map((t) => t.job.id), [b.id]);
});

test("vaga reaberta: a mesma vaga muito tempo depois, ou publicada depois da candidatura, entra como nova", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const opts = { windowDays: 90, now };
  const title = "Desenvolvedor(a) Backend Pleno";
  const old = job({ company: "Acme", title, status: "rejected", addedAt: "2026-05-01T00:00:00Z", appliedAt: "2026-05-02T00:00:00Z", description: text(9001) });
  const recent = job({ company: "Beta", title, status: "applied", addedAt: "2026-10-20T00:00:00Z", appliedAt: "2026-10-21T00:00:00Z", description: text(9002) });
  const finder = new DuplicateFinder([old, recent], opts);
  const summary = `${WEB_SUMMARY_HEADER}\nresumo`;
  // Candidatura de seis meses atrás: a vaga igual de hoje é outra abertura, só ganha o aviso.
  const a = finder.find({ url: "https://x.example/r1", company: "Acme", title, description: summary });
  assert.deepEqual([a?.how, a?.job.id], ["reaberta", old.id]);
  // Candidatura recente: continua repetida.
  assert.equal(finder.find({ url: "https://x.example/r2", company: "Beta", title, description: summary })?.how, "mesma_vaga");
  // Recente, mas publicada um mês depois da candidatura: a empresa abriu de novo.
  assert.equal(finder.find({ url: "https://x.example/r3", company: "Beta", title, description: summary, postedAt: "2026-11-25T00:00:00Z" })?.how, "reaberta");
  // O mesmo link é o mesmo anúncio, não importa quando.
  assert.equal(finder.find({ ...old, url: `${old.url}?utm_source=x` })?.how, "link");
  // Na conferência das vagas salvas, a reaberta só ganha o aviso (não é descartada).
  const saved = job({ company: "Acme", title, status: "shortlisted", addedAt: "2026-11-07T00:00:00Z", description: summary });
  assert.deepEqual(handledTwins([old, saved], opts).map((t) => [t.job.id, t.reopened]), [[saved.id, true]]);
});

test("vaga repetida de uma repetida aponta para a original", () => {
  // a e b foram ligadas antes (b é repetida de a), mas os títulos não se parecem.
  const a = job({ company: "Askable", title: "Engenheiro de Software", description: text(3001) });
  const b = job({ company: "Askable", title: "Software Engineer (Contract)", description: text(3001), duplicateOf: a.id, status: "discarded" });
  const finder = new DuplicateFinder([a, b]);
  assert.ok(!similarTitles("Software Engineer (Contract)", a.title));
  // A nova só se parece com b; mesmo assim a resposta é a original, a.
  assert.equal(finder.find({ url: "https://x.example/1", company: "Askable", title: "Software Engineer (Contract)", description: text(3001) })?.job.id, a.id);
});

/* ------------------------------ vaga encerrada ------------------------------ */

const page = (html: string, extra: Partial<Parameters<typeof pageVerdict>[0]> = {}) =>
  pageVerdict({ status: 200, requestedUrl: "https://empresa.com/vagas/123", finalUrl: "https://empresa.com/vagas/123", html, ...extra }, Date.parse("2026-11-07T12:00:00Z"));
const body = (s: string) => `<html><head><title>Vaga</title></head><body><main>${s}</main></body></html>`;
const LONG = "Buscamos uma pessoa para o time de produto, com experiência em atendimento e organização. ".repeat(6);
const nextDataPage = (job: object) => `<html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { job } } })}</script></body></html>`;

test("vaga encerrada: página que não existe, prazo vencido, aviso na página, link que leva para a lista", () => {
  assert.equal(page("", { status: 404 }).verdict, "encerrada");
  assert.equal(page("", { status: 403 }).verdict, "sem_confirmacao");
  assert.equal(page(body(LONG), { finalUrl: "https://job-boards.greenhouse.io/empresa?error=true" }).verdict, "encerrada");
  assert.equal(page(body(LONG), { finalUrl: "https://empresa.com/" }).verdict, "encerrada");
  assert.equal(page(body(LONG), { finalUrl: "https://empresa.com/candidates/signin" }).verdict, "sem_confirmacao");
  assert.equal(page(body(`<h1>Esta vaga foi encerrada</h1>${LONG}`)).verdict, "encerrada");
  assert.equal(page(body(`<p>This job is no longer accepting applications.</p>${LONG}`)).verdict, "encerrada");
  assert.equal(page(body(`<p>Inscrições encerradas</p>${LONG}`)).reason, "a página diz “inscrições encerradas”");
  const ld = (validThrough: string) =>
    `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Analista", description: LONG, validThrough })}</script></head><body><main>${LONG}</main></body></html>`;
  assert.equal(page(ld("2026-10-01")).verdict, "encerrada");
  assert.equal(page(ld("2026-12-31")).verdict, "aberta");
});

test("vaga aberta: texto de tradução escondido em script não conta como aviso", () => {
  const html = `<html><body><main>${LONG}</main><script>window.i18n={"jobClosed":"Candidaturas encerradas"}</script></body></html>`;
  assert.equal(page(html).verdict, "aberta");
  assert.equal(page("<html><body><div id='app'></div></body></html>").verdict, "sem_confirmacao");
});

test("Gupy: status e prazo da vaga na própria página", () => {
  const base = { name: "Analista", description: `<p>${LONG}</p>`, careerPage: { name: "Empresa X" } };
  assert.equal(page(nextDataPage({ ...base, status: "published", registerEndDate: "2026-12-14" })).verdict, "aberta");
  assert.equal(page(nextDataPage({ ...base, status: "closed", registerEndDate: "2026-12-14" })).verdict, "encerrada");
  assert.equal(page(nextDataPage({ ...base, status: "published", registerEndDate: "2026-11-01" })).verdict, "encerrada");
});

/* ------------------------------ Gupy ------------------------------ */

test("Gupy: vagas da página de busca", () => {
  const data = {
    props: {
      pageProps: {
        initialJobList: {
          pagination: { total: 30, limit: 12, offset: 12 },
          data: [
            { id: 1, name: "Analista de Dados  Pleno", careerPageName: "Empresa X", workplaceType: "remote", city: "São Paulo", state: "São Paulo", type: "vacancy_type_effective", publishedDate: "2026-11-05T10:00:00Z", applicationDeadline: "2026-12-01T00:00:00Z", jobUrl: "https://empresax.gupy.io/job/abc", description: "<p>Atuar com <b>SQL</b>.</p>" },
            { id: 2, name: "Assistente", careerPageName: "Loja Y", workplaceType: "on-site", city: "Londrina", state: "Paraná", type: "vacancy_legal_entity", publishedDate: "2026-11-01T10:00:00Z", jobUrl: "https://lojay.gupy.io/job/def", description: "Vendas." },
            { id: 3, name: "Vencida", careerPageName: "Z", workplaceType: "remote", applicationDeadline: "2026-10-01T00:00:00Z", jobUrl: "https://z.gupy.io/job/ghi", description: "x" },
            { id: 4, name: "Inativa", careerPageName: "W", workplaceType: "remote", jobUrl: "https://w&1&inactive.gupy.io/job/jkl", description: "x" },
          ],
        },
      },
    },
  };
  const r = gupySearchPage(data, Date.parse("2026-11-07T12:00:00Z"));
  assert.deepEqual([r.count, r.total, r.offset, r.limit], [4, 30, 12, 12]);
  assert.equal(r.jobs.length, 2);
  const [a, b] = r.jobs;
  assert.equal(a.title, "Analista de Dados Pleno");
  assert.equal(a.source, "gupy");
  assert.equal(a.remote, true);
  assert.deepEqual(a.locationRestrictions, ["Brasil"]);
  assert.match(a.location, /^Remoto \(São Paulo/);
  assert.match(a.description, /Inscrições até: 01\/12\/2026/);
  assert.match(a.description, /Atuar com SQL/);
  assert.equal(b.remote, false);
  assert.equal(b.location, "Londrina, Paraná");
  assert.deepEqual(b.tags, ["Presencial", "PJ"]);
});

test("Gupy: página da vaga vira texto com requisitos e responsabilidades", () => {
  const html = nextDataPage({
    name: "Analista de Dados",
    status: "published",
    description: "<p>Sobre a vaga.</p>",
    responsibilities: "<ul><li>Montar relatórios</li></ul>",
    prerequisites: "<ul><li>SQL avançado</li></ul>",
    workplaceType: "remote",
    jobType: "vacancy_type_effective",
    registerEndDate: "2026-12-14",
    careerPage: { name: "Empresa X" },
  });
  const t = jobPageText(html);
  assert.match(t, /^# Analista de Dados/);
  assert.match(t, /Empresa: Empresa X/);
  assert.match(t, /Requisitos e qualificações\n\n.*SQL avançado/);
  assert.match(t, /Responsabilidades e atribuições\n\n.*Montar relatórios/);
  assert.match(t, /Inscrições até: 2026-12-14/);
});
