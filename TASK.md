# Tarefa atual

- **ID:** TASK-023
- **Milestone:** M4 — registro imutável de resposta bruta
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_022.md`

## Objetivo

Criar o menor registro em memória, determinístico e auditável, que associe uma solicitação de agente à sua resposta bruta e às versões explícitas de prompt e modelo.

`AgentRequest + rawResponse + promptVersion + model → AgentResponseCapture`

Esta tarefa não persiste dados, não chama modelo e não integra Astra.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, os documentos de contexto, arquitetura, decisões e roadmap, `docs/coordination/CHATGPT_REVIEW_TASK_022.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/agent/agent-adapter.ts`, `src/domain/contracts.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/capture-agent-response.ts`.

Implemente um contrato e uma função pura para construir `AgentResponseCapture`, contendo somente:

- `request`: uma cópia validada e imutável de `AgentRequest`;
- `responseId`: identificador explícito e estável, fornecido pelo chamador;
- `rawResponse`: texto bruto recebido do agente, preservado exatamente e sem parse, normalização, correção ou interpretação;
- `promptVersion`: versão explícita do prompt;
- `model`: identificador explícito do modelo.

A função deve:

- validar e congelar o registro retornado;
- revalidar `request` com `parseAgentRequest`;
- exigir `responseId`, `promptVersion` e `model` não vazios, limitados e livres de caracteres de controle;
- exigir `rawResponse` como string não vazia, com limite explícito e sem modificá-la;
- rejeitar qualquer campo obrigatório inválido com `ContractValidationError`;
- não criar IDs, não ler relógio, não usar aleatoriedade, não fazer I/O e não persistir dados;
- não chamar `parseAgentProposal` nem implementar retry.

## Regras obrigatórias

- O conteúdo de `rawResponse` é opaco nesta camada: inclusive JSON inválido deve ser preservado, não rejeitado por conteúdo.
- Não adicionar `Date`, timestamp implícito, hash, UUID, dependência runtime, arquivo, banco, JSONL, CSV, rede, SDK, endpoint, token, segredo ou variável de ambiente.
- Não modificar `AgentAdapter`, `StubAgentAdapter`, contratos financeiros, Risk Manager, broker, ledger, replay ou métricas.
- Toda inconsistência do novo contrato gera `ContractValidationError`.

## Testes obrigatórios

- captura válida com cópia de `AgentRequest` congelada;
- preservação byte a byte do texto bruto, inclusive texto que não seja JSON válido;
- `responseId`, `promptVersion` e `model` inválidos;
- `rawResponse` vazio, não string e acima do limite;
- request inválida em tempo de execução;
- imutabilidade, não mutação e determinismo;
- ausência de relógio, aleatoriedade, rede e I/O;
- testes offline.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Persistência, JSONL, CSV, banco, captura por rede, integração real com Astra ou outro modelo, HTTP, SDK, autenticação, credenciais, retry, backoff, prompt real, seleção de modelo, concorrência, execução financeira, wallet externa, blockchain, testnet, corretora, dinheiro real, cloud ou dashboard.

## Critérios de aceite

- registro mínimo, imutável e auditável;
- resposta bruta preservada sem interpretação;
- versões de prompt e modelo explícitas;
- validação fail-closed e determinística;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: registra resposta bruta de agente`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
