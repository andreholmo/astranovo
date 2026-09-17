# Tarefa atual

- **ID:** TASK-002
- **Milestone:** M0 — Fundação e contratos
- **Status:** APPROVED
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Commit entregue:** `1e5bfbc0e880d8e8e9ef7504e03b6015adcc0d10`
- **Revisão:** `docs/coordination/CHATGPT_REVIEW_TASK_002.md`

## Objetivo

Criar uma baseline TypeScript mínima e testável: configuração de N agentes, contratos centrais e validação runtime. Esta tarefa não implementa trading, LLM, mercado ao vivo, Risk Manager ou broker.

## Leitura obrigatória

Antes de editar:

1. `CLAUDE.md`
2. `docs/PROJECT_CONTEXT.md`
3. `docs/GPTHEIST_ANALYSIS.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DECISIONS.md`
6. `docs/ROADMAP.md`

Inspecione também `immortalhowwl/gptheist@2ad2e47b798341df4584edd68a6998e8c07c0618` para entender os padrões, sem copiar o Desk ou a integração Pons.

## Escopo exato

Crie:

- projeto Node.js 20+ com TypeScript estrito;
- `package.json`, lockfile, `tsconfig.json` e `.gitignore`;
- `src/domain/contracts.ts`;
- `src/config/load-agents.ts`;
- `config/agents.json`;
- testes unitários offline;
- CI de build/typecheck e testes;
- README mínimo de instalação/testes e aviso paper-only;
- `THIRD_PARTY_NOTICES.md` com referência, commit e licença MIT do GPTHEIST.

## Contratos mínimos

### AgentConfig

Campos obrigatórios:

- `id`: slug único;
- `name`: texto limitado;
- `strategy`: slug;
- `enabled`: boolean;
- `initialBudgetUsd`: número finito e positivo;
- `mode`: `reference | optimized`.

### MarketSnapshot

Campos obrigatórios:

- `schemaVersion: 1`;
- `snapshotId`;
- `source`;
- `asset`;
- `quote`;
- `asOf`: UTC ISO-8601 canônico;
- `availableAt`: UTC ISO-8601 canônico;
- `price`: número finito e positivo;
- `spreadBps`: número finito e não negativo;
- `complete`: boolean.

Invariante temporal: `availableAt >= asOf`. Documente que somente informação disponível até `availableAt` pode entrar em uma decisão.

### AgentProposal

Campos obrigatórios:

- `schemaVersion: 1`;
- `proposalId`, `cycleId`, `agentId`;
- `action: BUY | SELL | HOLD`;
- `asset`;
- `confidence` entre 0 e 1;
- `positionPct` entre 0 e 1;
- `reason` limitado;
- `veto`: boolean;
- `evidenceIds`: lista limitada de IDs;
- `promptVersion`;
- `model`.

Semântica obrigatória: HOLD exige `positionPct = 0`; BUY representa fração do caixa/equity elegível; SELL representa fração da posição atual. Não interprete texto livre.

## Configuração padrão

Inclua exatamente seis agentes habilitados, todos com `initialBudgetUsd: 100`:

- trend-following;
- mean-reversion;
- breakout;
- momentum;
- volatility-filtered;
- conservative-baseline.

IDs e nomes podem ser claros e estáveis. A lógica não pode conter limite fixo de seis.

## Validação runtime

Implemente validadores explícitos para os três contratos. Pode usar funções TypeScript próprias; evite dependência runtime nesta milestone.

Rejeite:

- campos ausentes/tipos errados;
- NaN/Infinity;
- strings vazias, excessivas ou com controles;
- IDs duplicados;
- lista vazia de agentes;
- timestamps não canônicos;
- violação temporal;
- enum desconhecido;
- HOLD com tamanho diferente de zero;
- percentuais fora do intervalo;
- evidenceIds excessivos ou duplicados.

Erros devem ser claros, mas não incluir stack/segredos em output destinado ao usuário.

## Testes obrigatórios

- configuração padrão carrega exatamente seis agentes;
- cada orçamento é US$100;
- sétimo agente é aceito sem mudança de código;
- zero agentes é rejeitado;
- IDs duplicados são rejeitados;
- cada classe de valor inválido acima possui teste;
- MarketSnapshot futuro/inconsistente é rejeitado;
- AgentProposal HOLD com posição não zero é rejeitado;
- objetos validados não são mutados;
- testes são offline e determinísticos.

## Restrições

Não criar nesta tarefa:

- decisão stub;
- orquestrador;
- Risk Manager;
- PaperBroker;
- carteira/ledger;
- métricas;
- coleta de mercado;
- chamada Astra/LLM;
- servidor, dashboard ou banco;
- wallet, testnet, exchange ou execução real.

Não copie nomes dos dez personagens para a lógica. Não altere `TASK.md`.

## Critérios de aceite

- `npm ci` passa;
- build/typecheck estrito passa;
- testes passam em ambiente limpo;
- CI usa permissões mínimas;
- nenhuma dependência runtime desnecessária;
- configuração aceita N positivo;
- contratos e invariantes estão documentados/testados;
- nenhuma rota de execução financeira existe;
- atribuição upstream está presente.

## Entrega

1. Atualize `docs/coordination/CLAUDE_REPORT.md` com arquivos, comandos, resultados, limitações e decisões.
2. Faça um único commit com a mensagem `feat: cria fundacao tipada do AstraNovo`.
3. Push para `origin main`.
4. Informe o SHA completo.
5. Não marque a tarefa como aprovada.
