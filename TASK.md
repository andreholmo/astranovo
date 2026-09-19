# Tarefa atual

- **ID:** TASK-008
- **Milestone:** M3 — resumo determinístico de série de patrimônio
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após a revisão registrada em `docs/coordination/CHATGPT_REVIEW_TASK_007.md`

## Objetivo

Criar a próxima fatia mínima de métricas: receber uma série cronológica de `EquityPoint` já calculados pela TASK-007 e produzir um resumo imutável e auditável de P&L e drawdown absoluto.

`EquityPoint[] canônicos → EquitySeriesSummary determinístico`

Esta tarefa não executa replay, não busca preços e não persiste dados.

## Leitura obrigatória

Sincronize `main` e leia integralmente:

1. `CLAUDE.md`;
2. `docs/PROJECT_CONTEXT.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISIONS.md`;
5. `docs/ROADMAP.md`;
6. `docs/coordination/CHATGPT_REVIEW_TASK_007.md`;
7. `docs/coordination/CLAUDE_REPORT.md`;
8. `src/metrics/value-wallet-at.ts`;
9. esta tarefa.

## Escopo exato

Crie um módulo pequeno em `src/metrics/`, por exemplo `summarizeEquitySeries`.

Entrada:

- coleção readonly, não vazia, de `EquityPoint`;
- pontos já ordenados cronologicamente pelo chamador.

Saída imutável e estruturada, por exemplo `EquitySeriesSummary`, contendo no mínimo:

- `agentId`;
- `startedAt` e `endedAt`;
- `pointCount`;
- `startingEquityMicros`;
- `endingEquityMicros`;
- P&L sem dinheiro em `number`: `pnlDirection` (`GAIN | LOSS | FLAT`) e `pnlMagnitudeMicros`;
- `peakEquityMicros`;
- `maxDrawdownMicros`;
- evidência do drawdown máximo: timestamp do pico e timestamp do vale.

Não crie um tipo monetário signed se a representação direção + magnitude for suficiente.

## Regras obrigatórias

- Exigir pelo menos um ponto.
- Todos os pontos devem pertencer ao mesmo `agentId`.
- `valuedAt` deve ser canônico e estritamente crescente.
- Rejeitar timestamps duplicados ou fora de ordem; não ordenar silenciosamente.
- P&L deve ser a diferença exata entre patrimônio final e inicial, representada por direção e magnitude.
- Drawdown em cada ponto é `peak anterior ou atual - equity atual`, nunca negativo.
- `maxDrawdownMicros` deve ser o maior drawdown absoluto observado.
- Em empate de drawdown máximo, manter o primeiro episódio cronológico.
- Série de um único ponto deve produzir P&L `FLAT` e drawdown zero.
- Validar limites monetários e falhar fechado diante de valores inválidos.
- Não alterar os pontos nem suas coleções internas.
- Mesmo input deve produzir resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.
- Reutilizar erros e helpers fixed-point existentes; não usar dinheiro em `number`.

## Testes obrigatórios

- série com um ponto;
- ganho;
- perda;
- resultado flat;
- novo pico seguido de drawdown;
- recuperação parcial;
- recuperação completa;
- múltiplos drawdowns, escolhendo o maior;
- empate mantendo o primeiro episódio;
- rejeição de lista vazia;
- rejeição de agentes misturados;
- rejeição de timestamp duplicado;
- rejeição de timestamps fora de ordem;
- rejeição de timestamp não canônico;
- rejeição de valor monetário inválido ou acima do limite;
- imutabilidade da saída;
- ausência de mutação da entrada;
- determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário para informar que a série de patrimônio agora produz P&L final e drawdown absoluto, ainda sem replay completo, win rate ou benchmarks.

Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos, testes, limitações e decisões técnicas.

## Fora do escopo

Não implementar:

- drawdown percentual;
- win rate, fees agregadas ou benchmarks;
- replay de ciclos;
- seleção ou busca de snapshots;
- provider de mercado ou rede;
- persistência JSONL/SQLite/CSV;
- Astra/LLM, prompts ou agentes;
- novas regras de risco;
- dashboard, servidor ou cloud;
- wallet externa, chave privada, blockchain;
- testnet, corretora, exchange, credenciais ou dinheiro real.

Não adicionar dependência runtime. Não alterar este `TASK.md`.

## Critérios de aceite

- P&L e drawdown calculados integralmente com `bigint`/fixed-point;
- ordem temporal e isolamento por agente validados fail-closed;
- saída imutável, auditável e determinística;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real existe.

## Entrega

1. Faça um único commit com a mensagem `feat: resume serie de patrimonio`.
2. Faça push em branch própria e abra PR para `main`.
3. No PR, inclua resumo, testes e `Closes #12`.
4. Não aprove o próprio trabalho e não altere o status desta tarefa.
