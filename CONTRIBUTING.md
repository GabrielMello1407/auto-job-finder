# Contributing

**English** · [Português](CONTRIBUTING.pt-BR.md)

Thanks for wanting to help! auto-job-finder is a job-application agent for **anyone, in any field**. Every contribution has to keep it that way.

## Before you start

- For bugs and ideas, open an [issue](https://github.com/GabrielMello1407/auto-job-finder/issues) using one of the templates.
- For big changes (a new AI provider, a new screen, a new profile format), open an issue before writing code so we agree on the direction.
- Security issues do **not** go in public issues: see [SECURITY.md](SECURITY.md).

## Running the project

Requirements: Node 22.12 or newer (`.nvmrc` points to 22), Chrome/Edge/Chromium (for the PDFs) and one configured AI (see the [README](README.md#getting-started-for-real)).

```bash
npm install
npm run ajf              # opens the interface
npm run ajf -- menu      # terminal menu
npm run ajf -- --help    # every command
```

**Use test data, not your own.** The easiest way is the demo:

```bash
npm run demo              # demo/ folder with a fictional profile and jobs, opens the interface
npm run demo -- --no-open # only prints the link
```

It is rebuilt on every run (`scripts/demo.ts`), uses no AI and covers every job stage. To test the full flow with an AI without mixing it with your own profile, point `AJF_HOME` to another folder:

```bash
# macOS/Linux
AJF_HOME=/tmp/ajf-test npm run ajf -- ui --no-open
# Windows (PowerShell)
$env:AJF_HOME="C:\temp\ajf-test"; npm run ajf -- ui --no-open
```

`examples/profile/` holds a fictional profile used as a reference, by the tests and by the demo.

## Checks before a PR

```bash
npm run typecheck
npm test
# the page's JS files are not type-checked: check the syntax of each one
for f in src/ui/public/js/*.js; do node --check "$f"; done
```

CI runs the same checks on Ubuntu, macOS and Windows for every PR.

- Touched `src/render/`? Run `npm run ajf -- base` and check the PDFs in `output/base/`.
- Touched an AI provider? Run `npm run ajf -- ia --testar`.
- Touched the interface? Run `npm run demo` and use the real screen, in the light and dark themes.
- Changed something shown in the documentation screenshots? Take new screenshots **from the demo**, never with real data, in both languages: `docs/images/` with the interface in Portuguese and `docs/images/en/` (same file names) with it in English.
- Touched the layout? Check it narrow too (phone and tablet widths) and in both languages, since the English labels have a different length.

Tests live in `tests/` (`*.test.ts` files), run offline and never call an AI. Every bug fix should come with a test when possible.

## Project rules

They are the same as in [CLAUDE.md](CLAUDE.md) (also [AGENTS.md](AGENTS.md)), which apply to people and to AI agents:

1. **No personal data in the repository.** `profile/`, `data/` and `output/` stay out of git. Don't paste resumes, real jobs or your `.env` into issues, tests or examples.
2. **The agent never makes up facts.** Everything about the person comes from `profile_truth.md` and the base resumes. A requirement without evidence is a gap, not something to fill in. Don't weaken the guards (`src/tailor/guards.ts`).
3. **It works for any field.** Nothing in `src/` may be specific to one person or one profession: prompts, sources and texts have to work for nursing, sales or software development.
4. **The agent prepares, the person sends.** Never submit an application, send an e-mail or change LinkedIn on someone's behalf.
5. **Security:**
   - never open links or paths through a shell (use `src/util/open.ts`);
   - the interface stays on `127.0.0.1`, behind a token;
   - every text that comes from outside goes through `esc()` before reaching the page.
6. **Language:**
   - code identifiers in English;
   - the interface is in English and Brazilian Portuguese: every text on screen goes through `t("Texto em português")` (page) or `c.t(...)` / `new HttpError(status, "...")` (server), and gets its English entry in `src/ui/public/locales/en.json`. `npm run i18n` lists what is missing, and `npm test` fails while something is;
   - the terminal and the files generated for the user are in Brazilian Portuguese for now; what goes to recruiters follows the language of each job;
   - in the English docs, buttons and screens are named by their English label on screen;
   - the main documentation (README, CONTRIBUTING, SECURITY, `docs/`) is in English, with a Brazilian Portuguese copy next to it (`README.pt-BR.md`, `CONTRIBUTING.pt-BR.md`, `SECURITY.pt-BR.md`, `docs/guia-de-uso.md`, `docs/como-funciona.md`). When you change one, change the other.

## Where to make changes

- **New AI provider:** implement `LlmProvider` in `src/providers/` and register it in `PROVIDERS` and `createProvider` (`src/providers/index.ts`). Every call goes through `src/llm.ts`. Handle `CallOptions.images` too (helpers in `src/providers/images.ts`).
- **New job source:** create a `JobSource` in `src/jobs/sources/` (with a `description`) and register it in `SOURCES`.
- **Interface:** routes in `src/ui/routes/`, page in `src/ui/public/` (HTML, CSS and JS modules, no build step). Keep the interface and the terminal menu (`src/menu.ts`) offering the same actions. New text on screen: write it in Portuguese inside `t()` and add the English to `locales/en.json`. Pass a literal, not a variable, so the key can be found (`cond ? t("a") : t("b")`, not `t(cond ? "a" : "b")`).

The full structure and how each part works are in [docs/how-it-works.md](docs/how-it-works.md). The user walkthrough is in [docs/user-guide.md](docs/user-guide.md): update it (and the Portuguese copy) when something users see changes.

## Commits and PRs

- Messages in the `type: what changed` style: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`. English or Portuguese are both fine.
- One subject per PR. Describe the problem, what changed and how you tested it.
- Fill in the checklist in the PR template.

## License

By contributing, you agree that your contribution will be distributed under the [MIT license](LICENSE).
