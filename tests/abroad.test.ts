import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { abroadKnockout, abroadStatus, applyAbroad, mentionsCountry, onsiteAbroadOk, sameCountry } from "../src/jobs/abroad.js";
import { prefilter } from "../src/jobs/filter.js";
import { priorityOf } from "../src/jobs/priority.js";
import type { RawJob } from "../src/jobs/sources/index.js";
import { DEFAULT_PREFERENCES, type Preferences } from "../src/profile.js";
import type { Job, Triage } from "../src/schemas.js";

/* --------------------- vaga no exterior: remota restrita a outro país x mudança com visto --------------------- */

const prefs = (extra: Partial<Preferences> = {}): Preferences => ({ ...DEFAULT_PREFERENCES, country: "Brasil", ...extra });

test("países: o mesmo país em português e inglês, e citado no local da vaga", () => {
  assert.equal(sameCountry("EUA", "United States"), true);
  assert.equal(sameCountry("Brasil", "Brazil"), true);
  assert.equal(sameCountry("Estados Unidos (Califórnia)", "usa"), true);
  assert.equal(sameCountry("Portugal", "Espanha"), false);
  assert.equal(sameCountry("Polônia", "polonia"), true, "país fora da lista: compara o nome sem acento");
  assert.equal(mentionsCountry("Lisboa, Portugal", "portugal"), true);
  assert.equal(mentionsCountry("Austin, TX, US", "Estados Unidos"), true);
  assert.equal(mentionsCountry("Campus Lisboa", "EUA"), false, "'us' dentro de outra palavra não conta");
  assert.equal(mentionsCountry("São Paulo, Brazil", "Brasil"), true);
});

test("vaga no exterior: o critério segue as Preferências e o que o anúncio diz sobre visto", () => {
  const t = (workCountry: string, visaSponsorship: Triage["visaSponsorship"] = "nao_informado") => ({ workCountry, visaSponsorship });
  const meets = (tr: ReturnType<typeof t>, remote: boolean | null, p: Preferences) => abroadKnockout(tr, remote, p)?.meets ?? null;

  assert.equal(abroadKnockout(t(""), true, prefs()), null, "dá para fazer de onde mora");
  assert.equal(abroadKnockout(t("Brazil"), false, prefs()), null, "o país da pessoa, em outro idioma");

  // Remota só para quem mora lá: a empresa não leva ninguém.
  const usRemote = abroadKnockout(t("Estados Unidos"), true, prefs({ relocateAbroad: true }));
  assert.equal(usRemote?.meets, "nao");
  assert.equal(usRemote?.kind, "local");
  assert.equal(usRemote?.requirement, "Morar e trabalhar no exterior (Estados Unidos)");
  assert.equal(usRemote!.evidence, "A vaga é remota e só aceita quem já mora lá (Estados Unidos). O seu país é Brasil.");
  assert.equal(meets(t("Estados Unidos"), true, prefs({ acceptedRegions: ["brasil", "united states"] })), "sim", "quem tem autorização põe o país nas regiões");
  assert.equal(meets(t("Estados Unidos", "sim"), true, prefs({ relocateAbroad: true })), "sim", "remota que diz que patrocina a mudança");

  // Presencial ou híbrida no exterior.
  assert.equal(meets(t("Portugal", "sim"), false, prefs()), "nao", "não aceita se mudar");
  assert.equal(meets(t("Portugal", "sim"), false, prefs({ relocateAbroad: true })), "sim");
  assert.equal(meets(t("Portugal", "nao"), false, prefs({ relocateAbroad: true })), "nao");
  assert.equal(meets(t("Portugal"), false, prefs({ relocateAbroad: true })), "incerto");
  assert.match(abroadKnockout(t("Portugal"), false, prefs({ relocateAbroad: true }))!.evidence, /Pergunte ao recrutador/);
  assert.equal(meets(t("Alemanha", "sim"), false, prefs({ relocateAbroad: true, relocationCountries: ["portugal"] })), "nao", "fora dos países escolhidos");
  assert.equal(meets(t("Germany", "sim"), false, prefs({ relocateAbroad: true, relocationCountries: ["alemanha"] })), "sim");
});

test("vaga no exterior: um critério só, e a vaga não fica como recomendada sem atender", () => {
  const base: Triage = {
    fit: "alta", score: 92, evidence: [], mustHaveGaps: [], scamSignals: [], recommendation: "candidatar", market: "US", jobLanguage: "en",
    seniority: "pleno", reason: "", workCountry: "Estados Unidos", visaSponsorship: "nao_informado",
    knockouts: [
      { requirement: "Authorized to work in the US", kind: "autorizacao", meets: "incerto", evidence: "" },
      { requirement: "Based in the US", kind: "local", meets: "incerto", evidence: "" },
      { requirement: "3+ years", kind: "experiencia", meets: "sim", evidence: "desde 2022" },
    ],
  };
  const remote = applyAbroad(base, true, prefs());
  assert.deepEqual(remote.knockouts!.map((k) => k.requirement), ["Morar e trabalhar no exterior (Estados Unidos)", "3+ years"], "os de local e autorização da IA saem");
  assert.equal(remote.recommendation, "decidir");
  assert.deepEqual(abroadStatus(remote), { country: "Estados Unidos", sponsorship: "nao_informado", meets: "nao" });

  const lisbon = { ...base, workCountry: "Portugal", visaSponsorship: "sim" as const };
  assert.equal(applyAbroad(lisbon, false, prefs({ relocateAbroad: true })).recommendation, "candidatar", "patrocina e a pessoa aceita");
  assert.equal(applyAbroad({ ...lisbon, visaSponsorship: "nao_informado" }, false, prefs({ relocateAbroad: true })).recommendation, "decidir", "pergunta antes");
  const noCountry = { ...base, workCountry: "" };
  assert.equal(applyAbroad(noCountry, true, prefs()), noCountry, "sem país: a mesma triagem, com os critérios da IA");
  assert.equal(abroadStatus({ ...base, workCountry: "" }), null);
});

test("filtro: presencial no exterior só passa para quem aceita se mudar", () => {
  const job = (location: string, remote: boolean | null, locationRestrictions?: string[]): RawJob => ({
    source: "t", title: "Full Stack Developer", company: "Acme", location, remote, url: `https://x/${location}`, tags: [], description: "", locationRestrictions,
  });
  const jobs = [job("Lisboa, Portugal", false), job("Berlin, Germany", false), job("Curitiba, Brasil", false), job("United States", true, ["United States"])];
  const kept = (p: Preferences) => prefilter(jobs, p).kept.map((k) => k.location);

  assert.deepEqual(kept(prefs({ onsiteCities: ["Londrina"] })), [], "padrão: nada no exterior, nada fora das cidades");
  assert.deepEqual(kept(prefs({ onsiteCities: ["Londrina"], relocateAbroad: true })), ["Lisboa, Portugal", "Berlin, Germany"]);
  assert.deepEqual(kept(prefs({ onsiteCities: ["Londrina"], relocateAbroad: true, relocationCountries: ["alemanha"] })), ["Berlin, Germany"]);
  assert.equal(onsiteAbroadOk("Curitiba, Brasil", prefs({ relocateAbroad: true })), false, "outra cidade do próprio país não é exterior");
  assert.equal(onsiteAbroadOk("", prefs({ relocateAbroad: true })), false);
});

test("prioridade: vaga no exterior sem patrocínio informado desce um pouco; sem atender, desce mais", () => {
  const NOW = Date.parse("2026-11-16T12:00:00Z");
  const job = (triage: Partial<Triage>): Job =>
    ({
      id: "a", source: "t", title: "Dev", company: "Acme", location: "", remote: false, url: "https://acme.com/1", tags: [], description: "x".repeat(600),
      addedAt: new Date(NOW).toISOString(), postedAt: new Date(NOW - 86_400_000).toISOString(), status: "triaged",
      triage: { fit: "alta", score: 80, evidence: [], mustHaveGaps: [], scamSignals: [], recommendation: "decidir", market: "EU", jobLanguage: "en", seniority: "pleno", reason: "", ...triage },
    }) as Job;
  const ask = applyAbroad(job({ workCountry: "Portugal", visaSponsorship: "nao_informado" }).triage!, false, prefs({ relocateAbroad: true }));
  const no = applyAbroad(job({ workCountry: "Portugal", visaSponsorship: "nao" }).triage!, false, prefs({ relocateAbroad: true }));
  const home = priorityOf(job({}), NOW);
  assert.equal(priorityOf(job(ask), NOW), home - 10);
  assert.equal(priorityOf(job(no), NOW), home - 25);
});
