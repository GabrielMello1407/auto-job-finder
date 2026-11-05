# Contribuindo

Obrigado por querer ajudar! O auto-job-finder é um agente de candidaturas para **qualquer pessoa, em qualquer área**. Toda contribuição precisa manter isso.

## Antes de começar

- Para bugs e ideias, abra uma [issue](https://github.com/GabrielMello1407/auto-job-finder/issues) usando um dos modelos.
- Para mudanças grandes (um provedor de IA novo, uma tela nova, mudar o formato do perfil), abra uma issue antes do código para combinar a direção.
- Falhas de segurança **não** vão em issue pública: veja [SECURITY.md](SECURITY.md).

## Rodando o projeto

Requisitos: Node 22.12 ou mais novo (o `.nvmrc` aponta o 22), Chrome/Edge/Chromium (para os PDFs) e uma IA configurada (veja o [README](README.md#qual-ia-o-agente-usa)).

```bash
npm install
npm run ajf              # abre a interface
npm run ajf -- menu      # menu no terminal
npm run ajf -- --help    # todos os comandos
```

**Use dados de teste, não os seus.** O jeito mais fácil é a demonstração:

```bash
npm run demo              # pasta demo/ com perfil e vagas fictícios, e abre a interface
npm run demo -- --no-open # só mostra o link
```

Ela é recriada a cada execução (`scripts/demo.ts`), não usa IA e cobre todas as etapas das vagas. Para testar o fluxo completo com IA sem misturar com o seu perfil, aponte `AJF_HOME` para outra pasta:

```bash
# macOS/Linux
AJF_HOME=/tmp/ajf-teste npm run ajf -- ui --no-open
# Windows (PowerShell)
$env:AJF_HOME="C:\temp\ajf-teste"; npm run ajf -- ui --no-open
```

`examples/profile/` tem um perfil fictício que serve de referência, é usado pelos testes e pela demonstração.

## Checagens antes do PR

```bash
npm run typecheck
npm test
# os arquivos JS da página não passam pelo typecheck: confira a sintaxe de cada um
for f in src/ui/public/js/*.js; do node --check "$f"; done
```

O CI roda essas mesmas checagens em Ubuntu, macOS e Windows a cada PR.

- Mexeu em `src/render/`? Rode `npm run ajf -- base` e confira os PDFs em `output/base/`.
- Mexeu num provedor de IA? Rode `npm run ajf -- ia --testar`.
- Mexeu na interface? Rode `npm run demo` e use a tela de verdade, no tema claro e no escuro.
- Mudou algo que aparece nos prints da documentação (`docs/images/`)? Tire os prints novos **da demonstração**, nunca com dados reais.

Os testes ficam em `tests/` (arquivos `*.test.ts`), rodam offline e não chamam IA. Toda correção de bug deve vir com um teste quando der.

## Regras do projeto

São as mesmas do [CLAUDE.md](CLAUDE.md), que vale para pessoas e para agentes de IA:

1. **Nada de dados pessoais no repositório.** `profile/`, `data/` e `output/` ficam fora do git. Não cole currículo, vagas reais ou o seu `.env` em issues, testes ou exemplos.
2. **O agente nunca inventa fatos.** Tudo sobre a pessoa sai do `profile_truth.md` e dos currículos-base. Requisito sem evidência é lacuna, não algo a preencher. Não enfraqueça as travas (`src/tailor/guards.ts`).
3. **Funciona para qualquer área.** Nada em `src/` pode ser específico de uma pessoa ou de uma profissão: prompts, fontes e textos têm que servir para enfermagem, vendas ou desenvolvimento.
4. **O agente prepara, a pessoa envia.** Nunca enviar candidatura, e-mail ou mudar o LinkedIn em nome de alguém.
5. **Segurança:**
   - nunca abrir links ou caminhos por um shell (use `src/util/open.ts`);
   - a interface fica só em `127.0.0.1`, com token;
   - todo texto vindo de fora passa por `esc()` antes de ir para a página.
6. **Idioma:** textos para quem usa e documentação em português do Brasil, simples e diretos; nomes no código em inglês.

## Onde mexer

- **Novo provedor de IA:** implemente `LlmProvider` em `src/providers/` e registre em `PROVIDERS` e `createProvider` (`src/providers/index.ts`). Toda chamada passa por `src/llm.ts`.
- **Nova fonte de vagas:** crie um `JobSource` em `src/jobs/sources/` (com `description`) e registre em `SOURCES`.
- **Interface:** rotas em `src/ui/routes/`, página em `src/ui/public/` (HTML, CSS e módulos JS, sem build). Mantenha a interface e o menu do terminal (`src/menu.ts`) com as mesmas ações.

A estrutura completa e o funcionamento de cada parte estão em [docs/como-funciona.md](docs/como-funciona.md). O passo a passo de uso está em [docs/guia-de-uso.md](docs/guia-de-uso.md): atualize-o quando mudar algo que quem usa vê.

## Commits e PRs

- Mensagens no estilo `tipo: o que mudou`, em português: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
- Um assunto por PR. Descreva o problema, o que mudou e como você testou.
- Preencha o checklist do modelo de PR.

## Licença

Ao contribuir, você concorda que a sua contribuição será distribuída sob a [licença MIT](LICENSE).
