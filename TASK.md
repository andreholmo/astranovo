# Tarefa atual

- **ID:** TASK-021
- **Milestone:** M3 — agregação de resultados realizados e win rate exato
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_020.md`

## Objetivo

Criar a menor agregação auditável de vários `ClosedRoundTripResult` já validados, por agente, sem reconstruir fills ou posições.

`agentId + ClosedRoundTripResult[] → RealizedPerformanceSummary`

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, os documentos de contexto, arquitetura, decisões e roadmap, `docs/coordination/CHATGPT_REVIEW_TASK_020.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/metrics/summarize-closed-round-trip.ts`, `src/money/fixed-point.ts` e esta tarefa.

## Escopo exato

Crie `src/metrics/summarize-realized-performance.ts`.

Implemente uma função pura que:

- receba `agentId` e uma lista readonly de `ClosedRoundTripResult`;
- aceite lista vazia;
- valide fail-closed que todos os resultados pertencem ao agente solicitado;
- rejeite IDs de BUY ou SELL repetidos em qualquer ponto da lista, inclusive um ID reutilizado entre pernas distintas;
- revalide direção e magnitude contra `realizedCostMicros` e `netProceedsMicros`;
- conte trades fechados, vitórias, derrotas e empates;
- some separadamente ganhos e perdas absolutas com proteção de limite;
- produza o resultado líquido como `WIN | LOSS | BREAK_EVEN` e magnitude absoluta;
- represente win rate de modo exato, sem ponto flutuante, como fração `winRateNumerator / winRateDenominator`, onde o numerador é o número de vitórias e o denominador é o total de trades fechados; para lista vazia, ambos são zero;
- devolva resultado imutável e independente da ordem de entrada;
- não mute entradas.

## Regras obrigatórias

- Reutilize as primitivas monetárias existentes; não duplique fórmulas.
- Nenhum `number` para valores monetários.
- Nenhum percentual arredondado ou ponto flutuante para win rate.
- Nenhum relógio, aleatoriedade, rede ou I/O.
- Toda inconsistência gera `ContractValidationError`.
- Não reconstruir fills, posições, FIFO/LIFO ou carteira.
- Não adicionar dependência runtime.

## Testes obrigatórios

- lista vazia;
- somente vitórias, somente derrotas e somente empates;
- combinação de vitória, derrota e empate;
- resultado líquido WIN, LOSS e BREAK_EVEN;
- diferença exata de 1 micro;
- fração exata do win rate, incluindo empate no denominador;
- rejeição por agente divergente;
- rejeição por qualquer eventId reutilizado;
- rejeição por direção ou magnitude inconsistente;
- proteção contra overflow nas somas;
- invariância à ordem, imutabilidade, não mutação e determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Pareamento de fills, múltiplos lotes, posição parcial, FIFO/LIFO, short, retorno percentual, ranking multiagente, Sharpe, persistência, novas estratégias, execução, wallet externa, blockchain, testnet, corretora, credenciais, dinheiro real, cloud ou dashboard.

## Critérios de aceite

- agregação correta, exata e auditável;
- win rate representado por fração inteira exata;
- validação fail-closed;
- resultado imutável, determinístico e invariável à ordem;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: agrega desempenho realizado exato`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
