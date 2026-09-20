# Tarefa atual

- **ID:** TASK-027
- **Milestone:** M4 — resultado auditável de tentativa
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_026.md`

## Objetivo

Criar a menor avaliação pura que transforme uma captura bruta já validada em um resultado auditável de aceitação ou rejeição, preservando a captura mesmo quando o conteúdo do agente for inválido.

`AgentResponseCapture → ACCEPTED(AgentProposal) | REJECTED(código seguro)`

Isso prepara o retry controlado sem executar retry nesta tarefa e impede que respostas inválidas desapareçam da trilha de auditoria.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, os documentos de arquitetura, decisões e roadmap, `docs/coordination/CHATGPT_REVIEW_TASK_026.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/agent/capture-agent-response.ts`, `src/agent/run-single-agent-attempt.ts`, `src/agent/retry-policy.ts`, `src/domain/contracts.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/evaluate-agent-response-capture.ts`.

Defina `evaluateAgentResponseCapture(capture)` como função síncrona, pura e determinística que:

1. revalida fail-closed a estrutura completa de `AgentResponseCapture`, sem alterar `rawResponse`;
2. interpreta `rawResponse` como JSON;
3. valida o objeto por `parseAgentProposal`;
4. exige alinhamento exato de `agentId`, `cycleId`, `promptVersion` e `model` entre captura e proposta;
5. devolve uma união discriminada imutável:
   - `ACCEPTED`: captura original validada e proposta validada;
   - `REJECTED`: captura original validada e exatamente um código seguro de motivo.

Códigos fechados permitidos:

- `INVALID_JSON`;
- `INVALID_PROPOSAL`;
- `AGENT_ID_MISMATCH`;
- `CYCLE_ID_MISMATCH`;
- `PROMPT_VERSION_MISMATCH`;
- `MODEL_MISMATCH`.

A rejeição não deve incluir mensagem, stack, cause, valor recebido ou conteúdo arbitrário do agente. A captura bruta permanece disponível no objeto de resultado apenas para futura auditoria controlada; não deve ser interpolada em erro ou código.

Refatore `runSingleAgentAttempt` apenas no necessário para reutilizar essa avaliação, mantendo seu contrato público atual: uma proposta rejeitada continua gerando `ContractValidationError` sanitizado, sem retry, e uma proposta aceita continua devolvendo `{ capture, proposal }`.

## Testes obrigatórios

- resultado `ACCEPTED` para proposta válida;
- cada um dos seis códigos `REJECTED`;
- preservação byte a byte da captura em sucesso e rejeição;
- nenhum código ou erro expõe resposta bruta, token, segredo ou valor arbitrário;
- `runSingleAgentAttempt` mantém chamada única, comportamento atual e erros sanitizados;
- captura forjada ou estruturalmente inválida falha fechado antes de avaliar conteúdo;
- resultado, captura validada e proposta congelados;
- ausência de mutação e determinismo;
- prova offline de ausência de relógio, timer, aleatoriedade, rede e I/O.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Não implementar loop de retry, backoff, timeout, coordenador multiagente, HOLD final, persistência, logs externos, provider de mercado, ordem, fill, Risk Manager, PaperBroker, ledger, banco, dashboard ou integração Astra real.

Não usar HTTP, SDK externo, fila, concorrência, timer, delay, relógio, aleatoriedade, ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora, dinheiro real ou cloud.

## Critérios de aceite

- captura preservada tanto para aceitação quanto para rejeição de conteúdo;
- códigos de rejeição fechados, seguros e determinísticos;
- nenhuma informação arbitrária aparece em erros ou códigos;
- `runSingleAgentAttempt` mantém compatibilidade e chamada única;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: avalia captura de agente com resultado auditavel`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
