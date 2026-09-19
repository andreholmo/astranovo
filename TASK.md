# Tarefa atual

- **ID:** TASK-018
- **Milestone:** M3 — relatório determinístico consolidado de benchmarks
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_017.md`

## Objetivo

Consolidar, em uma única função pura, as comparações já existentes da estratégia contra cash e buy-and-hold, sem recalcular métricas nem executar qualquer operação financeira.

`EquitySeriesSummary + CashBenchmark + BuyAndHoldBenchmark → StrategyBenchmarkReport`

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, os documentos de contexto, arquitetura, decisões e roadmap, `docs/coordination/CHATGPT_REVIEW_TASK_017.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/benchmark/compare-to-cash-benchmark.ts`, `src/benchmark/compare-strategy-to-buy-and-hold.ts`, `src/benchmark/build-cash-benchmark.ts`, `src/benchmark/build-buy-and-hold-benchmark.ts` e esta tarefa.

## Escopo exato

Crie `src/benchmark/build-strategy-benchmark-report.ts`.

Implemente uma função pura que:

- receba um `EquitySeriesSummary`, um `CashBenchmark` e um `BuyAndHoldBenchmark`;
- reutilize obrigatoriamente as duas funções de comparação existentes;
- falhe fechado quando qualquer entrada for incompatível ou inconsistente;
- devolva um relatório imutável com a identificação comum do experimento e as duas comparações;
- não replique fórmulas ou validações monetárias já existentes;
- preserve os resultados exatos em micros e os sentidos das comparações.

## Regras obrigatórias

- Não executar ordem, broker, risco, replay ou valoração.
- Não reconstruir benchmarks.
- Não mutar entradas.
- Mesmo input canônico produz resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.
- Toda inconsistência gera `ContractValidationError`.
- Não adicionar dependência runtime.

## Testes obrigatórios

- relatório consolidado com estratégia superando ambos os benchmarks;
- combinações distintas de resultado, incluindo empate;
- propagação fail-closed de divergências em cash e buy-and-hold;
- prova de que as funções existentes são a fonte das comparações;
- imutabilidade do relatório, não mutação e determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Win rate, P&L realizado por trade, ranking multiagente, novas estratégias, execução, wallet, blockchain, testnet, corretora, credenciais, dinheiro real, cloud ou dashboard.

## Critérios de aceite

- composição correta e auditável das duas comparações existentes;
- validação fail-closed herdada sem duplicação de fórmula;
- resultado imutável e determinístico;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: consolida relatório de benchmarks`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
