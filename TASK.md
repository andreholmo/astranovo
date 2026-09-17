# Tarefa atual

- **ID:** TASK-003
- **Milestone:** M1 — Carteira, ledger e PaperBroker
- **Status:** APPROVED — AUTOMATION_SETUP_REQUIRED
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Commit entregue:** `ddcd7684c08689502fd70e29070d1e93d1ec6a3e`
- **Revisão:** `docs/coordination/CHATGPT_REVIEW_TASK_003.md`

## Objetivo

Implementar o núcleo contábil determinístico do paper trading para N agentes: carteiras isoladas, ordens internas, fills simulados com custos e ledger append-only em memória. Ainda não conectar Astra, mercado ao vivo, Risk Manager completo ou persistência em disco.

## Leitura obrigatória

Sincronize `main` e leia `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_002.md` e esta tarefa.

## Decisões técnicas desta milestone

- Não usar ponto flutuante como fonte contábil.
- Valores monetários internos: inteiros `bigint` em micros de USD (US$0,000001).
- Quantidades de ativo: inteiros `bigint` em unidades atômicas, com escala configurada por ativo; fixture inicial usa 8 casas.
- Fronteiras JSON representam `bigint` como strings decimais canônicas.
- Arredondamento financeiro: para baixo quando calcula quantidade comprável; fees e custos arredondados para cima, favorecendo uma simulação conservadora.
- Sem short selling.
- Apenas fills totais ou rejeição nesta milestone.
- Ledger imutável em memória é a fonte de verdade; snapshots de carteira são derivados por replay.
- Cada agente inicia com sua própria verba configurada; nenhuma transferência entre carteiras.

Documente e centralize conversões/rounding. Não espalhe fórmulas pelos módulos.

## Escopo exato

Crie módulos mínimos em:

- `src/money/`: tipos fixed-point, conversões seguras e operações;
- `src/portfolio/`: estado derivado e replay do ledger;
- `src/ledger/`: eventos imutáveis e idempotência;
- `src/broker/`: interface `Broker` e implementação `PaperBroker`.

Atualize os contratos existentes somente quando necessário para integrar esses módulos.

## Contratos mínimos

### OrderIntent

Deve conter:

- `schemaVersion: 1`;
- `orderId`, `cycleId`, `agentId`;
- `side: BUY | SELL`;
- `asset`, `quote`;
- `positionPct` como fração validada;
- `referencePriceMicros`;
- `assetScale`;
- `createdAt`.

Uma proposta HOLD não vira OrderIntent.

### ExecutionPolicy

- `feeBps`;
- `spreadBps`;
- `slippageBps`;
- limites finitos, inteiros, não negativos e configuráveis.

### FillEvent / RejectionEvent

Fill precisa registrar ao menos orderId, agentId, side, quantidade atômica, preço de referência, preço final, fee, slippage/spread aplicados, total em micros, timestamp e policyVersion.

Rejeição precisa registrar código estável e não alterar carteira.

## Comportamento do PaperBroker

### BUY

- usar `positionPct` sobre o caixa disponível;
- incorporar spread, slippage e fee;
- nunca produzir caixa negativo;
- reduzir deterministicamente a quantidade para o máximo pagável;
- rejeitar quando a quantidade resultante for zero.

### SELL

- usar `positionPct` sobre a posição atual;
- nunca vender mais que a posição;
- rejeitar ativo inexistente ou quantidade zero;
- aplicar custos de maneira conservadora;
- nunca gerar caixa negativo.

### HOLD

- não chega ao broker;
- nenhuma ordem ou fill é criado.

## Ledger e idempotência

- eventos possuem `eventId` determinístico;
- reprocessar o mesmo `orderId` com conteúdo idêntico devolve o mesmo resultado sem novo evento;
- mesmo `orderId` com conteúdo diferente é rejeitado como conflito;
- replay dos mesmos eventos produz exatamente o mesmo portfolio;
- arrays e objetos retornados devem ser imutáveis;
- ledger de um agente não altera outro agente.

Não implementar arquivo JSONL ainda; o adaptador persistente virá em tarefa separada.

## Inicialização

Crie uma função que receba `AgentsConfig` validado e produza as carteiras iniciais dos agentes habilitados usando `initialBudgetUsd`. Os seis agentes padrão devem resultar em seis carteiras independentes de US$100 cada.

## Testes obrigatórios

- conversões fixed-point válidas e rejeição de overflow/formato inválido;
- arredondamento documentado nas fronteiras;
- seis carteiras isoladas com US$100;
- configuração com sétimo agente funciona;
- BUY normal com fee/spread/slippage;
- BUY de 100% nunca deixa caixa negativo;
- BUY pequeno demais é rejeitado;
- SELL parcial e total;
- SELL sem posição e oversell são rejeitados;
- custos reduzem o resultado versus execução sem custos;
- mesmo orderId idêntico não duplica fill;
- mesmo orderId divergente gera conflito;
- replay reconstrói exatamente caixa e posições;
- falha/rejeição não modifica portfolio;
- operação de um agente não modifica os demais;
- nenhum NaN/Infinity, número negativo ou bigint não canônico atravessa contratos;
- testes offline e determinísticos.

Use fixtures pequenas cujos resultados possam ser conferidos manualmente.

## Restrições

Não implementar:

- chamada Astra/LLM;
- coleta de mercado;
- prompts/agentes reais;
- coordenador multiagente;
- Risk Manager completo;
- métricas de performance;
- JSONL/SQLite;
- servidor/dashboard;
- testnet, wallet, exchange ou dinheiro real.

Não alterar `TASK.md`. Não adicionar dependência runtime sem necessidade comprovada.

## Critérios de aceite

- `npm ci`, typecheck, build e testes passam;
- CI continua verde em Node 20 e 22;
- contabilidade usa fixed-point/`bigint`, sem floats como fonte de verdade;
- invariantes de caixa e posição são testadas;
- ledger é idempotente e replayável;
- carteiras são isoladas e extensíveis para N agentes;
- nenhuma rota financeira real existe;
- documentação explica fórmulas e arredondamentos.

## Entrega

1. Atualize README e `docs/coordination/CLAUDE_REPORT.md`.
2. Faça um único commit com `feat: implementa carteira e paper broker deterministico`.
3. Push para `origin main`.
4. Não altere o status da tarefa nem aprove o próprio trabalho.

## Bloqueio antes da próxima tarefa

Não publicar nem executar TASK-004 manualmente. O próximo passo é instalar e validar o Claude Code GitHub App/Action e o fluxo por Pull Request. O desenvolvimento do trader só continua depois que o ciclo autônomo estiver operacional.
