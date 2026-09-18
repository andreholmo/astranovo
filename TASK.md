# Tarefa atual

- **ID:** TASK-005
- **Milestone:** M2 — integração determinística Risk Manager → PaperBroker
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `36cc95fb6b5469dd14bccf861b72b0705dfb48ad`

## Objetivo

Criar uma fachada mínima e determinística de execução paper que torne explícita a sequência obrigatória:

`OrderIntent validado → evaluateRisk → bloqueio OU PaperBroker.execute`

Uma ordem rejeitada pelo Risk Manager jamais pode chegar ao broker. Uma ordem aprovada pode chegar somente ao broker paper. Esta tarefa não aplica eventos ao ledger e não altera carteira.

## Leitura obrigatória

Sincronize `main` e leia integralmente:

1. `CLAUDE.md`;
2. `docs/PROJECT_CONTEXT.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISIONS.md`;
5. `docs/ROADMAP.md`;
6. `docs/coordination/CHATGPT_REVIEW_TASK_004.md`;
7. `docs/coordination/CLAUDE_REPORT.md`;
8. esta tarefa.

## Escopo exato

Crie uma implementação pequena em `src/execution/` e testes correspondentes. Reutilize, sem duplicar regras:

- `evaluateRisk` e `RiskDecision`;
- `RiskPolicy`;
- `PaperBroker`/`Broker` e `ExecutionOutcome`;
- `ExecutionPolicy`, `OrderIntent` e `Wallet`.

A fachada deve receber apenas dependências e dados já validados:

- `OrderIntent`;
- snapshot imutável da carteira simulada do mesmo agente;
- `RiskPolicy`;
- `ExecutionPolicy`;
- timestamps canônicos injetados pelo chamador;
- broker com `kind === "paper"`.

Ela deve devolver uma união discriminada, imutável e estruturada:

1. **`RISK_REJECTED`** — contém a `RiskDecision` rejeitada e não contém evento de broker;
2. **`BROKER_EXECUTED`** — contém a `RiskDecision` aprovada e o `ExecutionOutcome` retornado pelo PaperBroker.

Não invente evento de ledger para rejeição de risco nesta tarefa. O `RiskDecision` já é o registro estruturado da rejeição.

## Regras obrigatórias

- Avaliar o risco exatamente uma vez por chamada.
- Se `riskDecision.approved === false`, não chamar o broker em hipótese alguma.
- Se aprovado, chamar o broker exatamente uma vez com o mesmo intent, wallet, política de execução e timestamp recebido.
- Rejeitar fail-closed um broker cujo `kind` não seja exatamente `"paper"`; não chamar esse broker.
- A fachada não redimensiona, corrige ou reinterpreta a ordem.
- A fachada não captura e transforma silenciosamente exceções inesperadas do Risk Manager ou do PaperBroker.
- Não alterar `OrderIntent`, wallet, policies, ledger ou estado compartilhado.
- Não anexar/aplicar eventos ao ledger ou portfolio.
- Mesmo input canônico e timestamps iguais devem produzir resultado idêntico.
- A avaliação de um agente não pode consultar carteira de outro agente.
- Nenhum relógio global, aleatoriedade, rede ou I/O.

## Design mínimo

Prefira uma função pura pequena, por exemplo `executePaperOrderWithRisk`, com tipos explícitos para request/result. O nome final pode mudar se permanecer claro.

A dependência de broker pode usar a interface `Broker` para permitir um spy/fake em testes, mas a implementação deve validar `broker.kind === "paper"` antes de qualquer avaliação/execução. Não crie `TestnetBroker`, `LiveBroker` ou outro adaptador.

Não mova regras de risco para a fachada e não mova regras de execução para o Risk Manager.

## Testes obrigatórios

- circuit breaker produz `RISK_REJECTED` e o broker é chamado zero vezes;
- ativo fora da allowlist produz `RISK_REJECTED` e o broker é chamado zero vezes;
- input de risco inválido produz `RISK_REJECTED` e o broker é chamado zero vezes;
- decisão aprovada chama o broker exatamente uma vez;
- BUY aprovada preserva o `ExecutionOutcome` do PaperBroker;
- SELL aprovada preserva o `ExecutionOutcome` do PaperBroker;
- rejeição produzida pelo próprio PaperBroker é preservada como `BROKER_EXECUTED` com outcome `REJECTED`;
- broker com `kind !== "paper"` falha fechado antes de ser chamado;
- os objetos retornados e coleções próprias são imutáveis;
- intent, wallet e policies não sofrem mutação;
- a função não aplica evento ao ledger/portfolio;
- isolamento entre dois agentes;
- determinismo com o mesmo input e timestamps;
- testes offline e determinísticos.

Use test doubles somente dentro dos testes. Não adicione uma segunda implementação de broker ao código de produção.

## Documentação

Atualize o README apenas no necessário para registrar a sequência obrigatória e deixar explícito que:

- Risk Manager bloqueado encerra o fluxo;
- aprovação de risco não significa fill garantido;
- o PaperBroker ainda pode rejeitar por caixa, posição, quantidade ou custos;
- a fachada é pura e não aplica eventos ao ledger.

Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos, testes, limitações e decisões técnicas.

## Fora do escopo

Não implementar:

- Astra/LLM, prompts ou agentes;
- dados de mercado ou rede;
- persistência em disco;
- append/aplicação automática no ledger;
- métricas, replay ou benchmarks;
- novas regras de risco;
- dashboard, servidor ou cloud;
- wallet externa, chave privada, blockchain;
- testnet, corretora, exchange, credenciais ou dinheiro real;
- qualquer broker além do PaperBroker existente.

Não adicionar dependência runtime. Não alterar este `TASK.md`.

## Critérios de aceite

- sequência Risk Manager → PaperBroker comprovada por testes;
- veto determinístico não pode ser contornado pela fachada;
- apenas broker `kind === "paper"`;
- resultado estruturado e imutável;
- nenhuma mutação contábil pela fachada;
- tipos estritos e comportamento determinístico;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real existe.

## Entrega

1. Faça um único commit com a mensagem `feat: integra risco ao fluxo de execucao paper`.
2. Faça push em branch própria e abra PR para `main`.
3. No PR, inclua resumo, testes e `Closes #6`.
4. Não aprove o próprio trabalho e não altere o status desta tarefa.
