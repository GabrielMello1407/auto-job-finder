# auto-job-finder

Job-application agent for anyone, in any field (TypeScript, Node 22.12+). CLI entry: `npm run ajf -- <command>`, or `ajf <command>` after `npm link` (see README). User-facing text and docs are in Brazilian Portuguese; code identifiers are in English.

## LLM providers

`src/providers/`, detected in `providers/index.ts#detectProviders`:
- Subscription CLIs, preferred: `claude-code` (`claude -p --json-schema`), `codex` (`codex exec --output-schema`), `gemini-cli` (`gemini -p -o json` plus JSON validated by Zod).
- APIs: `anthropic`, `bedrock` and `vertex` (official SDKs, same code path), `openai` (Responses API, or Chat Completions when `OPENAI_BASE_URL` is set), `gemini` (REST).

`AJF_PROVIDER` forces one. Every LLM call goes through `src/llm.ts`, which keeps the providers interchangeable. When you add a provider, implement `LlmProvider` and register it in `PROVIDERS` and `createProvider`.

## User data

- Per-person data lives under `AJF_HOME` (default: the repo root) in `profile/`, `data/` and `output/`.
- All three are gitignored. Never commit personal data.
- `ajf init` and the UI wizard (`src/onboarding/`) build the profile from a resume, a LinkedIn PDF export, a portfolio, links, pasted text or a guided interview. UI uploads are saved in `profile/entrada/`.
- Profile updates go through `src/onboarding/update.ts`: a proposal (`profile/atualizacao/proposta.json`, with the hash of the truth it was based on) that the user approves after seeing a line diff, then `rebuildBaseResumes` updates `base_resume.*.json` from the truth. New experiences must reach the base resumes, because the guards reject experiences missing from them. `ajf atualizar`, `ajf base --refazer` and Perfil → "Atualizar o perfil" in the UI are the entry points.
- The agent never reads or edits LinkedIn. `src/writers/linkedin.ts` writes plans and checks (`output/linkedin/plano_*` and `conferencia_*`) from the text or PDF export the user provides.
- Package folders live in `output/1-prontas-para-enviar`, `2-em-andamento`, `3-baixa-aderencia` or `4-encerradas` by status (`src/jobs/folders.ts`). Change status and paths through `jobs/store.ts#updateJob` (or `jobs/status.ts#changeStatus`), which moves the folder and keeps `outputDir`/`files` in `data/jobs.json` in sync.
- `examples/profile/` is a fictional profile used by the tests (`tests/setup.ts` sets `AJF_HOME=examples`).

## Rules that must never be broken

- `profile/profile_truth.md` and `profile/base_resume.*.json` are the only sources of facts about the candidate. Never invent employers, titles, dates, numbers, tools, certifications or results. A job requirement without evidence is a gap, not something to fill.
- `profile/rules.json → neverClaim` lists claims the guards reject, for example a language level above the declared one, or a course presented as a certification. Do not hardcode person-specific rules in `src/`.
- Never submit an application, send an email or change LinkedIn on the user's behalf. The agent prepares material; the user reviews and sends.
- Keep the section headings when editing or generating `profile_truth.md`. `src/profile.ts#NON_EVIDENCE_HEADING` drops sections whose heading mentions "Lacuna", "Regras de comunicação", "A confirmar" or "Nunca" from the evidence used by the guards.
- Nothing in `src/` may be specific to one person or one profession. Prompts, sources and labels must work for any field.
- Never open URLs or paths through a shell (`cmd /c start`, `sh -c`). Job links come from third-party sites; use `src/util/open.ts#openExternal`.
- The local UI must stay bound to 127.0.0.1 and behind the token cookie. Every user-supplied string rendered in `src/ui/public/` goes through `esc()`, external links must be `http(s)` and files are served only from `output/` via `/files/`.

## UX

- `ajf` with no args opens the local web UI (`src/ui/`): `server.ts` (127.0.0.1 only, token cookie, static files, SSE), `routes/` (jobs, profile/onboarding/LinkedIn, preferences), `tasks.ts` (one-at-a-time queue that captures terminal output as the task log) and a no-build page in `src/ui/public/` (ES modules in `js/`). Without a profile the UI opens on the onboarding wizard, which reuses `onboarding/index.ts#buildAndSaveProfile` like `ajf init`. `ajf menu` opens the terminal menu (`src/menu.ts`). Keep the UI and the menu offering the same actions.
- A pasted job without a link (referral, e-mail, WhatsApp) can be researched on the web before triage: `src/jobs/research.ts#researchJob` (UI paste switch, `ajf add --pesquisar`, `ajf pesquisar`). It appends a `## Pesquisa na web` block to the description (replaced on re-run by `withoutResearch`) and stores the verdict in `Job.research`. Record only what the search found; never invent postings, links or contacts.
- Application-form questions ("why do you want to work here?") are answered by `src/writers/answers.ts` (UI tab Perguntas, `ajf responder`, menu). Same rules as the resume: facts only from the profile and what the person says; numbers and `neverClaim` are checked. Answers live in `Job.answers` and `perguntas_e_respostas.md` in the package folder.
- `ajf auto` runs `src/auto.ts`: search, then triage, then tailor every job with triage score ≥ `AJF_MIN_TRIAGE_SCORE`, then the dashboard. Web search defaults to `preferences.webSearchByDefault`.
- Repeated jobs are caught in `jobs/store.ts#upsertJobs` by `src/jobs/dedupe.ts` (no LLM): same canonical link (`canonicalUrl`, which also feeds `jobId`), or same company, similar title at the same level and overlapping description text. A near-duplicate from a search is saved as `discarded` with `duplicateOf`; a pasted one is saved normally, only flagged. Same company plus the same title is enough when the text can't be compared (short, or a web-search summary, `page.ts#isWebSummary`) or when the other job was already handled (package, application, rejection). After every search `store.ts#flagHandledTwins` flags saved jobs that match a handled one, and `ajf auto` checks again before each package. Reopening, or "Não é a mesma vaga", sets `notDuplicate` so the job is never flagged again. Near-duplicates only count within `AJF_REPEAT_WINDOW_DAYS` (90) of the other job's application or save date, and not when the new one was posted 14+ days after it: outside that, it is a reopened job (`reopenedFrom`, shown as "vaga reaberta"). The same link is always the same job. Recalibrate the thresholds on real data before changing them, and keep the tests in `tests/search.test.ts` passing.
- `src/jobs/open.ts` checks whether a job still takes applications (`pageVerdict` is pure and tested). `tailorJob` checks first and throws `JobClosedError` unless `ignoreClosed`; `ajf auto` discards closed jobs and moves on to the next one. When unsure the verdict is `sem_confirmacao` and nothing is blocked. `ajf conferir`, the menu and the UI button check every job not yet sent.
- The `gupy` source reads the `__NEXT_DATA__` of the portal search page; it needs queries in Portuguese.
- Packages with a final rating below `AJF_MIN_RATING` (7) get status `low_fit`.
- The package README (LEIA-ME) includes how to apply, based on `JobAnalysis.applyChannel` (email, linkedin, plataforma, site, whatsapp).
- `output/painel.html` is regenerated after every CLI command.

## Checks

- `npm run typecheck` and `npm test`. Tests are offline and cover guards, the refine loop, filter, ATS, rules, provider selection and CLI detection, JSON extraction, finding jobs by name, package folders by status, the UI parsers (pending items, e-mail sections), canonical links and repeated jobs, the closed-job verdict and the Gupy parsers.
- After touching `src/ui/public/js/`, run `node --check` on the changed files (they are not type-checked) and open the UI with `npm run demo` (fictional profile and jobs in `demo/`, no LLM; `scripts/demo.ts`).

## Docs

- `README.md` is the showcase, `docs/guia-de-uso.md` the user guide (every screen, commands, FAQ) and `docs/como-funciona.md` the internals (pipeline, guards, providers, UI, code map). Update the guide when something users see changes.
- Screenshots in `docs/images/` come only from `npm run demo`, never from real data. The logo is `src/ui/public/logo.svg` (also the UI favicon).
- `npm run ajf -- base` renders the base resumes without calling the LLM. Run it after touching `src/render/`.
- `npm run ajf -- ia --testar` makes one short real call to the active provider.
