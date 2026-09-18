# Tarefa atual

- **ID:** TASK-004
- **Milestone:** M2 — Risk Manager determinístico, primeira fatia
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `97a16ad4bb7fa10823d33731bebb0add01a2408b`

## Objetivo

Implementar o primeiro gate determinístico de risco pré-trade entre um `OrderIntent` válido e o `PaperBroker`. Nesta tarefa o Risk Manager somente aprova ou rejeita; ele não executa ordens, não altera carteira e não usa IA.

## Leitura obrigatória

Sincronize `main` e leia:

1. `CLAUDE.md`;
2. `docs/PROJECT_CONTEXT.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISIONS.md`;
5. `docs/ROADMAP.md`;
6. `docs/coordination/CHATGPT_REVIEW_TASK_003.md`;
7. `docs/coordination/CHATGPT_REVIEW_AUTOMATION_002.md`;
8. esta tarefa.

## Escopo exato

Crie uma implementação mínima em `src/risk/` e testes correspondentes. Reutilize os contratos fixed-point, ledger e portfolio existentes; não duplique conversões monetárias.

O componente deve receber:

- `OrderIntent` já validado;
- snapshot imutável da carteira do agente;
- política de risco validada;
- contexto determinístico mínimo necessário à avaliação.

E deve devolver um `RiskDecision` imutável e estruturado, sem executar o broker.

## Política mínima configurável

Implemente somente:

- `policyVersion` não vazia;
- allowlist de ativos;
- `maxOrderPositionBps` entre 0 e 10.000;
- `maxAssetExposureBps` entre 0 e 10.000;
- `maxOpenPositions` inteiro não negativo;
- `circuitBreaker` booleano.

Política inválida deve falhar fechado. Não implemente perda diária, drawdown, cooldown, liquidez ou janela de trades nesta tarefa.

## Decisão e códigos estáveis

`RiskDecision` deve registrar ao menos:

- `schemaVersion: 1`;
- ID determinístico;
- `orderId`, `cycleId`, `agentId`;
- `approved`;
- códigos de regra estáveis e ordenados;
- `policyVersion`;
- timestamp recebido pelo chamador, sem leitura do relógio global.

Inclua códigos estáveis equivalentes a:

- `CIRCUIT_BREAKER_ACTIVE`;
- `ASSET_NOT_ALLOWED`;
- `ORDER_SIZE_LIMIT_EXCEEDED`;
- `ASSET_EXPOSURE_LIMIT_EXCEEDED`;
- `MAX_OPEN_POSITIONS_REACHED`;
- `INVALID_RISK_INPUT`.

Nomes podem ser ajustados apenas se permanecerem claros, documentados e testados.

## Regras de avaliação

- O circuit breaker bloqueia qualquer nova ordem.
- Ativo fora da allowlist é bloqueado.
- Ordem acima do tamanho máximo é bloqueada; não redimensionar nesta tarefa.
- BUY que criaria nova posição quando o limite já foi atingido é bloqueado.
- BUY que excederia a exposição máxima do ativo é bloqueado.
- SELL de posição existente não deve ser bloqueado por limite de exposição ou quantidade de posições, pois reduz risco; continua sujeito ao circuit breaker e à allowlist.
- Qualquer dado ausente, incompatível, negativo, não canônico ou impossível de avaliar resulta em rejeição fail-closed.
- Avaliar risco não altera `OrderIntent`, portfolio, ledger ou qualquer estado compartilhado.
- A avaliação de um agente não consulta nem altera carteira de outro agente.
- Mesmo input canônico, política e timestamp produzem decisão/ID idênticos.

Use aritmética inteira/`bigint` e as regras de arredondamento existentes. Nenhum float pode ser fonte de verdade contábil.

## Testes obrigatórios

- política válida e rejeição de cada campo inválido;
- circuit breaker;
- ativo permitido e não permitido;
- limite de tamanho exatamente na fronteira e acima dela;
- exposição exatamente na fronteira e acima dela;
- nova posição com limite livre e limite atingido;
- BUY em posição já existente não conta como nova posição;
- SELL que reduz risco não é bloqueado por exposição/quantidade de posições;
- input inconsistente falha fechado;
- múltiplos motivos de rejeição têm ordem determinística;
- decisão e coleções retornadas são imutáveis;
- nenhuma mutação no portfolio/ledger;
- isolamento entre agentes;
- IDs determinísticos;
- testes offline e determinísticos.

## Fora do escopo

Não implementar:

- chamada Astra/LLM ou prompts;
- coleta de mercado;
- execução automática do broker após aprovação;
- persistência em disco;
- métricas, replay histórico ou benchmarks;
- perda diária, drawdown, cooldown, liquidez ou slippage adicional;
- dashboard, servidor ou cloud;
- testnet, wallet, corretora, exchange, credenciais ou dinheiro real.

Não adicionar dependência runtime sem necessidade comprovada. Não alterar este `TASK.md`.

## Critérios de aceite

- somente a primeira fatia do Risk Manager e documentação diretamente relacionada;
- validação runtime e tipos estritos;
- comportamento fail-closed;
- regras e códigos documentados;
- nenhum estado financeiro é alterado pela avaliação;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real existe.

## Entrega

1. Atualize `README.md` apenas no necessário.
2. Atualize `docs/coordination/CLAUDE_REPORT.md`.
3. Faça um único commit com a mensagem `feat: implementa gate deterministico de risco`.
4. Faça push em branch própria e abra PR para `main`.
5. No PR, inclua resumo, testes e `Closes #4`.
6. Não aprove o próprio trabalho e não altere o status desta tarefa.
