# Tarefa atual

- **ID:** TASK-017
- **Milestone:** M3 — comparação determinística estratégia versus buy-and-hold
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_016.md`

## Objetivo

Comparar o resumo de patrimônio de uma estratégia com um `BuyAndHoldBenchmark` do mesmo experimento, sem executar ordens ou reconstruir o benchmark.

`EquitySeriesSummary + BuyAndHoldBenchmark → StrategyVsBuyAndHoldComparison`

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, os documentos de contexto, arquitetura, decisões e roadmap, `docs/coordination/CHATGPT_REVIEW_TASK_016.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/metrics/summarize-equity-series.ts`, `src/benchmark/build-buy-and-hold-benchmark.ts`, `src/benchmark/compare-to-cash-benchmark.ts`, `src/benchmark/compare-buy-and-hold-to-cash.ts` e esta tarefa.

## Escopo exato

Crie `src/benchmark/compare-strategy-to-buy-and-hold.ts`.

Implemente uma função pura que:

- receba um `EquitySeriesSummary` da estratégia e um `BuyAndHoldBenchmark`;
- valide que ambos pertencem ao mesmo experimento: `agentId`, `startedAt`, `endedAt`, `pointCount` e patrimônio inicial;
- valide fail-closed a consistência estrutural mínima do benchmark recebido, reutilizando os tipos e primitivas existentes;
- compare somente os patrimônios finais;
- devolva resultado imutável com direção `OUTPERFORMED | UNDERPERFORMED | TIED` da perspectiva da estratégia e diferença absoluta em micros;
- use `subtractChecked` e `MAX_MICROS`; nenhum ponto flutuante.

## Regras obrigatórias

- Não executar ordem, broker, risco, replay ou valoração.
- Não duplicar fórmulas monetárias.
- Não mutar entradas.
- Mesmo input canônico produz resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.
- Toda inconsistência gera `ContractValidationError`.
- Não adicionar dependência runtime.

## Testes obrigatórios

- estratégia supera buy-and-hold;
- estratégia perde para buy-and-hold;
- empate;
- diferença exata nos dois sentidos;
- rejeição por divergência de agente, intervalo, quantidade de pontos ou capital inicial;
- rejeição de benchmark estruturalmente inconsistente e dinheiro inválido;
- imutabilidade, não mutação e determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Win rate, P&L realizado por trade, ranking multiagente, novas estratégias, execução, wallet, blockchain, testnet, corretora, credenciais, dinheiro real, cloud ou dashboard.

## Critérios de aceite

- comparação correta e auditável;
- validação fail-closed do mesmo experimento;
- somente aritmética monetária inteira existente;
- resultado imutável e determinístico;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: compara estratégia com buy-and-hold`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
