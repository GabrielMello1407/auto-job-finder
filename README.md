# auto-job-finder

Agente de IA para candidaturas, **para qualquer área e qualquer vaga**:

1. Monta o seu perfil a partir do que você tiver: currículo (PDF/DOCX), PDF do LinkedIn, portfólio, site, GitHub, texto colado, ou respondendo a perguntas.
2. Busca vagas e faz a triagem: aderência, lacunas, sinais de golpe.
3. Adapta o currículo para cada vaga no padrão ATS.
4. Gera cover letter, e-mails e mensagens para o recrutador, passo a passo de candidatura e plano de LinkedIn.

Funciona com a IA que você já tem: **assinatura Claude, ChatGPT (Codex) ou Gemini**, sem chave de API. Também aceita **APIs**: Anthropic, Amazon Bedrock, Google Vertex, OpenAI ou compatível, e Gemini.

> Nada é enviado automaticamente. O agente prepara; você revisa e se candidata.

## Começando

Requisitos:
- Node 20+.
- Chrome ou Edge, para gerar os PDFs.
- **Uma** das IAs abaixo.

```bash
npm install
npm link        # uma vez: libera o comando `ajf` em qualquer pasta
ajf             # na primeira vez, abre a configuração do perfil
```

### Qual IA o agente usa

O agente procura sozinho o que está instalado e configurado, nesta ordem:

| Opção | Como ativar | Custo |
|---|---|---|
| Claude Pro/Max | instale o [Claude Code](https://claude.com/claude-code) e rode `claude` para logar | já incluso na assinatura |
| ChatGPT Plus/Pro | `npm i -g @openai/codex` e `codex login` | já incluso na assinatura |
| Conta Google | `npm i -g @google/gemini-cli` e rode `gemini` para logar | cota da conta |
| API Anthropic | `ANTHROPIC_API_KEY` no `.env` | por uso |
| Amazon Bedrock | `AWS_REGION` + credenciais AWS + `AJF_PROVIDER=bedrock` | por uso (sem busca web) |
| Google Vertex AI | `ANTHROPIC_VERTEX_PROJECT_ID` + `CLOUD_ML_REGION` | por uso |
| OpenAI ou compatível | `OPENAI_API_KEY` (e `OPENAI_BASE_URL` para OpenRouter, Groq, Ollama…) | por uso |
| API Gemini | `GEMINI_API_KEY` | por uso / cota grátis |

```bash
ajf ia             # mostra o que foi detectado e qual está em uso
ajf ia --escolher  # escolhe entre as disponíveis (grava AJF_PROVIDER no .env)
ajf ia --testar    # faz uma chamada curta para confirmar
```

Modelo: `AJF_MODEL` e `AJF_TRIAGE_MODEL` no `.env`. Se ficarem vazios, nas CLIs vale o padrão da sua conta. Veja `.env.example`.

## 1. Seu perfil (`ajf init`)

Informe o que você tiver; pode ser mais de uma fonte:
- **Currículo ou portfólio:** PDF, DOCX, TXT ou MD. Arquivos soltos na pasta do projeto são encontrados sozinhos.
- **LinkedIn:** o LinkedIn bloqueia leitura automática. No seu perfil, use **Mais → Salvar como PDF** e informe o arquivo; o agente reconhece o PDF do LinkedIn. Também dá para colar o texto.
- **Links:** portfólio ou site (inclusive feitos em React/Vue) e perfil do GitHub (lê os repositórios públicos).
- **Sem currículo:** uma entrevista guiada pergunta experiências, formação, cursos, ferramentas e idiomas.

Depois, a IA lê tudo e faz até 8 perguntas para preencher o que falta (datas, resultados com números, certificação × curso). Por fim, você escolhe cargos-alvo, senioridade, modalidade, cidades e se aceita vaga internacional. O agente gera:

```
profile/
  profile_truth.md        fatos verificados (fonte única de verdade) + lacunas + "A confirmar" + "Nunca afirmar"
  base_resume.pt.json     currículo-base em português
  base_resume.en.json     resume-base em inglês
  preferences.json        cargos, termos de busca, filtros, regiões, cidades, fontes
  rules.json              frases que o agente nunca pode escrever (ex.: "inglês fluente", "certificado X")
  sources/                texto extraído de cada fonte
```

**Revise o `profile_truth.md`**, principalmente "A confirmar". Tudo o que o agente escreve sai dele. Para refazer com um currículo novo, rode `ajf init` de novo; o anterior vai para um backup.

## 2. Uso no dia a dia

```bash
ajf            # menu interativo: setas e Enter, sem decorar comando nem ID
ajf auto       # piloto automático: busca → triagem → pacotes das melhores vagas → painel
ajf painel     # painel no navegador com links para currículo, carta, e-mails e vaga
```

Opções do menu:
- **Piloto automático:** gera pacotes só para vagas com triagem ≥ 70 e sem sinal de golpe.
- **Vagas recomendadas:** detalhes, lacunas, abrir a vaga, gerar pacote (uma ou várias), descartar.
- **Meus pacotes:** abrir o PDF, ver o e-mail e as mensagens de LinkedIn, marcar como enviado.
- **Candidaturas em andamento:** avisa o follow-up depois de 7 dias e registra entrevista, oferta ou recusa.
- **Colar uma vaga:** para a vaga que você viu no LinkedIn, Gupy, WhatsApp ou numa indicação.
- **Atualizar meu perfil** e **Escolher a IA**.

**Nota mínima:** o pacote com nota final **≥ 7** sai como ✅ pronto para enviar. Abaixo disso fica ⚠ baixa aderência. Ajuste com `AJF_MIN_RATING` e `AJF_MIN_TRIAGE_SCORE`.

## O pacote de cada vaga

`output/<data>-<empresa>-<cargo>/`

```
LEIA-ME.md          nota, ATS, COMO SE CANDIDATAR (e-mail, LinkedIn, Gupy/plataforma, site, WhatsApp) e checklist
<Nome>_Resume_<Empresa>.pdf        currículo ATS (Curriculo_ para vagas no Brasil)
<Nome>_Cover_Letter_<Empresa>.pdf  quando o mercado pede (EUA, Canadá, Europa, internacional) ou com --cover
emails.md           e-mail de candidatura, convite LinkedIn (≤300), mensagem direta, follow-up, agradecimento
ats_report.md · rating_report.md · coverage_review.md · interview_prep.md (opcional)
resume.json         edite à mão e rode `ajf render <pasta>`
```

O agente lê a vaga e identifica **como se candidatar**: por e-mail (com assunto exigido e anexos), pelo LinkedIn (candidatura simplificada + convite ao recrutador), por plataforma (Gupy, Greenhouse, Workday…), pelo site ou por WhatsApp. O LEIA-ME traz o passo a passo certo.

**Cover letter × currículo:** nos EUA o padrão é resume + cover letter, em papel Letter, sem foto/idade/estado civil. No Brasil sai o currículo em A4 e a carta é opcional. Se a vaga estiver em inglês, o currículo sai em inglês.

## Fontes de vagas

| Fonte | Foco |
|---|---|
| busca web por IA (`--web`) | LinkedIn, Gupy, Indeed, Glassdoor, Catho, sites de carreira — **qualquer área** |
| `remotive`, `himalayas`, `jobicy`, `arbeitnow` | remoto internacional, várias áreas |
| `github-br`, `getonbrd`, `remoteok`, `weworkremotely` | tecnologia (Brasil, América Latina, remoto) |
| `greenhouse`, `lever`, `ashby` | páginas de carreira de empresas em `preferences.json → companyBoards` |

O `ajf init` escolhe as fontes conforme a sua área. Fora de tecnologia, a busca web vem ligada por padrão (`webSearchByDefault`). Vagas presenciais/híbridas só passam nas cidades que você informou, e vagas remotas restritas a outros países são filtradas.

## Comandos (modo avançado)

| Comando | O que faz |
|---|---|
| `ajf init [arquivos ou links...]` | Configura/refaz o perfil |
| `ajf ia [--escolher] [--testar]` | IAs detectadas e qual usar |
| `ajf doctor` | Confere IA, Chrome e arquivos do perfil |
| `ajf base` | PDFs dos currículos-base (sem IA) |
| `ajf search [--web] [-q termos] [-s fontes] [-v]` | Busca vagas |
| `ajf triage` | Triagem das vagas novas |
| `ajf jobs [--status shortlisted]` · `ajf show <id>` | Lista / detalhes |
| `ajf add --file vaga.md --company X --title Y` · `ajf add --url <link>` | Adiciona vaga |
| `ajf tailor <id> [--interview] [--market US] [--cover]` | Gera o pacote |
| `ajf render <pasta>` | Gera o PDF de novo depois de editar `resume.json` |
| `ajf linkedin [--current meu_linkedin.md]` | Plano de LinkedIn: headline, Sobre PT/EN, competências, destaques, Open to Work |
| `ajf status <id> applied --note "via Gupy"` | Atualiza status e registra em `output/tracker.csv` |
| `ajf auto [--web/--no-web] [--max 3] [--interview] [--open]` | Piloto automático |

Sem `npm link`, use `npm run ajf -- <comando>` dentro do projeto. O ID aceita prefixo (`tailor 78cb`).

## Anti-invenção

- **Regra de ouro:** só fatos do `profile_truth.md` e dos currículos-base. Requisito sem evidência é **lacuna**, nunca preenchimento.
- **Travas em código** (não dependem da IA se autoavaliar):
  - número sem fonte;
  - posição removida;
  - datas ou cargo alterados;
  - certificação ou projeto sem fonte;
  - frases proibidas do `rules.json`.
- **Loop hiring manager ⇄ editor** até a nota 8.5. Para quando não melhora, porque insistir numa lacuna real empurra o modelo a inventar, e fica sempre com a melhor versão limpa.
- **Relatório ATS** em três grupos:
  - *coberto*;
  - *você tem, mas não mostrou*;
  - *lacuna real*.

Ideias de base do [R238Company/meu-emprego-novo](https://github.com/R238Company/meu-emprego-novo): perfil-mestre, "a IA propõe, você decide", loop de avaliação, revisão de cobertura e checklist anti-golpe.

## Privacidade e segurança

- O perfil, as vagas, os pacotes e o `.env` ficam **só na sua máquina**: `profile/`, `data/`, `output/` e PDFs/DOCX na raiz estão no `.gitignore`.
- Para manter vários perfis (ex.: ajudar alguém da família), use `AJF_HOME=/outra/pasta`.
- As CLIs de IA rodam isoladas numa pasta temporária vazia, sem ferramentas de escrita.
- **Golpes miram quem procura emprego.** Recuse:
  - teste que peça para baixar e rodar código;
  - pedido de documento na candidatura;
  - pedido de pagamento ou "kit".

  A triagem sinaliza esses padrões com 🚩.

## Custos

- **Assinatura (Claude, ChatGPT, Gemini):**
  - Não há cobrança extra; o uso conta no limite da conta.
  - Cada pacote faz de 6 a 10 chamadas. Se bater o limite, use um modelo menor em `AJF_MODEL`.
- **APIs:**
  - Triagem: por volta de US$ 0,02–0,05 por vaga.
  - Pacote completo: por volta de US$ 0,50–2,00 com modelos de ponta.
- `data/usage.jsonl` registra os tokens de cada chamada.

## Código

```
src/
  cli.ts · menu.ts · auto.ts · dashboard.ts
  llm.ts                 ponto único de acesso à IA (structured / text / webSearchStructured)
  providers/             claude-code, codex, gemini-cli, anthropic|bedrock|vertex, openai, gemini + detecção
  onboarding/            ajf init: leitura de PDF/DOCX/LinkedIn/sites/GitHub, entrevista, montagem do perfil
  profile.ts · prompts.ts · schemas.ts · market.ts
  jobs/                  fontes, filtro, banco local (data/jobs.json), triagem
  tailor/                agentes, loop de refinamento, travas, ATS, pacote
  writers/               cover letter, e-mails, entrevista, LinkedIn
  render/                template HTML → PDF (Chrome headless)
examples/profile/        perfil fictício (formato de referência; usado nos testes)
tests/core.test.ts       testes offline: npm test
```
