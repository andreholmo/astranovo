# Tarefa atual

- **ID:** TASK-009
- **Milestone:** M3 — métricas determinísticas de execução e custos
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_008.md`

## Objetivo

Criar a próxima fatia mínima de métricas: resumir fills e rejeições do ledger paper de um agente, incluindo fees e impacto de spread/slippage, sem reconstruir carteira nem calcular win rate.

`agentId + LedgerEvent[] → ExecutionCostSummary auditável`

## Leitura obrigatória

Sincronize `main` e leia integralmente:

1. `CLAUDE.md`;
2. `docs/PROJECT_CONTEXT.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISIONS.md`;
5. `docs/ROADMAP.md`;
6. `docs/coordination/CHATGPT_REVIEW_TASK_008.md`;
7. `docs/coordination/CLAUDE_REPORT.md`;
8. `src/ledger/events.ts`;
9. `src/money/fixed-point.ts`;
10. esta tarefa.

## Escopo exato

Crie um módulo pequeno em `src/metrics/`, por exemplo `summarizeExecutionCosts`.

Entradas:

- `agentId` explícito;
- coleção readonly de `LedgerEvent`, possivelmente vazia.

Saída imutável e estruturada, por exemplo `ExecutionCostSummary`, contendo no mínimo:

- `agentId`;
- `eventCount`;
- `fillCount`;
- `rejectionCount`;
- `buyFillCount`;
- `sellFillCount`;
- `totalGrossMicros`;
- `totalFeeMicros`;
- `totalExecutionImpactMicros`;
- contagem por código de rejeição em ordem determinística.

Definição de impacto de execução por fill:

- BUY: `effectivePriceMicros - referencePriceMicros`;
- SELL: `referencePriceMicros - effectivePriceMicros`;
- custo do fill: `floor(quantityAtoms * deltaPriceMicros / 10^assetScale)`;
- total: soma protegida dos custos de todos os fills.

Esse impacto mede spread/slippage incorporados ao preço. Fee permanece separada.

## Regras obrigatórias

- Lista vazia deve ser aceita e produzir todas as contagens/totais iguais a zero.
- Todo evento deve pertencer ao `agentId` solicitado.
- `eventId` não pode se repetir; duplicata deve falhar fechada para impedir dupla contagem.
- A ordem dos eventos de entrada não pode alterar o resultado.
- Contagens de rejeição devem usar somente os códigos estáveis de `REJECTION_CODES` e sair em ordem determinística.
- Fills BUY devem ter `effectivePriceMicros >= referencePriceMicros`.
- Fills SELL devem ter `effectivePriceMicros <= referencePriceMicros`.
- Valores usados no cálculo devem ser bigint não negativos, respeitar limites existentes e ter escala válida.
- Somatórios devem usar helpers fixed-point e falhar fechados em overflow.
- Não representar dinheiro em `number`.
- Não alterar eventos nem a coleção recebida.
- Mesmo input canônico deve produzir resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.

## Testes obrigatórios

- lista vazia;
- um BUY fill;
- um SELL fill;
- múltiplos fills com soma de gross e fees;
- cálculo exato do impacto de BUY;
- cálculo exato do impacto de SELL;
- arredondamento conservador por floor no impacto;
- rejeições não alteram totais monetários;
- contagem por cada código de rejeição usado no fixture;
- eventos em ordens diferentes produzem resultado idêntico;
- agente divergente é rejeitado;
- `eventId` duplicado é rejeitado;
- preço efetivo direcionalmente inválido é rejeitado;
- valor negativo, escala inválida e overflow falham fechados;
- imutabilidade da saída e de coleções próprias;
- ausência de mutação da entrada;
- determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário para explicar:

- quais métricas de execução foram adicionadas;
- que fees e impacto de spread/slippage são reportados separadamente;
- que esta fatia ainda não calcula win rate, P&L realizado por trade ou benchmarks.

Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos, testes, limitações e decisões técnicas.

## Fora do escopo

Não implementar:

- P&L realizado por trade ou pareamento de lotes;
- win rate;
- drawdown percentual;
- benchmarks;
- replay completo;
- persistência JSONL/SQLite/CSV;
- provider de mercado ou rede;
- Astra/LLM, prompts ou agentes;
- novas regras de risco;
- dashboard, servidor ou cloud;
- wallet externa, chave privada, blockchain;
- testnet, corretora, exchange, credenciais ou dinheiro real.

Não adicionar dependência runtime. Não alterar este `TASK.md`.

## Critérios de aceite

- contagens, fees, gross e impacto calculados deterministicamente;
- nenhuma duplicação silenciosa de evento;
- cálculos monetários integralmente em bigint/fixed-point;
- saída imutável e independente da ordem;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real existe.

## Entrega

1. Faça um único commit com a mensagem `feat: resume custos de execucao paper`.
2. Faça push em branch própria e abra PR para `main`.
3. No PR, inclua resumo, testes e `Closes #14`.
4. Não aprove o próprio trabalho e não altere o status desta tarefa.
