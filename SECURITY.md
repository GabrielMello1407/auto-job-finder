# Security

**English** · [Português](SECURITY.pt-BR.md)

auto-job-finder handles personal data (resume, contacts, application history), runs a local server and reads jobs published by third parties. Security issues are taken seriously.

## How to report

**Don't open a public issue.** Use GitHub's private reporting: the repository's **Security** tab → **Report a vulnerability**.

Include:
- what happens and what the impact is;
- the steps to reproduce, with made-up data;
- operating system, Node version and the AI in use, if it matters.

Replies happen in the maintainer's spare time: the goal is to acknowledge within a few days and agree on the fix with you before anything is disclosed.

## In scope

- **Local server (`ajf`):** access from another site or another machine, bypassing the token, reading files outside `output/`, running commands.
- **Third-party data:** jobs and pages read from the internet that manage to run commands, write outside the project folders or inject content into the page.
- **Prompt injection:** a job text that makes the AI invent facts about the person, bypass the guards or leak profile data.
- **Personal data leaks:** the profile, `.env` or API keys ending up in logs, in git or in any service without need.

## Out of scope

- Problems in the AI providers, the job sites or the browser itself.
- Attacks that require prior access to your operating system account.

## Versions

Only the latest version of the `main` branch gets fixes.
