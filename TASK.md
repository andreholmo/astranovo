# Tarefa atual

- **ID:** TASK-032
- **Milestone:** M4 — ciclo offline finalizado de um agente
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_031.md`

## Objetivo

Criar a menor composição assíncrona que execute as tentativas auditáveis limitadas já existentes e devolva diretamente o resultado final seguro já existente:

```text
RunBoundedAgentAttemptsRequest
→ runBoundedAgentAttempts
→ finalizeBoundedAgentAttempts
→ ACCEPTED | HOLD
```

Esta tarefa fecha o ciclo offline de exatamente um agente. Não cria nova lógica de retry ou validação, não coordena múltiplos agentes e não chama Risk Manager ou broker.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_031.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/agent/run-bounded-agent-attempts.ts`, `src/agent/finalize-bounded-agent-attempts.ts`, `src/agent/run-auditable-agent-attempt.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/run-finalized-agent-cycle.ts`.

Defina `runFinalizedAgentCycle`, assíncrona, que:

- recebe exatamente o mesmo contrato de entrada de `runBoundedAgentAttempts`, reutilizando o tipo existente;
- chama `runBoundedAgentAttempts` exatamente uma vez;
- entrega o resultado retornado diretamente a `finalizeBoundedAgentAttempts`, exatamente uma vez;
- devolve a união `FinalizedBoundedAgentAttemptsResult` sem remodelar, copiar, reinterpretar ou enriquecer campos;
- preserva `ACCEPTED` integralmente;
- converte esgotamento somente em `HOLD` por meio do finalizador existente;
- propaga falhas contratuais sanitizadas e interrompe imediatamente, sem tentativa adicional;
- não gera IDs, timestamps, mensagens, propostas ou qualquer dado implícito.

Não duplique validadores, retry, decisões de progresso nem lógica de finalização. Não altere contratos públicos dos módulos existentes.

## Testes obrigatórios

- rejeição seguida de aceitação devolve `ACCEPTED`, preservando capturas, proposta, ordem e IDs;
- esgotamento com 1, 2 e 3 tentativas devolve `HOLD` com razão e códigos fechados na ordem;
- o adapter é chamado exatamente o número necessário e nunca após aceitação ou falha;
- cada `responseId` explícito é usado uma vez e na ordem;
- entrada inválida ou forjada falha antes da primeira chamada ao adapter;
- exceção do adapter permanece sanitizada e não inicia nova tentativa;
- resultado e listas permanecem congelados;
- entrada não é mutada;
- mesmos dados determinísticos produzem resultado campo a campo idêntico;
- nenhuma duplicação de proposta, captura, validação, retry ou finalização;
- nenhuma chamada a timer, relógio, aleatoriedade, HTTP, SDK, ambiente, persistência, Risk Manager, broker ou I/O;
- toda a suíte anterior continua verde.

Use apenas adapters stub locais e determinísticos. Não altere `StubAgentAdapter`.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Não criar coordenador multiagente, agregação, votação, handoff, Risk Manager, PaperBroker, fill, carteira, ledger, persistência, provider de mercado, integração Astra real, timeout, backoff ou agendamento.

Não usar HTTP, SDK externo, fila, timer, relógio, aleatoriedade, variável de ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora ou dinheiro real.

## Critérios de aceite

- a composição usa uma única execução limitada e uma única finalização;
- aceitação e esgotamento preservam exatamente as garantias dos módulos existentes;
- nenhuma falha pode disparar tentativa adicional ou produzir aceitação;
- nenhuma geração implícita de dado e nenhuma duplicação material;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: compõe ciclo offline finalizado de agente`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
