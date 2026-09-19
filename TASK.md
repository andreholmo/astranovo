# Tarefa atual

- **ID:** TASK-015
- **Milestone:** M3 — comparação buy-and-hold versus cash
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_014.md`

## Objetivo

Comparar de forma determinística e auditável os dois benchmarks já existentes, respondendo se o buy-and-hold terminou acima, abaixo ou empatado com o cash no mesmo experimento.

`CashBenchmark + BuyAndHoldBenchmark → BuyAndHoldVsCashComparison`

Esta tarefa apenas compara resultados existentes. Não executa ordens, não reconstrói benchmarks e não altera carteira.

## Leitura obrigatória

Sincronize `main` e leia integralmente:

1. `CLAUDE.md`;
2. `docs/PROJECT_CONTEXT.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISIONS.md`;
5. `docs/ROADMAP.md`;
6. `docs/coordination/CHATGPT_REVIEW_TASK_014.md`;
7. `docs/coordination/CLAUDE_REPORT.md`;
8. `src/benchmark/build-cash-benchmark.ts`;
9. `src/benchmark/build-buy-and-hold-benchmark.ts`;
10. `src/benchmark/compare-to-cash-benchmark.ts`;
11. `src/metrics/summarize-equity-series.ts`;
12. `src/money/fixed-point.ts`;
13. esta tarefa.

## Escopo exato

Crie `src/benchmark/compare-buy-and-hold-to-cash.ts`.

Implemente uma função `compareBuyAndHoldToCash` que receba:

- um `BuyAndHoldBenchmark`;
- um `CashBenchmark`.

A função deve validar fail-closed, antes da comparação:

- `kind === "BUY_AND_HOLD"` e `kind === "CASH"`;
- mesmo `agentId`;
- mesmo `initialCashMicros`;
- mesmo `startedAt`, `endedAt` e `pointCount` nos resumos;
- consistência interna entre o `agentId` externo de cada benchmark e o respectivo resumo;
- consistência do cash: capital inicial igual ao patrimônio inicial e final;
- consistência mínima do buy-and-hold: fill inicial BUY, agente/ativo/quote do fill iguais aos campos externos e patrimônio final igual ao resumo recebido;
- todos os valores monetários usados na comparação são `bigint` não negativos dentro de `MAX_MICROS`.

O resultado `BuyAndHoldVsCashComparison` deve ser profundamente imutável e registrar no mínimo:

- `comparisonKind: "BUY_AND_HOLD_VS_CASH"`;
- `agentId`;
- `startedAt`;
- `endedAt`;
- `pointCount`;
- `initialCashMicros`;
- `buyAndHoldEndingEquityMicros`;
- `cashEndingEquityMicros`;
- `result: "OUTPERFORMED" | "UNDERPERFORMED" | "TIED"`, sempre da perspectiva do buy-and-hold;
- `differenceMagnitudeMicros`, diferença absoluta exata em `bigint`.

## Regras obrigatórias

- Reutilizar `subtractChecked`, `MAX_MICROS` e os tipos existentes.
- Não usar `number` para dinheiro.
- Não executar `PaperBroker`, ordens, fills adicionais ou qualquer operação de carteira.
- Não duplicar construção de benchmark, cálculo de patrimônio, P&L ou drawdown.
- Não mutar entradas.
- Mesmo input canônico deve produzir resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.
- Toda incompatibilidade ou inconsistência deve gerar `ContractValidationError`; nunca tentar corrigir ou comparar parcialmente.
- Não alterar `compareToCashBenchmark` nesta tarefa, salvo correção mínima indispensável demonstrada por teste.

## Testes obrigatórios

- buy-and-hold supera cash;
- buy-and-hold perde para cash;
- empate;
- diferença absoluta exata nos três casos;
- aceita que o primeiro patrimônio do buy-and-hold seja menor que o capital inicial por custos de entrada;
- rejeita `kind` forjado em qualquer benchmark;
- rejeita `agentId` incompatível ou internamente inconsistente;
- rejeita capital inicial diferente;
- rejeita janela temporal ou quantidade de pontos diferente;
- rejeita cash internamente inconsistente;
- rejeita fill inicial que não seja BUY ou que divirja em agente, ativo ou quote;
- rejeita valores monetários inválidos, negativos ou acima de `MAX_MICROS`;
- não muta entradas;
- resultado congelado;
- determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário para explicar a comparação e deixar claro que o resultado é da perspectiva do buy-and-hold.

Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos, testes, limitações e decisões técnicas.

## Fora do escopo

Não implementar:

- estratégia de agente ou comparação entre agentes;
- replay de propostas;
- ordens novas, venda ou liquidação;
- benchmark aleatório;
- Astra/LLM, prompts ou handoffs;
- novas regras de risco;
- coleta de mercado ou rede;
- persistência;
- dashboard, servidor ou cloud;
- wallet externa, chave privada, blockchain;
- testnet, corretora, exchange, credenciais ou dinheiro real.

Não adicionar dependência runtime. Não alterar este `TASK.md`.

## Critérios de aceite

- comparação usa somente benchmarks existentes e compatíveis;
- resultado correto da perspectiva do buy-and-hold;
- diferença monetária exata em `bigint`;
- inconsistências falham fechado;
- nenhuma ordem ou alteração de carteira;
- resultado imutável e determinístico;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real existe.

## Entrega

1. Faça um único commit com a mensagem `feat: compara buy and hold com cash`.
2. Faça push em branch própria; a automação deve abrir o PR para `main`.
3. No PR, inclua resumo, testes e `Closes #26`.
4. Não aprove o próprio trabalho e não altere o status desta tarefa.
