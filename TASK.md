# Tarefa atual

- **ID:** TASK-026
- **Milestone:** M4 — tentativa única de agente stub
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_025.md`

## Objetivo

Criar a menor composição determinística e fail-closed para executar exatamente uma tentativa de um agente stub, preservar sua resposta bruta e validar a proposta tipada.

`AgentRequest → StubAgentAdapter → captura auditável → AgentProposal validada`

A implementação permanece inteiramente em memória e offline. Ela não deve executar retry, ciclo de trading, ordem, fill ou qualquer operação financeira.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, os documentos de arquitetura, decisões e roadmap, `docs/coordination/CHATGPT_REVIEW_TASK_025.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/agent/agent-adapter.ts`, `src/agent/stub-agent-adapter.ts`, `src/agent/capture-agent-response.ts`, `src/agent/retry-policy.ts`, `src/domain/contracts.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/run-single-agent-attempt.ts`.

Implemente uma função assíncrona que receba explicitamente:

- um `AgentAdapter`;
- um `AgentRequest`;
- `responseId`;
- `promptVersion`;
- `model`.

A função deve:

1. validar fail-closed todos os metadados antes da chamada;
2. chamar o adapter exatamente uma vez;
3. exigir resposta bruta do tipo string;
4. capturar a resposta com a primitiva existente, sem alterar nem normalizar seu conteúdo;
5. interpretar a string como JSON e validar o objeto com `parseAgentProposal`;
6. exigir alinhamento exato de `agentId` e `cycleId` entre request e proposta;
7. exigir alinhamento exato de `promptVersion` e `model` entre metadados e proposta;
8. devolver um resultado imutável contendo somente a captura e a proposta validada.

Erros devem ser fail-closed, determinísticos e não podem incluir a resposta bruta, tokens, segredos ou dados arbitrários do agente em suas mensagens.

Não gerar ID, timestamp ou valor implícito. Não implementar retry, delay, timeout, fallback ou recuperação nesta tarefa.

## Testes obrigatórios

- caminho feliz usando `StubAgentAdapter`;
- prova de que o adapter é chamado exatamente uma vez;
- preservação byte a byte da resposta bruta na captura;
- rejeição de resposta não string;
- rejeição de JSON inválido e proposta inválida;
- rejeição de divergência em `agentId`, `cycleId`, `promptVersion` e `model`;
- mensagens de erro não expõem o conteúdo bruto;
- imutabilidade do resultado e ausência de mutação das entradas;
- determinismo;
- prova offline de ausência de relógio, timer, aleatoriedade, rede e I/O.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Não criar loop de retry, coordenador multiagente, consenso, estratégia, ciclo de replay, provider de mercado, ordem, fill, Risk Manager, PaperBroker, ledger, persistência, CSV, JSONL, banco, dashboard ou integração Astra real.

Não usar HTTP, SDK externo, fila, concorrência, timer, delay, relógio, aleatoriedade, ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora, dinheiro real ou cloud.

## Critérios de aceite

- uma tentativa stub completa, imutável, determinística e fail-closed;
- resposta bruta preservada e proposta validada com alinhamento de identidade e proveniência;
- adapter chamado exatamente uma vez;
- nenhuma repetição automática ou efeito externo;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: executa tentativa unica de agente stub`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
