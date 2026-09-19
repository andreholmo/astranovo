# Tarefa atual

- **ID:** TASK-010
- **Milestone:** M3 — benchmark cash determinístico
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_009.md`

## Objetivo

Criar o primeiro benchmark experimental: uma carteira que permanece integralmente em caixa durante os mesmos instantes de avaliação de uma estratégia.

`agentId + capital inicial + valuedAt[] → CashBenchmark auditável`

O benchmark cash serve como controle: seu patrimônio deve permanecer constante, com P&L flat, drawdown zero, nenhuma posição, snapshot ou custo.

## Leitura obrigatória

Sincronize `main` e leia integralmente:

1. `CLAUDE.md`;
2. `docs/PROJECT_CONTEXT.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISIONS.md`;
5. `docs/ROADMAP.md`;
6. `docs/coordination/CHATGPT_REVIEW_TASK_009.md`;
7. `docs/coordination/CLAUDE_REPORT.md`;
8. `src/portfolio/portfolio.ts`;
9. `src/metrics/value-wallet-at.ts`;
10. `src/metrics/summarize-equity-series.ts`;
11. esta tarefa.

## Escopo exato

Crie um módulo pequeno em `src/benchmark/`, por exemplo `buildCashBenchmark`.

Entradas:

- `agentId`;
- `initialCashMicros`;
- coleção readonly, não vazia, de timestamps `valuedAt`.

Saída imutável e estruturada, por exemplo `CashBenchmark`, contendo no mínimo:

- identificador estável `kind: "CASH"`;
- `agentId`;
- `initialCashMicros`;
- série readonly de `EquityPoint`, alinhada aos timestamps recebidos;
- `EquitySeriesSummary` calculado pela função existente.

Reutilize obrigatoriamente:

- `createWallet`;
- `valueWalletAt` com lista vazia de snapshots;
- `summarizeEquitySeries`.

Não replique validação de timestamp, cálculo de patrimônio, P&L ou drawdown.

## Regras obrigatórias

- Exigir pelo menos um timestamp.
- Timestamps devem ser canônicos e estritamente crescentes; duplicata ou ordem inválida deve falhar fechada pelas validações existentes.
- Capital inicial deve respeitar os contratos monetários existentes.
- Cada ponto deve ter caixa e patrimônio exatamente iguais ao capital inicial.
- Todos os pontos devem ter posições e IDs de snapshot vazios.
- O resumo deve ser sempre `FLAT`, com magnitude de P&L zero e drawdown zero.
- Nenhum `LedgerEvent`, fill, fee ou impacto de execução.
- Não alterar a coleção de timestamps.
- Objetos e coleções próprias retornados devem ser imutáveis.
- Mesmo input canônico deve produzir resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.

## Testes obrigatórios

- um único instante;
- vários instantes;
- capital fictício de US$100;
- caixa e patrimônio constantes em todos os pontos;
- posições e snapshots sempre vazios;
- resumo flat e drawdown zero;
- timestamps preservados e alinhados;
- timestamp duplicado rejeitado;
- timestamps fora de ordem rejeitados;
- timestamp não canônico rejeitado;
- lista vazia rejeitada;
- capital negativo, tipo inválido e acima do limite rejeitados;
- isolamento entre agentes;
- imutabilidade profunda das estruturas próprias;
- ausência de mutação da entrada;
- determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário para explicar:

- o benchmark cash como controle sem operações;
- que ele reutiliza a mesma valoração e o mesmo resumo usados pelas estratégias;
- que buy-and-hold e outros benchmarks ainda não existem.

Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos, testes, limitações e decisões técnicas.

## Fora do escopo

Não implementar:

- buy-and-hold ou estratégia aleatória;
- comparação/ranking entre agentes;
- P&L realizado por trade ou win rate;
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

- benchmark cash constante, auditável e alinhado aos timestamps;
- reutilização das primitivas existentes, sem duplicar fórmulas;
- validações fail-closed, imutabilidade e determinismo;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real existe.

## Entrega

1. Faça um único commit com a mensagem `feat: adiciona benchmark cash`.
2. Faça push em branch própria e abra PR para `main`.
3. No PR, inclua resumo, testes e `Closes #16`.
4. Não aprove o próprio trabalho e não altere o status desta tarefa.
