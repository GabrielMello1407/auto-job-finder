import { ensureDir, paths, setEnvVar, settings } from "../../config.js";
import { SOURCES } from "../../jobs/sources/index.js";
import { SERPAPI_KEY_URL, SERPAPI_SIGNUP_URL, serpApiJobs } from "../../jobs/sources/googlejobs.js";
import { bookmarkletHref } from "../../autofill/index.js";
import { sameCompany, unfollow } from "../../jobs/follow.js";
import { loadPreferences, savePreferences, type Preferences } from "../../profile.js";
import { loadRoutineState, syncSchedule } from "../../routine.js";
import { parseTime, SCHEDULER_LABELS, schedulerKind } from "../../scheduler.js";
import { clamp, HttpError, str, strList, type Route } from "../http.js";

/** Preferências de busca (profile/preferences.json) e as notas mínimas (.env). */

/** Chave da SerpApi: letras e números (a da conta tem 64). Só para pegar colagem errada, não é segurança. */
const SERPAPI_KEY_FORMAT = /^[A-Za-z0-9_-]{16,128}$/;

export function preferenceRoutes(): Route[] {
  return [
    [
      "GET",
      /^\/api\/preferences$/,
      () => ({
        prefs: loadPreferences(),
        sources: Object.entries(SOURCES).map(([id, s]) => ({ id, description: s.description })),
        minRating: settings.minRating,
        minTriageScore: settings.minTriageScore,
        // Google for Jobs: só se há chave (a chave nunca volta para a página) e onde pegar uma.
        googleJobs: { hasKey: Boolean(process.env.SERPAPI_KEY?.trim()), signupUrl: SERPAPI_SIGNUP_URL, keyUrl: SERPAPI_KEY_URL },
        // O favorito "Preencher com ajf": sempre o mesmo código, sem dado nenhum da pessoa.
        bookmarklet: bookmarkletHref(),
        // Busca automática: qual agendador o sistema tem, o que está agendado e as últimas buscas.
        routine: (() => {
          const state = loadRoutineState();
          const kind = state.schedule?.kind ?? schedulerKind();
          return { scheduler: kind ? SCHEDULER_LABELS[kind] : null, schedule: state.schedule ?? null, runs: state.runs.slice(0, 5) };
        })(),
      }),
    ],
    [
      "POST",
      /^\/api\/preferences\/googlejobs\/test$/,
      async (c) => {
        // Uma busca de teste com a chave digitada (ou a salva). Gasta 1 busca da cota da SerpApi.
        const typed = str((await c.body()).key, 200);
        const key = typed || process.env.SERPAPI_KEY?.trim() || "";
        if (!key) throw new HttpError(400, "Cole a chave da SerpApi para testar.");
        if (!SERPAPI_KEY_FORMAT.test(key)) throw new HttpError(400, "Essa não parece uma chave da SerpApi. Copie de novo na página da sua conta.");
        const prefs = loadPreferences();
        try {
          const jobs = await serpApiJobs(prefs.queries[0] || prefs.targetRoles[0] || "developer", key, prefs.country);
          return { ok: true, count: jobs.length };
        } catch (e) {
          throw new HttpError(400, "A SerpApi recusou: {error}", { error: (e as Error).message });
        }
      },
    ],
    [
      "PUT",
      /^\/api\/preferences$/,
      async (c) => {
        const b = await c.body();
        const old = loadPreferences();
        const boards = (b.companyBoards ?? {}) as Record<string, unknown>;
        const prefs: Preferences = {
          ...old,
          targetRoles: strList(b.targetRoles, { max: 20 }),
          area: str(b.area, 60),
          seniority: str(b.seniority, 60),
          country: str(b.country, 60) || "Brasil",
          timezone: str(b.timezone, 20),
          queries: strList(b.queries, { max: 30 }),
          titleMustInclude: strList(b.titleMustInclude, { lower: true, max: 120 }),
          titleExclude: strList(b.titleExclude, { lower: true, max: 120 }),
          acceptedRegions: strList(b.acceptedRegions, { lower: true, max: 40 }),
          onsiteCities: strList(b.onsiteCities, { max: 30 }),
          relocateAbroad: Boolean(b.relocateAbroad),
          relocationCountries: strList(b.relocationCountries, { max: 30 }),
          excludedCompanies: strList(b.excludedCompanies, { max: 200 }),
          companyBoards: {
            greenhouse: strList(boards.greenhouse, { lower: true, max: 60 }),
            lever: strList(boards.lever, { lower: true, max: 60 }),
            ashby: strList(boards.ashby, { lower: true, max: 60 }),
          },
          defaultSources: strList(b.defaultSources).filter((s) => s in SOURCES),
          webSearchByDefault: Boolean(b.webSearchByDefault),
          maxAgeDays: Math.round(clamp(b.maxAgeDays, 1, 365, old.maxAgeDays)),
          webSearchHints: str(b.webSearchHints, 1500),
          applicationFacts: {
            salaryExpectation: str(b.salaryExpectation, 200),
            availability: str(b.availability, 200),
            noticePeriod: str(b.noticePeriod, 200),
            relocation: str(b.relocation, 200),
            workAuthorization: str(b.workAuthorization, 300),
          },
        };
        // Busca automática (src/routine.ts).
        const time = str(b.autoTime, 5) || old.autoSearch.time;
        if (!parseTime(time)) throw new HttpError(400, "Horário inválido: {time} (use HH:MM, por exemplo 08:00).", { time });
        prefs.autoSearch = {
          onOpen: Boolean(b.autoOnOpen),
          onOpenHours: Math.round(clamp(b.autoOnOpenHours, 1, 168, old.autoSearch.onOpenHours)),
          daily: Boolean(b.autoDaily),
          time,
          web: Boolean(b.autoWeb),
          triage: Boolean(b.autoTriage),
        };
        // Empresas seguidas: a lista de nomes da tela. Quem saiu deixa de ser seguida (e a página de carreira que
        // entrou ao seguir sai junto); quem entrou à mão fica só com o nome.
        const names = strList(b.followedCompanies, { max: 200 });
        let next: Preferences = prefs;
        for (const f of old.followedCompanies) if (!names.some((n) => sameCompany(n, f.name))) next = unfollow(next, f.name);
        const kept = next.followedCompanies.filter((f) => names.some((n) => sameCompany(n, f.name)));
        const added = names.filter((n) => !kept.some((f) => sameCompany(f.name, n))).map((name) => ({ name }));
        Object.assign(prefs, next, { followedCompanies: [...kept, ...added] });

        // Modo candidatura e resultados.
        prefs.applyMode = { referralStep: Boolean(b.applyReferralStep) };
        prefs.results = { compareResumes: Boolean(b.compareResumes) };
        prefs.autofill = {
          enabled: Boolean(b.autofillEnabled),
          contact: Boolean(b.autofillContact),
          links: Boolean(b.autofillLinks),
          location: Boolean(b.autofillLocation),
          current: Boolean(b.autofillCurrent),
          message: Boolean(b.autofillMessage),
          facts: Boolean(b.autofillFacts),
        };

        // Google for Jobs: termos por rodada (cota da SerpApi) e a chave, que só vai para o .env.
        prefs.googleJobs = { maxQueries: Math.round(clamp(b.googleJobsMaxQueries, 1, 10, old.googleJobs.maxQueries)) };
        const newKey = str(b.serpapiKey, 200);
        if (newKey && !SERPAPI_KEY_FORMAT.test(newKey)) throw new HttpError(400, "Essa não parece uma chave da SerpApi. Copie de novo na página da sua conta.");
        if (prefs.defaultSources.includes("googlejobs") && !newKey && (b.serpapiKeyRemove || !process.env.SERPAPI_KEY))
          throw new HttpError(400, "Para usar o Google for Jobs, cole a chave da SerpApi (o link para criar a conta grátis está ao lado).");

        if (!prefs.queries.length) throw new HttpError(400, "Deixe pelo menos um termo de busca.");
        if (!prefs.defaultSources.length && !prefs.webSearchByDefault) throw new HttpError(400, "Ligue pelo menos uma fonte de vagas ou a busca na web.");
        if (newKey) setEnvVar("SERPAPI_KEY", newKey);
        else if (b.serpapiKeyRemove) setEnvVar("SERPAPI_KEY", "");

        ensureDir(paths.profileDir);
        savePreferences(prefs);

        // O agendador do sistema acompanha a opção "todo dia". Se não der, a opção volta a desligada e a tela avisa.
        try {
          syncSchedule(prefs.autoSearch);
        } catch (e) {
          prefs.autoSearch.daily = false;
          savePreferences(prefs);
          throw new HttpError(400, "Preferências salvas, mas a busca diária não foi agendada: {error}", { error: (e as Error).message });
        }

        const minRating = clamp(b.minRating, 0, 10, settings.minRating);
        const minTriageScore = Math.round(clamp(b.minTriageScore, 0, 100, settings.minTriageScore));
        if (minRating !== settings.minRating) setEnvVar("AJF_MIN_RATING", String(minRating));
        if (minTriageScore !== settings.minTriageScore) setEnvVar("AJF_MIN_TRIAGE_SCORE", String(minTriageScore));
        settings.minRating = minRating;
        settings.minTriageScore = minTriageScore;
        return { ok: true };
      },
    ],
  ];
}
