# Tarefa atual

- **ID:** TASK-022
- **Milestone:** M4 — adaptador de agente stub determinístico
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_021.md`

## Objetivo

Criar a menor fronteira auditável para obter uma resposta bruta de agente em testes, começando exclusivamente por um stub local e determinístico.

`AgentRequest + resposta roteirizada → resposta bruta`

Esta tarefa não integra Astra, LLM ou qualquer serviço externo.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, os documentos de contexto, arquitetura, decisões e roadmap, `docs/coordination/CHATGPT_REVIEW_TASK_021.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/domain/contracts.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/agent-adapter.ts` e `src/agent/stub-agent-adapter.ts`.

Implemente:

- um contrato mínimo `AgentAdapter` para receber uma solicitação imutável identificada por `agentId`, `cycleId` e `snapshotId`;
- retorno de uma resposta bruta `unknown`, mantendo a validação de `AgentProposal` fora do adaptador e a cargo de `parseAgentProposal`;
- um `StubAgentAdapter` local, configurado com respostas roteirizadas por chave exata da solicitação;
- consumo determinístico de uma única resposta por solicitação, sem fallback, inferência ou escolha parcial;
- rejeição fail-closed para solicitação inválida, chave ausente, chave duplicada na configuração ou segunda chamada da mesma chave;
- cópias/estruturas imutáveis que não exponham nem mutem a configuração recebida;
- ausência total de relógio, aleatoriedade, rede e I/O.

## Regras obrigatórias

- O stub não deve validar, corrigir, completar ou interpretar a resposta bruta.
- A resposta bruta deve poder ser encaminhada diretamente a `parseAgentProposal` por uma camada posterior.
- Não implementar retry nesta tarefa; ele será uma política separada e limitada.
- Não incluir SDK, endpoint, token, segredo, variável de ambiente ou dependência runtime.
- Toda inconsistência do adaptador gera `ContractValidationError`.
- Não alterar contratos financeiros, Risk Manager, broker, ledger, replay ou métricas.

## Testes obrigatórios

- retorno exato da resposta roteirizada para chave correspondente;
- duas chaves independentes;
- rejeição de campos vazios ou inválidos da solicitação;
- rejeição de chave ausente;
- rejeição de chave duplicada na configuração;
- rejeição de segunda chamada da mesma chave;
- preservação de resposta malformada sem interpretação pelo stub;
- integração demonstrativa em teste: resposta válida aceita por `parseAgentProposal` e resposta inválida rejeitada por ele;
- imutabilidade, não mutação e determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Integração real com Astra ou outro modelo, HTTP, SDK, autenticação, credenciais, retry, backoff, prompt real, seleção de modelo, persistência, concorrência, execução financeira, wallet externa, blockchain, testnet, corretora, dinheiro real, cloud ou dashboard.

## Critérios de aceite

- fronteira do adaptador mínima e auditável;
- stub estritamente local, determinístico e fail-closed;
- separação preservada entre resposta bruta e validação de `AgentProposal`;
- entradas não mutadas e estruturas imutáveis;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: adiciona adaptador de agente stub`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
