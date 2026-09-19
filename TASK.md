# Tarefa atual

- **ID:** TASK-016
- **Milestone:** M3 — drawdown percentual determinístico
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_015.md`

## Objetivo

Calcular de forma determinística e auditável o drawdown percentual máximo de uma série de patrimônio já valorada, preservando a evidência do pico e do fundo.

`EquityPoint[] → DrawdownRateSummary`

Esta tarefa apenas reduz pontos de patrimônio existentes. Não reavalia carteira, não executa ordens e não altera estado.

## Leitura obrigatória

Sincronize `main` e leia integralmente:

1. `CLAUDE.md`;
2. `docs/PROJECT_CONTEXT.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISIONS.md`;
5. `docs/ROADMAP.md`;
6. `docs/coordination/CHATGPT_REVIEW_TASK_015.md`;
7. `docs/coordination/CLAUDE_REPORT.md`;
8. `src/metrics/value-wallet-at.ts`;
9. `src/metrics/summarize-equity-series.ts`;
10. `src/money/fixed-point.ts`;
11. esta tarefa.

## Escopo exato

Crie `src/metrics/summarize-drawdown-rate.ts`.

Implemente `summarizeDrawdownRate`, recebendo uma coleção readonly não vazia de `EquityPoint` já calculados.

A função deve reutilizar `summarizeEquitySeries` para obter o drawdown absoluto e sua evidência. Não duplique o algoritmo de pico/fundo.

O resultado `DrawdownRateSummary` deve ser profundamente imutável e registrar no mínimo:

- `agentId`;
- `startedAt`;
- `endedAt`;
- `pointCount`;
- `maxDrawdownMicros`;
- `maxDrawdownPeakEquityMicros`;
- `maxDrawdownPeakAt`;
- `maxDrawdownTroughAt`;
- `maxDrawdownBps`, inteiro entre 0 e 10_000;
- `rounding: "FLOOR"`.

## Definição matemática

Para drawdown não zero:

`maxDrawdownBps = floor(maxDrawdownMicros * 10_000 / maxDrawdownPeakEquityMicros)`

Use somente `bigint` durante multiplicação e divisão. Converta para `number` apenas o resultado final já provado no intervalo inteiro `[0, 10_000]`.

Para drawdown zero, devolva `maxDrawdownBps = 0`. Se houver drawdown positivo com pico igual a zero, falhe fechado com `ContractValidationError`.

O pico monetário deve corresponder exatamente ao ponto identificado por `maxDrawdownPeakAt`; não use apenas o maior pico global quando o maior drawdown tiver ocorrido a partir de um pico anterior.

## Regras obrigatórias

- Reutilizar `summarizeEquitySeries`, `MAX_MICROS` e os tipos existentes.
- Não usar ponto flutuante para a razão.
- Não reimplementar valoração, P&L ou detecção de drawdown absoluto.
- Não mutar entradas.
- Mesmo input canônico deve produzir resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.
- Inconsistência deve gerar `ContractValidationError`.
- Não alterar `summarizeEquitySeries`, salvo correção mínima indispensável demonstrada por teste.

## Testes obrigatórios

- drawdown zero em série crescente;
- drawdown de 100%;
- drawdown fracionário com arredondamento `FLOOR`;
- maior drawdown usa o pico correto, mesmo quando não é o maior pico global final;
- recuperação após o fundo preserva a evidência do maior drawdown;
- série de um ponto;
- rejeita coleção vazia;
- rejeita agentes misturados, timestamps inválidos/fora de ordem e dinheiro inválido por meio da primitiva existente;
- não muta entradas;
- resultado congelado;
- determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário para explicar que o percentual é expresso em basis points inteiros, com arredondamento para baixo.

Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos, testes, limitações e decisões técnicas.

## Fora do escopo

Não implementar:

- win rate ou P&L realizado por trade;
- estratégia ou comparação entre agentes;
- replay de propostas;
- ordens, fills ou liquidação;
- benchmark aleatório;
- Astra/LLM, prompts ou handoffs;
- novas regras de risco;
- coleta de mercado ou rede;
- persistência, dashboard, servidor ou cloud;
- wallet, blockchain, testnet, corretora, exchange, credenciais ou dinheiro real.

Não adicionar dependência runtime. Não alterar este `TASK.md`.

## Critérios de aceite

- reutiliza a primitiva de resumo existente;
- razão calculada sem ponto flutuante;
- pico/fundo auditáveis e corretos;
- arredondamento explícito e determinístico;
- inconsistências falham fechado;
- nenhuma ordem ou alteração de carteira;
- resultado imutável e determinístico;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real existe.

## Entrega

1. Faça um único commit com a mensagem `feat: calcula drawdown percentual`.
2. Faça push em branch própria; a automação deve abrir o PR para `main`.
3. No PR, inclua resumo, testes e `Closes #28`.
4. Não aprove o próprio trabalho e não altere o status desta tarefa.
