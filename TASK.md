# Tarefa atual

- **ID:** TASK-019
- **Milestone:** M3 — relatório triangular completo de benchmarks
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_018.md`

## Objetivo

Completar o relatório consolidado de benchmarks incluindo a comparação já existente entre buy-and-hold e cash, sem recalcular métricas ou alterar os comparadores.

`StrategyBenchmarkReport + comparação existente BuyAndHoldVsCash → relatório triangular auditável`

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, os documentos de contexto, arquitetura, decisões e roadmap, `docs/coordination/CHATGPT_REVIEW_TASK_018.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/benchmark/build-strategy-benchmark-report.ts`, `src/benchmark/compare-to-cash-benchmark.ts`, `src/benchmark/compare-strategy-to-buy-and-hold.ts`, `src/benchmark/compare-buy-and-hold-to-cash.ts` e esta tarefa.

## Escopo exato

Evolua `buildStrategyBenchmarkReport` para:

- chamar também `compareBuyAndHoldToCash` exatamente uma vez;
- incluir no relatório o objeto completo `BuyAndHoldVsCashComparison`, sem transformação;
- preservar os três resultados e diferenças exatas em micros;
- manter a identificação comum do experimento;
- herdar fail-closed exclusivamente dos comparadores existentes;
- não adicionar fórmulas, reconstrução de benchmark ou validações monetárias duplicadas.

## Regras obrigatórias

- Não executar ordem, broker, risco, replay ou valoração.
- Não reconstruir benchmarks.
- Não mutar entradas.
- Mesmo input canônico produz resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.
- Toda inconsistência gera `ContractValidationError`.
- Não adicionar dependência runtime.

## Testes obrigatórios

- relatório contém as três comparações completas;
- combinações coerentes de vitória, derrota e empate;
- comparação buy-and-hold versus cash preservada verbatim;
- propagação fail-closed de inconsistência entre os dois benchmarks;
- imutabilidade, não mutação e determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Win rate, P&L realizado por trade, ranking multiagente, novas estratégias, execução, wallet, blockchain, testnet, corretora, credenciais, dinheiro real, cloud ou dashboard.

## Critérios de aceite

- relatório triangular correto e auditável;
- reutilização integral dos três comparadores existentes;
- nenhuma duplicação de fórmula ou validação monetária;
- resultado imutável e determinístico;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: completa relatório triangular de benchmarks`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
