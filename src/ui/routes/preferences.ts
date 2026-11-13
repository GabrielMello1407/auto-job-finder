import fs from "node:fs";
import { ensureDir, paths, setEnvVar, settings } from "../../config.js";
import { SOURCES } from "../../jobs/sources/index.js";
import { loadPreferences, type Preferences } from "../../profile.js";
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
        if (!prefs.queries.length) throw new HttpError(400, "Deixe pelo menos um termo de busca.");
        if (!prefs.defaultSources.length && !prefs.webSearchByDefault) throw new HttpError(400, "Ligue pelo menos uma fonte de vagas ou a busca na web.");

        ensureDir(paths.profileDir);
        fs.writeFileSync(paths.preferences, JSON.stringify(prefs, null, 2) + "\n");

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
