# Tarefa atual

- **ID:** TASK-011
- **Milestone:** M3 — comparação determinística com benchmark
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_010.md`

## Objetivo

Criar uma comparação determinística e auditável entre o resumo de patrimônio de uma estratégia e o benchmark cash do mesmo experimento.

`EquitySeriesSummary da estratégia + CashBenchmark → BenchmarkComparison`

Esta tarefa apenas mede se a estratégia terminou acima, abaixo ou empatada com o controle cash. Não executa trades e não cria ranking entre agentes.

## Leitura obrigatória

Sincronize `main` e leia integralmente:

1. `CLAUDE.md`;
2. `docs/PROJECT_CONTEXT.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISIONS.md`;
5. `docs/ROADMAP.md`;
6. `docs/coordination/CHATGPT_REVIEW_TASK_010.md`;
7. `docs/coordination/CLAUDE_REPORT.md`;
8. `src/benchmark/build-cash-benchmark.ts`;
9. `src/metrics/summarize-equity-series.ts`;
10. `src/money/fixed-point.ts`;
11. esta tarefa.

## Escopo exato

Crie um módulo pequeno em `src/benchmark/`, por exemplo `compareToCashBenchmark`.

Entradas:

- `strategySummary: EquitySeriesSummary`;
- `cashBenchmark: CashBenchmark`.

Saída imutável e estruturada, `BenchmarkComparison`, contendo no mínimo:

- `benchmarkKind: "CASH"`;
- `agentId`;
- `startedAt` e `endedAt`;
- `pointCount`;
- `strategyEndingEquityMicros`;
- `benchmarkEndingEquityMicros`;
- resultado estável `OUTPERFORMED | UNDERPERFORMED | TIED`;
- diferença em magnitude não negativa, `differenceMagnitudeMicros`.

## Regras obrigatórias

- Reutilizar os tipos existentes; não redefinir `CashBenchmark` ou `EquitySeriesSummary`.
- Comparar somente resumos compatíveis com o benchmark recebido.
- Exigir mesmo `agentId`, `startedAt`, `endedAt`, `pointCount` e patrimônio inicial.
- Qualquer incompatibilidade deve falhar fechada com erro de contrato existente.
- A direção deve vir apenas da comparação dos patrimônios finais.
- A magnitude deve ser a diferença absoluta exata, usando aritmética `bigint` e os limites monetários existentes.
- Não usar números de ponto flutuante.
- Não alterar os objetos recebidos.
- Retorno deve ser imutável.
- Mesmo input canônico deve produzir resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.

## Testes obrigatórios

- estratégia supera cash;
- estratégia perde para cash;
- empate;
- diferença exata em micros;
- capital fictício de US$100;
- rejeição por agente diferente;
- rejeição por início diferente;
- rejeição por término diferente;
- rejeição por quantidade de pontos diferente;
- rejeição por patrimônio inicial diferente;
- rejeição de valores monetários inválidos ou forjados;
- imutabilidade do retorno;
- ausência de mutação das entradas;
- determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário para explicar a comparação com o controle cash.

Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos, testes, limitações e decisões técnicas.

## Fora do escopo

Não implementar:

- buy-and-hold ou estratégia aleatória;
- ranking entre agentes;
- win rate ou P&L realizado por trade;
- replay completo;
- persistência;
- provider de mercado ou rede;
- Astra/LLM, prompts ou agentes;
- novas regras de risco;
- dashboard, servidor ou cloud;
- wallet externa, chave privada, blockchain;
- testnet, corretora, exchange, credenciais ou dinheiro real.

Não adicionar dependência runtime. Não alterar este `TASK.md`.

## Critérios de aceite

- comparação correta, fail-closed, imutável e determinística;
- compatibilidade temporal e contábil validada;
- aritmética fixa em `bigint`, sem duplicar contratos existentes;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real existe.

## Entrega

1. Faça um único commit com a mensagem `feat: compara estrategia ao benchmark cash`.
2. Faça push em branch própria e abra PR para `main`.
3. No PR, inclua resumo, testes e `Closes #18`.
4. Não aprove o próprio trabalho e não altere o status desta tarefa.
