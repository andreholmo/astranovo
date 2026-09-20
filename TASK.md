# Tarefa atual

- **ID:** TASK-024
- **Milestone:** M4 — política de retry controlado
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_023.md`

## Objetivo

Criar o menor contrato puro, determinístico e fail-closed para descrever uma política de novas tentativas de chamada de agente, sem executar chamadas, esperar tempo ou integrar qualquer modelo.

`RetryPolicy + tentativa explícita → decisão determinística`

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, os documentos de arquitetura, decisões e roadmap, `docs/coordination/CHATGPT_REVIEW_TASK_023.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/agent/agent-adapter.ts`, `src/agent/capture-agent-response.ts`, `src/domain/contracts.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/retry-policy.ts`.

Implemente:

- um contrato imutável `AgentRetryPolicy` com somente `maxAttempts`;
- um parser puro `parseAgentRetryPolicy(value)`;
- uma função pura `shouldRetryAgentAttempt(policy, completedAttempts)` que retorna `true` apenas quando ainda restar uma tentativa dentro do limite explícito.

Regras:

- `maxAttempts` é inteiro seguro entre 1 e 3, inclusive;
- `completedAttempts` é inteiro seguro não negativo;
- entradas inválidas devem falhar com `ContractValidationError`;
- a política e as estruturas retornadas devem ser congeladas;
- nenhuma função cria tentativa, chama `AgentAdapter`, executa retry, lê relógio, aguarda, calcula backoff, usa aleatoriedade ou faz I/O.

## Testes obrigatórios

- validação dos limites 1 e 3;
- rejeição de zero, valores acima de 3, negativos, frações, NaN, infinito, string e objeto;
- decisão exata nos limites de cada política;
- rejeição de `completedAttempts` inválido;
- imutabilidade, ausência de mutação e determinismo;
- teste offline que prove ausência de relógio, timer, aleatoriedade, rede e I/O.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Não alterar `AgentAdapter`, `StubAgentAdapter`, captura de resposta, contratos financeiros, Risk Manager, broker, ledger, replay ou métricas.

Não implementar loop, chamada de modelo, HTTP, SDK, fila, concorrência, timer, delay, backoff, timestamp, persistência, arquivo, JSONL, CSV, banco, ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora, dinheiro real, cloud ou dashboard.

## Critérios de aceite

- política mínima e imutável;
- máximo estrito de três tentativas;
- decisão determinística e fail-closed;
- nenhuma execução de retry nem integração externa;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: define política de retry controlado`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
