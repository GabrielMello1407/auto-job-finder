import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { countryParams, googleJobs, parseGoogleJobs, postedAtFrom, serpApiJobs } from "../src/jobs/sources/googlejobs.js";
import { modelResolver, providerInfo, searchProviderId, type Detection, type ProviderId } from "../src/providers/index.js";

/* ------------------------------- Google for Jobs (SerpApi) e IA da busca na web ------------------------------- */

const NOW = Date.parse("2026-11-16T12:00:00Z");

/** Resposta no formato do exemplo da documentação da SerpApi (google-jobs-api). */
const SAMPLE = {
  jobs_results: [
    {
      title: "Desenvolvedora Full Stack",
      company_name: "Acme Ltda",
      location: "São Paulo, SP",
      via: "via LinkedIn",
      share_link: "https://www.google.com/search?ibp=htl;jobs#htivrt=jobs&htidocid=abc",
      extensions: ["3 days ago", "Full-time"],
      detected_extensions: { posted_at: "3 days ago", schedule_type: "Full-time", salary: "R$ 8 mil–R$ 10 mil por mês" },
      description: "Vaga para trabalhar com Node.js e React.",
      job_highlights: [
        { title: "Qualifications", items: ["3+ anos com Node.js", "React"] },
        { title: "Benefits", items: [] },
      ],
      apply_options: [
        { title: "Google", link: "https://www.google.com/about/careers/x" },
        { title: "LinkedIn", link: "https://www.linkedin.com/jobs/view/4012345678?utm_campaign=google_jobs_apply" },
      ],
      job_id: "eyJqb2JfdGl0bGUiOiJ...",
    },
    {
      title: "Backend Engineer",
      company_name: "Beta",
      location: "Anywhere",
      via: "via Gupy",
      share_link: "https://www.google.com/search?ibp=htl;jobs#htidocid=def",
      detected_extensions: { posted_at: "há 5 horas" },
      description: "Remote role.",
      apply_options: [{ title: "Link quebrado", link: "não é um link" }],
    },
    { title: "Sem empresa", description: "x" },
  ],
};

test("Google for Jobs: lê a resposta da SerpApi sem IA", () => {
  const jobs = parseGoogleJobs(SAMPLE, NOW);
  assert.equal(jobs.length, 2, "vaga sem empresa fica de fora");
  const [a, b] = jobs;
  assert.equal(a.source, "googlejobs");
  assert.equal(a.url, "https://www.linkedin.com/jobs/view/4012345678?utm_campaign=google_jobs_apply", "o link da vaga, não o do Google");
  assert.equal(a.company, "Acme Ltda");
  assert.equal(a.salary, "R$ 8 mil–R$ 10 mil por mês");
  assert.deepEqual(a.tags, ["LinkedIn", "Full-time"]);
  assert.match(a.description, /Node\.js e React\.\n\n## Qualifications\n- 3\+ anos com Node\.js\n- React$/, "destaques no fim, sem seção vazia");
  assert.equal(a.postedAt, new Date(NOW - 3 * 86_400_000).toISOString());
  assert.equal(a.remote, false);
  assert.equal(b.remote, true, "\"Anywhere\" é remoto");
  assert.equal(b.url, "https://www.google.com/search?ibp=htl;jobs#htidocid=def", "sem link de vaga válido, fica o do Google");
  assert.equal(b.postedAt, new Date(NOW - 5 * 3_600_000).toISOString());
});

test("Google for Jobs: data relativa, país da busca", () => {
  assert.equal(postedAtFrom("30+ days ago", NOW), new Date(NOW - 30 * 86_400_000).toISOString());
  assert.equal(postedAtFrom("an hour ago", NOW), new Date(NOW - 3_600_000).toISOString());
  assert.equal(postedAtFrom("há 2 semanas", NOW), new Date(NOW - 14 * 86_400_000).toISOString());
  assert.equal(postedAtFrom("Just posted", NOW), undefined);
  assert.equal(postedAtFrom(undefined, NOW), undefined);
  assert.deepEqual(countryParams("Brasil"), { gl: "br", hl: "pt-br", location: "Brazil" });
  assert.deepEqual(countryParams("United States"), { gl: "us", hl: "en", location: "United States" });
  assert.deepEqual(countryParams("Nárnia"), {}, "país fora da lista: só a busca");
});

test("Google for Jobs: parâmetros, limite de termos e a chave nunca no erro", async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.SERPAPI_KEY;
  const urls: URL[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: SAMPLE };
  globalThis.fetch = (async (input: string | URL) => {
    urls.push(new URL(String(input)));
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const key = "abc123SECRETkey4567890";
    const jobs = await serpApiJobs("desenvolvedor node", key, "Brasil");
    assert.equal(jobs.length, 2);
    const u = urls[0];
    assert.equal(`${u.origin}${u.pathname}`, "https://serpapi.com/search");
    assert.equal(u.searchParams.get("engine"), "google_jobs");
    assert.equal(u.searchParams.get("q"), "desenvolvedor node");
    assert.equal(u.searchParams.get("gl"), "br");
    assert.equal(u.searchParams.get("location"), "Brazil");
    assert.equal(u.searchParams.get("api_key"), key);

    reply = { status: 401, body: { error: `Invalid API key: ${key}. Your API key should be here: https://serpapi.com/manage-api-key` } };
    await assert.rejects(serpApiJobs("x", key, "Brasil"), (e: Error) => !e.message.includes(key) && /Invalid API key: \*\*\*/.test(e.message));
    reply = { status: 200, body: { error: "Google hasn't returned any results for this query." } };
    assert.deepEqual(await serpApiJobs("x", key, "Brasil"), [], "sem vagas para o termo não é erro");

    // Sem chave: erro claro. Com chave: no máximo N termos por rodada (cada um gasta uma busca da cota).
    delete process.env.SERPAPI_KEY;
    await assert.rejects(googleJobs.fetch({ queries: ["a"], companyBoards: { greenhouse: [], lever: [], ashby: [] } }), /falta a chave da SerpApi/);
    process.env.SERPAPI_KEY = key;
    reply = { status: 200, body: SAMPLE };
    urls.length = 0;
    await googleJobs.fetch({ queries: ["a", "b", "c", "d", "e"], companyBoards: { greenhouse: [], lever: [], ashby: [] }, country: "Brasil", googleJobsMaxQueries: 2 });
    assert.deepEqual(urls.map((x) => x.searchParams.get("q")), ["a", "b"]);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = realKey;
  }
});

test("IA da busca na web: só uma IA pronta e que busca na web; o modelo é o dela", () => {
  const real = { provider: process.env.AJF_SEARCH_PROVIDER, model: process.env.AJF_MODEL };
  const det = (id: ProviderId, ready = true): Detection => ({ info: providerInfo(id), ready, detail: "" });
  const dets = [det("claude-code"), det("codex"), det("bedrock"), det("gemini-cli", false)];
  try {
    delete process.env.AJF_SEARCH_PROVIDER;
    assert.equal(searchProviderId(dets), null, "sem escolha: a principal");
    process.env.AJF_SEARCH_PROVIDER = "claude-code";
    assert.equal(searchProviderId(dets), "claude-code");
    process.env.AJF_SEARCH_PROVIDER = "bedrock";
    assert.equal(searchProviderId(dets), null, "não faz busca na web");
    process.env.AJF_SEARCH_PROVIDER = "gemini-cli";
    assert.equal(searchProviderId(dets), null, "não está pronta nesta máquina");
    process.env.AJF_SEARCH_PROVIDER = "não-existe";
    assert.equal(searchProviderId(dets), null);

    // AJF_MODEL é da IA principal: a IA da busca usa o modelo padrão dela.
    process.env.AJF_MODEL = "gpt-6.1-sol";
    assert.equal(modelResolver("claude-code")({ label: "x", system: [], user: "" }), "gpt-6.1-sol");
    assert.equal(modelResolver("claude-code", false)({ label: "x", system: [], user: "" }), providerInfo("claude-code").defaultModel || undefined);
  } finally {
    if (real.provider === undefined) delete process.env.AJF_SEARCH_PROVIDER;
    else process.env.AJF_SEARCH_PROVIDER = real.provider;
    if (real.model === undefined) delete process.env.AJF_MODEL;
    else process.env.AJF_MODEL = real.model;
  }
});
