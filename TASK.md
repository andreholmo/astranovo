# Tarefa atual

- **ID:** TASK-002
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base obrigatória:** `docs/UPSTREAM_ADAPTATION.md`
- **Upstream fixado:** `immortalhowwl/gptheist@2ad2e47b798341df4584edd68a6998e8c07c0618`

## Objetivo

Criar a baseline TypeScript do AstraNovo como adaptação rastreável do núcleo seguro do GPTHEIST, mantendo somente replay/paper-only. Esta tarefa prepara a fundação; ainda não conecta Astra nem mercado ao vivo.

## Instruções

1. Sincronize `main` antes de começar e leia `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/UPSTREAM_ADAPTATION.md` e o plano anterior.
2. Inspecione diretamente o upstream no commit fixado. Não trabalhe de memória.
3. Adote Node.js 20+ e TypeScript estrito.
4. Crie na raiz:
   - `package.json`, lockfile e `tsconfig.json`;
   - `src/domain/`, `src/orchestrator/`, `src/risk/`, `src/broker/`, `src/portfolio/`, `src/market/`, `src/agents/`, `src/audit/`, `src/metrics/`;
   - `config/agents.json`;
   - `tests/` e fixtures mínimas;
   - CI para build, lint/typecheck e testes.
5. A configuração deve conter seis agentes iniciais, mas loader, tipos, loops e armazenamento devem aceitar qualquer quantidade positiva. Não use tuplas de seis nem nomes codificados na lógica.
6. Cada agente configurado precisa de `id`, `name`, `strategy`, `enabled` e `initialBudgetUsd`. Use `100` como orçamento demonstrativo provisório e documente que o proprietário o substituirá antes do primeiro experimento.
7. Implemente apenas o “vertical slice” determinístico:
   - carregar e validar a configuração;
   - receber um snapshot fixture;
   - gerar uma decisão stub BUY/SELL/HOLD por agente, sem rede e sem LLM;
   - aplicar Risk Manager fail-closed;
   - executar no PaperBroker;
   - manter carteira separada;
   - gravar eventos JSONL append-only;
   - calcular ao menos equity e P&L não realizado.
8. Preserve os padrões úteis do GPTHEIST: schemas em runtime, handoffs explícitos, veto incontornável, IDs determinísticos, replay reproduzível, escaping de caracteres de controle, escrita segura de auditoria e testes negativos.
9. Não importe Desk, assets, servidor, Robinhood Chain/Pons, FxTwitter ou qualquer integração de execução real.
10. Crie `THIRD_PARTY_NOTICES.md` com URL, commit fixado e texto/atribuição MIT do upstream. Se copiar trechos substanciais, mantenha também os avisos nos arquivos derivados quando apropriado.
11. Mantenha `EXECUTION_MODE = "paper-only"` como invariante verificável. Não adicione variáveis de wallet, chave privada, corretora, testnet ou endpoint de ordens.
12. Atualize `docs/coordination/CLAUDE_REPORT.md` com arquivos, comandos, resultados, decisões e SHA do commit.

## Seis perfis iniciais

Use perfis experimentais simples e claramente rotulados, sem alegação de lucratividade:

- trend-following;
- mean-reversion;
- breakout;
- momentum;
- volatility-filtered;
- conservative-baseline.

Nesta tarefa eles podem compartilhar o mesmo stub determinístico; a estratégia deve permanecer um campo configurável para implementação posterior.

## Critérios de aceite

- `npm ci`, build/typecheck e testes passam em ambiente limpo;
- exatamente seis entradas vêm na configuração padrão;
- um teste adiciona dinamicamente um sétimo agente sem alterar código e o ciclo o processa;
- carteiras e orçamentos são isolados;
- BUY acima do caixa é reduzido ou vetado conforme política explícita;
- SELL acima da posição é vetado;
- snapshot inválido ou incompleto produz HOLD/veto, nunca execução;
- agente com falha não impede o processamento dos outros;
- mesmo fixture + configuração + versão de política gera o mesmo resultado e IDs;
- log já existente nunca é sobrescrito com conteúdo diferente;
- nenhum teste, fixture, log ou fonte contém segredo;
- busca por caminhos de execução real não encontra implementação;
- atribuição MIT está presente;
- README explica execução local e deixa explícito: experimento, paper-only, sem promessa de lucro.

## Fora de escopo

- chamada real ao Astra/LLM;
- coleta de dados reais;
- dashboard ou servidor;
- banco de dados;
- exchange, wallet, testnet ou dinheiro real;
- otimização de estratégia;
- paralelismo distribuído.

## Entrega

Um único commit de implementação em `main`, seguido de push. Não altere o status deste arquivo. Registre o commit e evidências no relatório; o ChatGPT fará a revisão e mudará o status.
