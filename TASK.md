# Tarefa atual

- **ID:** TASK-014
- **Milestone:** M3 — benchmark buy-and-hold com custos paper
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_013.md`

## Objetivo

Criar o primeiro benchmark buy-and-hold determinístico e auditável, usando a série anti-look-ahead e o `PaperBroker` existente para modelar o custo realista da compra inicial.

`snapshots + decisionTimes + capital + policy → BuyAndHoldBenchmark`

O benchmark compra uma única vez no primeiro instante, mantém a posição e marca a carteira a mercado em todos os instantes. Não vende no final nesta tarefa.

## Leitura obrigatória

Sincronize `main` e leia integralmente:

1. `CLAUDE.md`;
2. `docs/PROJECT_CONTEXT.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISIONS.md`;
5. `docs/ROADMAP.md`;
6. `docs/coordination/CHATGPT_REVIEW_TASK_013.md`;
7. `docs/coordination/CLAUDE_REPORT.md`;
8. `src/replay/build-replay-snapshot-series.ts`;
9. `src/benchmark/build-cash-benchmark.ts`;
10. `src/broker/paper-broker.ts`;
11. `src/domain/contracts.ts`;
12. `src/portfolio/portfolio.ts`;
13. `src/metrics/value-wallet-at.ts`;
14. `src/metrics/summarize-equity-series.ts`;
15. esta tarefa.

## Escopo exato

Crie `src/benchmark/build-buy-and-hold-benchmark.ts`.

A função deve receber explicitamente:

- `agentId`;
- `initialCashMicros`;
- coleção readonly de snapshots não confiáveis;
- `asset`;
- `quote`;
- `assetScale`;
- coleção readonly de `decisionTimes`;
- `ExecutionPolicy`.

A função deve:

1. construir a série por `buildReplaySnapshotSeries`;
2. exigir `quote === "USD"`;
3. criar uma carteira cash-only por `createWallet`;
4. criar e validar um `OrderIntent` BUY de 100% no primeiro ponto, convertendo o preço por `microsFromUsdNumber`;
5. executar exatamente uma compra pelo `PaperBroker`, em `occurredAt === firstPoint.decisionAt`;
6. falhar fechado se a compra não produzir `FILL`;
7. aplicar o fill à carteira usando a primitiva contábil existente;
8. valorar essa carteira em todos os pontos da série por `valueWalletAt`;
9. resumir por `summarizeEquitySeries`;
10. devolver um `BuyAndHoldBenchmark` profundamente imutável.

## Saída mínima

O resultado deve registrar:

- `kind: "BUY_AND_HOLD"`;
- `agentId`;
- `asset`;
- `quote`;
- `initialCashMicros`;
- política efetivamente usada;
- fill da compra inicial;
- carteira após a compra;
- série de pontos de replay usada;
- pontos de patrimônio;
- resumo de patrimônio.

Não implementar venda/liquidação final. Documente claramente que o patrimônio final é marcação a mercado e que custos de saída ainda não estão incluídos.

## Regras obrigatórias

- Reutilizar todas as primitivas citadas; não duplicar fórmulas de preço, fee, spread, slippage, wallet, valoração ou resumo.
- Validar `ExecutionPolicy` com o parser existente.
- Usar somente o snapshot do primeiro `decisionAt` para a compra inicial.
- Nunca executar mais de uma ordem.
- O fill deve refletir fee, spread e slippage da política.
- Nenhum Risk Manager ou agente participa deste benchmark de controle.
- Nenhum snapshot futuro pode influenciar compra ou valoração.
- Rejeições devem falhar fechado; não converter rejeição em benchmark cash.
- Não mutar entradas.
- Mesmo input canônico deve produzir resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.

## Testes obrigatórios

- compra uma vez no primeiro instante e mantém a posição;
- fill incorpora fee, spread e slippage;
- patrimônio inicial após a compra reflete custos;
- preço crescente aumenta o patrimônio;
- preço decrescente reduz o patrimônio;
- snapshot novo só afeta pontos após ficar disponível;
- aceita `availableAt === decisionAt`;
- rejeita quote diferente de USD;
- rejeita série sem snapshot elegível;
- rejeita política inválida;
- rejeita capital insuficiente/quantidade pequena quando o broker rejeitar;
- não executa venda final;
- exatamente um fill e nenhuma outra ordem;
- não muta snapshots, decisionTimes ou policy;
- resultado, coleções e objetos próprios congelados;
- determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário para explicar o benchmark e a ausência de liquidação final.

Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos, testes, limitações e decisões técnicas.

## Fora do escopo

Não implementar:

- comparação genérica entre benchmark e estratégia;
- venda ou custo de saída;
- estratégia aleatória;
- replay de decisões de agentes;
- Astra/LLM, prompts ou handoffs;
- novas regras de risco;
- coleta de mercado ou rede;
- persistência;
- dashboard, servidor ou cloud;
- wallet externa, chave privada, blockchain;
- testnet, corretora, exchange, credenciais ou dinheiro real.

Não adicionar dependência runtime. Não alterar este `TASK.md`.

## Critérios de aceite

- benchmark realiza uma única compra paper no primeiro instante;
- custos de entrada usam o `PaperBroker` existente;
- todos os pontos respeitam anti-look-ahead;
- carteira e patrimônio são derivados por primitivas existentes;
- comportamento fail-closed;
- resultado imutável e determinístico;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real existe.

## Entrega

1. Faça um único commit com a mensagem `feat: adiciona benchmark buy and hold`.
2. Faça push em branch própria e abra PR para `main`.
3. No PR, inclua resumo, testes e `Closes #24`.
4. Não aprove o próprio trabalho e não altere o status desta tarefa.
