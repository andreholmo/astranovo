# Tarefa atual

- **ID:** TASK-025
- **Milestone:** M3/M6 — relatório multiagente offline
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_024.md`

## Objetivo

Criar a menor composição pura, determinística e fail-closed que reúna, para vários agentes, os resultados paper já calculados pelas primitivas existentes em um relatório comparável e legível por máquina.

`resumos validados por agente → relatório multiagente offline`

Esta tarefa deve tornar visíveis os primeiros números inteiramente fictícios do projeto em um teste demonstrativo, sem chamar agente, mercado, broker, rede ou qualquer serviço externo.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, os documentos de arquitetura, decisões e roadmap, `docs/coordination/CHATGPT_REVIEW_TASK_024.md`, `docs/coordination/CLAUDE_REPORT.md`, `config/agents.json`, `src/config/load-agents.ts`, `src/metrics/summarize-equity-series.ts`, `src/metrics/summarize-realized-performance.ts`, `src/metrics/summarize-execution-costs.ts`, `src/benchmark/build-strategy-benchmark-report.ts` e esta tarefa.

## Escopo exato

Crie `src/metrics/build-multi-agent-performance-report.ts`.

Defina uma entrada por agente que reúna, sem recalcular:

- `EquitySeriesSummary`;
- `RealizedPerformanceSummary`;
- `ExecutionCostSummary`;
- `StrategyBenchmarkReport`.

Implemente `buildMultiAgentPerformanceReport(entries)`, devolvendo um relatório imutável com uma linha por agente contendo somente:

- identificação do agente e janela do experimento;
- patrimônio inicial e final;
- direção e magnitude exatas do P&L;
- drawdown máximo;
- contagem de trades fechados;
- fração exata de win rate;
- fees e impacto de execução;
- comparação da estratégia contra cash e buy-and-hold.

Regras:

- aceitar N agentes; não codificar o número seis;
- exigir lista não vazia, `agentId` único e alinhado em todos os quatro resumos de cada entrada;
- exigir a mesma janela `startedAt`/`endedAt` e o mesmo `pointCount` para todos os agentes;
- revalidar fail-closed os campos consumidos, inclusive contagens, fração de win rate e valores monetários;
- preservar a ordem de entrada; não criar ranking, vencedor ou recomendação;
- não recalcular P&L, drawdown, custos, win rate ou benchmarks;
- congelar linhas e coleção externa;
- não mutar entradas.

## Testes obrigatórios

- composição correta para uma lista configurável de agentes;
- teste demonstrativo com os seis IDs de `config/agents.json`, capital inicial fictício de US$100 por agente e números distintos e explícitos para patrimônio final, P&L, drawdown, custos, trades, win rate e comparações;
- o teste demonstrativo deve imprimir ou serializar uma tabela determinística segura para `bigint`, de modo que os primeiros números fictícios fiquem visíveis no log da CI;
- preservação da ordem sem ranking;
- rejeição de lista vazia, agente duplicado, IDs desalinhados, janelas incompatíveis, contagens incoerentes e valores monetários inválidos;
- imutabilidade, ausência de mutação e determinismo;
- prova offline de ausência de relógio, timer, aleatoriedade, rede e I/O.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Não criar ciclo de replay completo, estratégia, decisão BUY/SELL/HOLD, chamada de agente, prompt, integração Astra real, provider de mercado, ordem, fill, Risk Manager, broker, ledger, persistência, CSV, JSONL, banco, ranking, seleção automática de agente ou otimização.

Não usar HTTP, SDK, fila, concorrência, timer, delay, relógio, aleatoriedade, ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora, dinheiro real, cloud ou dashboard.

## Critérios de aceite

- relatório multiagente mínimo, imutável e determinístico;
- números fictícios dos seis agentes visíveis na CI, claramente identificados como demonstração offline;
- nenhuma fórmula financeira duplicada nem resultado recalculado;
- validação fail-closed de consistência;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: consolida relatório multiagente offline`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
