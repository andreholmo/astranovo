# Tarefa atual

- **ID:** TASK-013
- **Milestone:** M3 — série cronológica de snapshots para replay
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_012.md`

## Objetivo

Compor a primitiva da TASK-012 em uma função determinística que materialize, para uma sequência cronológica de instantes de decisão, exatamente o snapshot que estava disponível em cada instante.

`snapshots + asset + quote + decisionTimes → série imutável de pontos de replay`

Esta ainda não é a execução completa do replay. É apenas a montagem auditável da linha temporal de evidências de mercado.

## Leitura obrigatória

Sincronize `main` e leia integralmente:

1. `CLAUDE.md`;
2. `docs/PROJECT_CONTEXT.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISIONS.md`;
5. `docs/ROADMAP.md`;
6. `docs/coordination/CHATGPT_REVIEW_TASK_012.md`;
7. `docs/coordination/CLAUDE_REPORT.md`;
8. `src/domain/contracts.ts`;
9. `src/replay/select-latest-available-snapshot.ts`;
10. esta tarefa.

## Escopo exato

Crie um módulo pequeno em `src/replay/`, por exemplo `buildReplaySnapshotSeries`.

Entradas:

- coleção readonly de snapshots não confiáveis;
- `asset`;
- `quote`;
- coleção readonly de timestamps canônicos `decisionTimes`, já em ordem cronológica estritamente crescente.

Saída:

- coleção readonly e congelada de pontos;
- cada ponto contém somente `decisionAt` e o `MarketSnapshot` validado selecionado para esse instante;
- cada snapshot deve ser obtido obrigatoriamente por `selectLatestAvailableSnapshot`.

## Regras obrigatórias

- Reutilizar `selectLatestAvailableSnapshot`; não duplicar sua lógica.
- Rejeitar `decisionTimes` vazio.
- Rejeitar timestamp não canônico.
- Rejeitar timestamps duplicados ou fora de ordem.
- Para cada instante, propagar fail-closed quando não houver snapshot elegível, houver empate no máximo ou existir entrada inválida relevante.
- Nunca usar snapshot com `availableAt > decisionAt`.
- Não ordenar nem alterar snapshots ou `decisionTimes`.
- Preservar os snapshots validados e imutáveis retornados pelo seletor.
- Congelar cada ponto e a coleção externa.
- Mesmo input canônico deve produzir resultado idêntico.
- Nenhum relógio, aleatoriedade, rede ou I/O.

## Testes obrigatórios

- constrói série para um único instante;
- constrói série cronológica para vários instantes;
- troca de snapshot somente quando um mais recente já está disponível;
- aceita snapshot com `availableAt === decisionAt`;
- prova que snapshot futuro nunca aparece antes da disponibilidade;
- rejeita lista de instantes vazia;
- rejeita instante não canônico;
- rejeita instantes duplicados;
- rejeita instantes fora de ordem;
- propaga ausência de snapshot elegível;
- propaga empate no maior `availableAt`;
- propaga snapshot malformado do par solicitado;
- ignora outros pares conforme a primitiva existente;
- ausência de mutação das entradas;
- imutabilidade dos pontos e da coleção;
- determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário para explicar a série de evidências do replay.

Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos, testes, limitações e decisões técnicas.

## Fora do escopo

Não implementar:

- decisão BUY/SELL/HOLD;
- agente, Astra/LLM, prompts ou handoffs;
- execução de ordem, Risk Manager ou PaperBroker;
- replay completo do portfólio;
- indicadores;
- buy-and-hold ou estratégia aleatória;
- ranking entre agentes;
- coleta de mercado ou rede;
- persistência;
- novas regras de risco;
- dashboard, servidor ou cloud;
- wallet externa, chave privada, blockchain;
- testnet, corretora, exchange, credenciais ou dinheiro real.

Não adicionar dependência runtime. Não alterar este `TASK.md`.

## Critérios de aceite

- cada ponto usa apenas informação disponível em seu `decisionAt`;
- a composição reutiliza a primitiva revisada da TASK-012;
- comportamento fail-closed para sequência inválida e falhas da seleção;
- resultado imutável, determinístico e cronológico;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real existe.

## Entrega

1. Faça um único commit com a mensagem `feat: constroi serie de snapshots para replay`.
2. Faça push em branch própria e abra PR para `main`.
3. No PR, inclua resumo, testes e `Closes #22`.
4. Não aprove o próprio trabalho e não altere o status desta tarefa.
