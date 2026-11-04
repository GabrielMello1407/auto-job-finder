# auto-job-finder

Job-application agent for anyone, in any field (TypeScript, Node 20+). CLI entry: `npm run ajf -- <command>`, or `ajf <command>` after `npm link` (see README). User-facing text and docs are in Brazilian Portuguese; code identifiers are in English.

## LLM providers

`src/providers/`, detected in `providers/index.ts#detectProviders`:
- Subscription CLIs, preferred: `claude-code` (`claude -p --json-schema`), `codex` (`codex exec --output-schema`), `gemini-cli` (`gemini -p -o json` plus JSON validated by Zod).
- APIs: `anthropic`, `bedrock` and `vertex` (official SDKs, same code path), `openai` (Responses API, or Chat Completions when `OPENAI_BASE_URL` is set), `gemini` (REST).

`AJF_PROVIDER` forces one. Every LLM call goes through `src/llm.ts`, which keeps the providers interchangeable. When you add a provider, implement `LlmProvider` and register it in `PROVIDERS` and `createProvider`.

## User data

- Per-person data lives under `AJF_HOME` (default: the repo root) in `profile/`, `data/` and `output/`.
- All three are gitignored. Never commit personal data.
- `ajf init` (`src/onboarding/`) builds the profile from a resume, a LinkedIn PDF export, a portfolio, links, pasted text or a guided interview.
- `examples/profile/` is a fictional profile used by the tests (`tests/setup.ts` sets `AJF_HOME=examples`).

## Rules that must never be broken

- `profile/profile_truth.md` and `profile/base_resume.*.json` are the only sources of facts about the candidate. Never invent employers, titles, dates, numbers, tools, certifications or results. A job requirement without evidence is a gap, not something to fill.
- `profile/rules.json → neverClaim` lists claims the guards reject, for example a language level above the declared one, or a course presented as a certification. Do not hardcode person-specific rules in `src/`.
- Never submit an application, send an email or change LinkedIn on the user's behalf. The agent prepares material; the user reviews and sends.
- Keep the section headings when editing or generating `profile_truth.md`. `src/profile.ts#NON_EVIDENCE_HEADING` drops sections whose heading mentions "Lacuna", "Regras de comunicação", "A confirmar" or "Nunca" from the evidence used by the guards.
- Nothing in `src/` may be specific to one person or one profession. Prompts, sources and labels must work for any field.

## UX

- `ajf` with no args opens the interactive menu (`src/menu.ts`). On first run it starts `ajf init`.
- `ajf auto` runs `src/auto.ts`: search, then triage, then tailor every job with triage score ≥ `AJF_MIN_TRIAGE_SCORE`, then the dashboard. Web search defaults to `preferences.webSearchByDefault`.
- Packages with a final rating below `AJF_MIN_RATING` (7) get status `low_fit`.
- The package README (LEIA-ME) includes how to apply, based on `JobAnalysis.applyChannel` (email, linkedin, plataforma, site, whatsapp).
- `output/painel.html` is regenerated after every CLI command.

## Checks

- `npm run typecheck` and `npm test`. Tests are offline and cover guards, the refine loop, filter, ATS, rules, provider selection and JSON extraction.
- `npm run ajf -- base` renders the base resumes without calling the LLM. Run it after touching `src/render/`.
- `npm run ajf -- ia --testar` makes one short real call to the active provider.
