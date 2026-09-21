# Tarefa atual

- **ID:** TASK-029
- **Milestone:** M4 — execução de uma tentativa auditável
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_028.md`

## Objetivo

Criar a menor composição que execute exatamente uma chamada ao `AgentAdapter` e devolva a avaliação auditável completa da resposta:

```text
AgentRequest → AgentAdapter.call (uma vez)
→ AgentResponseCapture
→ ACCEPTED(AgentProposal) | REJECTED(código seguro)
```

Uma resposta do agente inválida deve permanecer como `REJECTED` com sua captura auditável, em vez de ser convertida em exceção. Falhas anteriores à existência de uma captura válida continuam falhando fechado com erro sanitizado.

Não executar retry, loop, backoff, timeout, HOLD, persistência ou integração real.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_028.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/agent/agent-adapter.ts`, `src/agent/capture-agent-response.ts`, `src/agent/evaluate-agent-response-capture.ts`, `src/agent/run-single-agent-attempt.ts`, `src/agent/retry-policy.ts`, `src/agent/decide-agent-attempt-progress.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/run-auditable-agent-attempt.ts`.

Defina `runAuditableAgentAttempt`, assíncrona apenas para manter compatibilidade com a fronteira existente, que recebe o mesmo conjunto de dados de `RunSingleAgentAttemptRequest` e:

1. valida fail-closed o objeto de entrada, o adaptador, o `AgentRequest`, `responseId`, `promptVersion` e `model` antes de chamar o adaptador;
2. chama `adapter.call(request)` exatamente uma vez;
3. converte qualquer valor lançado pelo adaptador em `ContractValidationError` com mensagem fixa e sanitizada, sem `message`, `stack`, `cause` ou conteúdo original;
4. exige que o retorno bruto seja `string`; retorno de outro tipo falha fechado antes de criar captura;
5. entrega a resposta bruta, sem normalização, a `evaluateAgentResponseCapture`;
6. devolve diretamente a união imutável `AgentResponseEvaluation`, preservando a captura tanto em `ACCEPTED` quanto em `REJECTED`.

Refatore `runSingleAgentAttempt` somente no necessário para delegar a execução a `runAuditableAgentAttempt`:

- assinatura e comportamento público atuais devem permanecer idênticos;
- `ACCEPTED` continua retornando `{ capture, proposal }`;
- `REJECTED` continua sendo convertido nos mesmos `ContractValidationError` sanitizados já existentes;
- nenhuma chamada adicional ao adaptador.

Extraia/reutilize validações comuns; não mantenha duas implementações independentes da mesma chamada.

## Testes obrigatórios

- `ACCEPTED` chama o adaptador exatamente uma vez e preserva captura/proposta;
- cada um dos seis códigos `REJECTED` é devolvido como dado, com captura bruta byte a byte;
- resposta não-string e exceção do adaptador falham fechado, sem segunda chamada;
- mensagem, stack, cause, token, segredo ou valor arbitrário lançado pelo adaptador não aparecem no erro;
- metadados, request, adaptador e objeto de entrada forjados falham antes da chamada quando aplicável;
- `runSingleAgentAttempt` mantém todos os testes e mensagens públicas anteriores após delegar;
- resultados congelados, ausência de mutação e determinismo para o mesmo adaptador stub;
- prova de ausência de retry, timer, relógio, aleatoriedade, HTTP, SDK, ambiente, persistência ou I/O.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Não implementar segunda tentativa, loop de retry, backoff, timeout, HOLD final, coordenador multiagente, persistência, logs externos, provider de mercado, integração Astra real, ordem, fill, Risk Manager, PaperBroker, ledger, banco, dashboard ou cloud.

Não usar HTTP, SDK externo, fila, concorrência, timer, delay, relógio, aleatoriedade, variável de ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora ou dinheiro real.

## Critérios de aceite

- exatamente uma chamada ao adaptador;
- respostas inválidas do agente retornam `REJECTED` auditável, não exceção;
- falhas sem captura válida produzem somente erro sanitizado;
- `runSingleAgentAttempt` preserva integralmente o contrato anterior;
- nenhuma duplicação material do fluxo de chamada/validação;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: executa tentativa auditavel de agente`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
