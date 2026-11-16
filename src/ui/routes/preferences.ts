import { ensureDir, paths, setEnvVar, settings } from "../../config.js";
import { SOURCES } from "../../jobs/sources/index.js";
import { sameCompany, unfollow } from "../../jobs/follow.js";
import { loadPreferences, savePreferences, type Preferences } from "../../profile.js";
import { loadRoutineState, syncSchedule } from "../../routine.js";
import { parseTime, SCHEDULER_LABELS, schedulerKind } from "../../scheduler.js";
import { clamp, HttpError, str, strList, type Route } from "../http.js";

/** Preferências de busca (profile/preferences.json) e as notas mínimas (.env). */

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
        // Busca automática: qual agendador o sistema tem, o que está agendado e as últimas buscas.
        routine: (() => {
          const state = loadRoutineState();
          const kind = state.schedule?.kind ?? schedulerKind();
          return { scheduler: kind ? SCHEDULER_LABELS[kind] : null, schedule: state.schedule ?? null, runs: state.runs.slice(0, 5) };
        })(),
      }),
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

        if (!prefs.queries.length) throw new HttpError(400, "Deixe pelo menos um termo de busca.");
        if (!prefs.defaultSources.length && !prefs.webSearchByDefault) throw new HttpError(400, "Ligue pelo menos uma fonte de vagas ou a busca na web.");

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
