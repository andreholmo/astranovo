# Tarefa atual

- **ID:** TASK-012
- **Milestone:** M3 — seleção de snapshot para replay sem look-ahead
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_011.md`

## Objetivo

Criar uma primitiva determinística que selecione, para uma decisão histórica, o snapshot de mercado mais recente que já estava disponível naquele instante.

`snapshots + asset + quote + decisionAt → MarketSnapshot disponível mais recente`

Esta tarefa fecha uma peça pequena do replay: impedir que contexto de decisão use dados futuros.

## Leitura obrigatória

Sincronize `main` e leia integralmente:

1. `CLAUDE.md`;
2. `docs/PROJECT_CONTEXT.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISIONS.md`;
5. `docs/ROADMAP.md`;
6. `docs/coordination/CHATGPT_REVIEW_TASK_011.md`;
7. `docs/coordination/CLAUDE_REPORT.md`;
8. `src/domain/contracts.ts`;
9. `src/metrics/value-wallet-at.ts`;
10. esta tarefa.

## Escopo exato

Crie um módulo pequeno em `src/replay/`, por exemplo `selectLatestAvailableSnapshot`.

Entradas:

- coleção readonly de `MarketSnapshot`;
- `asset`;
- `quote`;
- timestamp canônico `decisionAt`.

Saída:

- um `MarketSnapshot` validado e imutável;
- deve ser o snapshot do par solicitado com maior `availableAt` tal que `availableAt <= decisionAt`.

## Regras obrigatórias

- Reutilizar o parser/validador existente de `MarketSnapshot`; não redefinir o contrato.
- Validar `decisionAt` usando a regra canônica já existente ou uma função compartilhada existente.
- Ignorar snapshots de outros pares.
- Nunca selecionar snapshot com `availableAt > decisionAt`.
- Falhar fechado se não existir snapshot elegível.
- Falhar fechado se dois snapshots elegíveis do mesmo par tiverem o mesmo maior `availableAt`; não desempatar silenciosamente.
- Validar todos os snapshots do par solicitado antes de selecionar, inclusive futuros; entrada malformada não pode ser escondida pelo filtro temporal.
- Não ordenar nem alterar a coleção recebida.
- A ordem da entrada não pode mudar o resultado.
- Retorno deve preservar o objeto validado e imutável do contrato existente.
- Mesmo input canônico deve produzir resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.

## Testes obrigatórios

- seleciona o único snapshot elegível;
- escolhe o mais recente entre vários snapshots passados;
- aceita `availableAt === decisionAt`;
- ignora snapshot futuro;
- ignora outro asset;
- ignora outra quote;
- rejeita ausência de snapshot elegível;
- rejeita empate no maior `availableAt`;
- rejeita `decisionAt` não canônico;
- rejeita snapshot malformado do par solicitado mesmo quando futuro;
- resultado independente da ordem da entrada;
- ausência de mutação da entrada;
- imutabilidade do retorno;
- determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário para explicar a seleção anti-look-ahead usada pelo replay.

Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos, testes, limitações e decisões técnicas.

## Fora do escopo

Não implementar:

- replay completo ou execução de ciclos;
- coleta de mercado ou rede;
- indicadores;
- buy-and-hold ou estratégia aleatória;
- ranking entre agentes;
- Astra/LLM, prompts ou agentes;
- novas regras de risco;
- persistência;
- dashboard, servidor ou cloud;
- wallet externa, chave privada, blockchain;
- testnet, corretora, exchange, credenciais ou dinheiro real.

Não adicionar dependência runtime. Não alterar este `TASK.md`.

## Critérios de aceite

- snapshot selecionado é o último dado realmente disponível em `decisionAt`;
- comportamento fail-closed para ausência, empate e entrada inválida;
- nenhuma possibilidade de look-ahead;
- resultado imutável, determinístico e independente da ordem de entrada;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real existe.

## Entrega

1. Faça um único commit com a mensagem `feat: seleciona snapshot sem look-ahead para replay`.
2. Faça push em branch própria e abra PR para `main`.
3. No PR, inclua resumo, testes e `Closes #20`.
4. Não aprove o próprio trabalho e não altere o status desta tarefa.
