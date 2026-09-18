# Tarefa atual

- **ID:** TASK-006
- **Milestone:** M2 — liquidação contábil determinística do paper trade
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `bf3349ffb99f49f1b5d8efe9464fbd27afc18e97`

## Objetivo

Completar a menor fatia contábil do pipeline paper:

`executePaperOrderWithRisk → evento do PaperBroker → append idempotente no ledger → carteira derivada`

A nova função deve receber o resultado já produzido por `executePaperOrderWithRisk`, a carteira imutável do mesmo agente e seu `AgentLedger`. Ela não executa risco nem broker novamente.

## Leitura obrigatória

Sincronize `main` e leia integralmente:

1. `CLAUDE.md`;
2. `docs/PROJECT_CONTEXT.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISIONS.md`;
5. `docs/ROADMAP.md`;
6. `docs/coordination/CHATGPT_REVIEW_TASK_005.md`;
7. `docs/coordination/CLAUDE_REPORT.md`;
8. esta tarefa.

## Escopo exato

Crie uma função pura pequena em `src/execution/`, por exemplo `settlePaperExecution`, com request/result explícitos.

Entradas:

- `ExecutePaperOrderWithRiskResult`;
- `Wallet` imutável;
- `AgentLedger` imutável.

Resultado: união discriminada, imutável e suficiente para auditoria:

1. **`RISK_REJECTED`** — devolve a mesma carteira e o mesmo ledger por referência; nenhum evento é criado ou anexado;
2. **`BROKER_RECORDED`** — contém o resultado de execução original, o evento canônico armazenado, o novo ledger, a carteira resultante e `appended: boolean`.

Reutilize, sem duplicar regras:

- `AgentLedger.append`;
- `applyAppendResult`;
- `ExecutePaperOrderWithRiskResult`;
- `ExecutionOutcome`, `LedgerEvent` e `Wallet`.

## Regras obrigatórias

- Nunca chamar `evaluateRisk`, `Broker.execute` ou `PaperBroker.execute`.
- Em `RISK_REJECTED`, não inventar evento de ledger e não alterar estado.
- Em `BROKER_EXECUTED`, registrar exatamente `executionOutcome.event`.
- Um evento novo deve ser anexado uma vez e aplicado à carteira uma vez.
- Replay idêntico do mesmo `orderId` deve retornar `appended: false`, manter a carteira recebida por referência e não duplicar evento nem efeito contábil.
- Mesmo `orderId` com conteúdo diferente deve preservar o fail-closed existente e lançar `LedgerConflictError`.
- Rejeição produzida pelo PaperBroker deve entrar no ledger, mas manter a carteira inalterada por referência.
- Validar estruturalmente que wallet e ledger pertencem ao mesmo agente antes de qualquer append.
- O evento também deve pertencer ao mesmo agente; preserve o fail-closed existente para divergência.
- Não reconstruir, clonar, corrigir ou reinterpretar eventos.
- Não mutar resultado, carteira, ledger, evento ou coleções.
- Mesmo input deve produzir resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.
- Não adicionar persistência em arquivo nesta tarefa.

## Testes obrigatórios

- `RISK_REJECTED`: zero eventos, mesmas referências de wallet e ledger;
- BUY preenchida: evento anexado e caixa/posição atualizados uma vez;
- SELL preenchida: evento anexado e caixa/posição atualizados uma vez;
- rejeição do PaperBroker: evento anexado e wallet preservada por referência;
- replay idêntico: `appended: false`, nenhum segundo evento, nenhum segundo efeito na wallet;
- conflito do mesmo `orderId`: `LedgerConflictError`;
- wallet e ledger de agentes diferentes: falha fechada antes de append;
- evento de outro agente: falha fechada;
- isolamento: liquidar agente A não altera ledger/carteira do agente B;
- objetos de resultado e coleções próprias imutáveis;
- entradas não sofrem mutação;
- determinismo;
- testes offline e determinísticos.

Use o `PaperBroker` real para formar outcomes principais. Test doubles somente quando estritamente necessários e apenas nos testes.

## Documentação

Atualize o README apenas no necessário para explicar:

- somente eventos do PaperBroker são registrados por esta função;
- o ledger append-only é a fonte de verdade;
- a carteira é derivada;
- replay idêntico não duplica fill nem efeito;
- rejeição de risco não cria evento contábil;
- rejeição do PaperBroker é auditada no ledger, sem alterar saldo/posição.

Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos, testes, limitações e decisões técnicas.

## Fora do escopo

Não implementar:

- Astra/LLM, prompts, agentes ou coordenação multiagente;
- dados de mercado ou rede;
- métricas, replay histórico completo ou benchmarks;
- persistência JSONL/SQLite/CSV;
- novas regras de risco;
- retry ou fila;
- dashboard, servidor ou cloud;
- wallet externa, chave privada, blockchain;
- testnet, corretora, exchange, credenciais ou dinheiro real;
- qualquer broker além do PaperBroker existente.

Não adicionar dependência runtime. Não alterar este `TASK.md`.

## Critérios de aceite

- caminho contábil PaperBroker → ledger → wallet comprovado;
- idempotência impede duplicação de fill e de efeito na carteira;
- ledger continua como fonte de verdade append-only;
- rejeição de risco não vira evento contábil;
- isolamento por agente e fail-closed preservados;
- nenhuma regra de risco ou broker duplicada;
- tipos estritos e comportamento determinístico;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real existe.

## Entrega

1. Faça um único commit com a mensagem `feat: liquida execucao paper no ledger`.
2. Faça push em branch própria e abra PR para `main`.
3. No PR, inclua resumo, testes e `Closes #8`.
4. Não aprove o próprio trabalho e não altere o status desta tarefa.
