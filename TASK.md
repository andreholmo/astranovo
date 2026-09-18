# Tarefa atual

- **ID:** TASK-007
- **Milestone:** M3 — valoração determinística sem look-ahead
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `d9c84f74a67cd1bbe870cc817be2b01c5c98ad5c`

## Objetivo

Criar a menor base de métricas do replay: calcular um ponto imutável de patrimônio de uma carteira paper usando somente snapshots completos, em USD, que já estavam disponíveis no instante avaliado.

`Wallet + MarketSnapshot(s) disponíveis → EquityPoint auditável`

Esta tarefa calcula apenas a valoração de um instante. Não calcula série temporal, P&L, drawdown, win rate ou benchmark.

## Leitura obrigatória

Sincronize `main` e leia integralmente:

1. `CLAUDE.md`;
2. `docs/PROJECT_CONTEXT.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISIONS.md`;
5. `docs/ROADMAP.md`;
6. `docs/coordination/CHATGPT_REVIEW_TASK_006.md`;
7. `docs/coordination/CLAUDE_REPORT.md`;
8. esta tarefa.

## Escopo exato

Crie um módulo pequeno em `src/metrics/`, por exemplo `valueWalletAt`.

Entradas:

- uma `Wallet` imutável;
- `valuedAt` canônico injetado pelo chamador;
- snapshots de mercado usados para valorar as posições.

Saída imutável e estruturada, por exemplo `EquityPoint`, contendo no mínimo:

- `agentId`;
- `valuedAt`;
- `cashMicros`;
- valor de cada posição em micros, com `asset`, quantidade/escala, `priceMicros`, `snapshotId` e `snapshotAvailableAt`;
- `positionsValueMicros`;
- `equityMicros`;
- IDs dos snapshots efetivamente usados, em ordem determinística.

Reutilize:

- `parseMarketSnapshot(snapshot, { notAfter: valuedAt })` para provar disponibilidade;
- `microsFromUsdNumber` para converter preço;
- `scaleFactor`, `mulDivFloor` e `addBounded`;
- `MAX_MICROS`;
- os contratos `Wallet`, `Position` e `MarketSnapshot`.

Não use aritmética de dinheiro em `number`.

## Regras obrigatórias

- Aceitar somente snapshot `complete === true`.
- Aceitar somente `quote === "USD"`.
- Cada posição deve ter exatamente um snapshot do mesmo `asset`.
- Falhar fechado se faltar preço de uma posição.
- Falhar fechado diante de snapshots duplicados para o mesmo ativo; não escolher silenciosamente um deles.
- Snapshots de ativos que a carteira não possui devem ser rejeitados, não ignorados.
- `availableAt` deve ser menor ou igual a `valuedAt`; qualquer dado futuro deve ser rejeitado.
- `valuedAt` e timestamps precisam permanecer canônicos.
- Converter `snapshot.price` para micros pelo helper existente; precisão incompatível deve falhar fechada, nunca arredondar silenciosamente.
- Valor de posição: `floor(quantityAtoms * priceMicros / 10^assetScale)`.
- Somar valores com limites protegidos; overflow deve falhar fechado.
- Carteira somente em caixa deve aceitar lista vazia e ter `equityMicros === cashMicros`.
- A ordem da entrada não pode alterar o resultado: posições e IDs na saída devem ser ordenados por ativo.
- Não alterar wallet, posições ou snapshots.
- Mesmo input canônico deve produzir resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.

## Testes obrigatórios

- carteira somente em caixa;
- uma posição corretamente valorada;
- múltiplas posições e soma correta;
- arredondamento conservador por floor;
- snapshots fornecidos em ordens diferentes produzem resultado idêntico;
- snapshot disponível exatamente em `valuedAt` é aceito;
- snapshot disponível depois de `valuedAt` é rejeitado;
- snapshot incompleto é rejeitado;
- quote diferente de USD é rejeitada;
- snapshot ausente para posição é rejeitado;
- snapshot duplicado para o mesmo ativo é rejeitado;
- snapshot de ativo não possuído é rejeitado;
- preço com precisão não representável em micros falha fechado;
- overflow falha fechado;
- objetos e coleções próprias retornados são imutáveis;
- entradas não sofrem mutação;
- isolamento entre agentes;
- determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário para explicar que:

- patrimônio é caixa mais posições marcadas a mercado;
- a valoração usa somente snapshots completos disponíveis até `valuedAt`;
- dados futuros, ausentes, duplicados ou incompatíveis falham fechados;
- esta fatia ainda não calcula P&L, drawdown, win rate ou benchmarks.

Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos, testes, limitações e decisões técnicas.

## Fora do escopo

Não implementar:

- série temporal, P&L, drawdown, win rate ou benchmarks;
- replay de ciclos completo;
- seleção automática do snapshot mais recente;
- provider de mercado ou rede;
- persistência JSONL/SQLite/CSV;
- Astra/LLM, prompts ou agentes;
- novas regras de risco;
- dashboard, servidor ou cloud;
- wallet externa, chave privada, blockchain;
- testnet, corretora, exchange, credenciais ou dinheiro real.

Não adicionar dependência runtime. Não alterar este `TASK.md`.

## Critérios de aceite

- patrimônio calculado integralmente em fixed-point;
- evidência de preço auditável na saída;
- anti-look-ahead comprovado por testes;
- ausência/ambiguidade de preço falha fechada;
- tipos estritos, imutabilidade e determinismo;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real existe.

## Entrega

1. Faça um único commit com a mensagem `feat: calcula patrimonio sem look-ahead`.
2. Faça push em branch própria e abra PR para `main`.
3. No PR, inclua resumo, testes e `Closes #10`.
4. Não aprove o próprio trabalho e não altere o status desta tarefa.
