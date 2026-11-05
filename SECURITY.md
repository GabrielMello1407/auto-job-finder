# Segurança

O auto-job-finder lida com dados pessoais (currículo, contatos, histórico de candidaturas), roda um servidor local e lê vagas publicadas por terceiros. Falhas de segurança são levadas a sério.

## Como reportar

**Não abra uma issue pública.** Use o reporte privado do GitHub: aba **Security** do repositório → **Report a vulnerability**.

Inclua:
- o que acontece e qual o impacto;
- os passos para reproduzir, com dados fictícios;
- sistema operacional, versão do Node e a IA em uso, se importar.

A resposta é feita no tempo livre de quem mantém o projeto: a ideia é confirmar o recebimento em poucos dias e combinar a correção com você antes de qualquer divulgação.

## O que está no escopo

- **Servidor local (`ajf`):** acesso de outro site ou de outra máquina, burla do token, leitura de arquivos fora de `output/`, execução de comandos.
- **Dados de terceiros:** vagas e páginas lidas da internet que consigam executar comandos, escrever fora das pastas do projeto ou injetar conteúdo na página.
- **Injeção de instruções:** um texto de vaga que faça a IA inventar fatos sobre a pessoa, burlar as travas ou vazar dados do perfil.
- **Vazamento de dados pessoais:** perfil, `.env` ou chaves de API indo para logs, para o git ou para algum serviço sem necessidade.

## Fora do escopo

- Problemas dos provedores de IA, dos sites de vagas ou do navegador em si.
- Ataques que exigem acesso prévio à sua conta do sistema operacional.

## Versões

Só a versão mais recente do branch `main` recebe correções.
