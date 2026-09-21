# Tarefa atual

- **ID:** TASK-031
- **Milestone:** M4 — resultado final seguro após retries
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_030.md`

## Objetivo

Criar a menor transformação pura que converta o resultado auditável de `runBoundedAgentAttempts` em um resultado final seguro do agente:

```text
ACCEPTED → proposta aceita preservada
ATTEMPTS_EXHAUSTED → HOLD explícito e auditável
```

Esta tarefa apenas representa a decisão final após o retry já executado. Não chama agente, não executa retry, não chama Risk Manager ou broker e não altera carteira.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_030.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/agent/run-bounded-agent-attempts.ts`, `src/agent/evaluate-agent-response-capture.ts`, `src/domain/contracts.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/finalize-bounded-agent-attempts.ts`.

Defina `finalizeBoundedAgentAttempts`, síncrona e pura, que recebe um `BoundedAgentAttemptsResult` e devolve uma união fechada e imutável:

- `ACCEPTED`:
  - preserva todas as avaliações na ordem;
  - preserva a avaliação aceita e a proposta aceita sem alteração;
  - não cria uma segunda proposta nem altera ação, confiança, tamanho ou evidências;
- `HOLD`:
  - existe somente para entrada `ATTEMPTS_EXHAUSTED`;
  - usa razão fechada `ATTEMPTS_EXHAUSTED`;
  - preserva todas as avaliações rejeitadas e os códigos na ordem;
  - não fabrica `AgentProposal`, preço, posição, confiança, evidência ou texto livre.

A função deve revalidar fail-closed a estrutura recebida em runtime, inclusive entradas forjadas. Deve provar consistência entre `status`, avaliações, resultado aceito e códigos, rejeitando propriedades extras ou incompatíveis quando isso for necessário para manter a união fechada. Exceções arbitrárias de getters/`Proxy` não podem vazar mensagens, stack, causa ou segredo.

Reutilize validadores e tipos existentes quando aplicável. Não duplique materialmente a lógica de `runBoundedAgentAttempts` ou `evaluateAgentResponseCapture`.

## Testes obrigatórios

- converte `ACCEPTED` preservando proposta, captura, histórico e ordem;
- converte `ATTEMPTS_EXHAUSTED` em `HOLD` com razão fechada e códigos alinhados;
- resultado e listas retornadas são congelados;
- entrada não é mutada;
- não fabrica proposta no ramo `HOLD`;
- rejeita união adulterada: status inválido, resultado aceito divergente, avaliação aceita no ramo esgotado, código divergente, listas vazias ou acima do limite de três;
- rejeita propriedades incompatíveis e extras, inclusive quando presentes com valor `undefined`;
- getters/`Proxy` forjados falham com `ContractValidationError` sanitizado;
- mesmos dados válidos produzem resultado campo a campo idêntico;
- nenhuma chamada a adaptador, retry, timer, relógio, aleatoriedade, HTTP, SDK, ambiente, persistência ou I/O;
- toda a suíte anterior continua verde.

Use fixtures locais e determinísticas. Não altere `StubAgentAdapter`.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Não executar tentativas, não criar coordenador multiagente, Risk Manager, PaperBroker, fill, carteira, ledger, persistência, logs externos, provider de mercado, integração Astra real, timeout, backoff ou agendamento.

Não usar HTTP, SDK externo, fila, timer, relógio, aleatoriedade, variável de ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora ou dinheiro real.

## Critérios de aceite

- esgotamento das tentativas sempre resulta em `HOLD` explícito, fechado e auditável;
- aceitação preserva integralmente a proposta já validada;
- nenhuma entrada adulterada pode transformar rejeição/esgotamento em aceitação;
- nenhuma geração implícita de dado e nenhuma duplicação material;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: finaliza tentativas com hold seguro`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
