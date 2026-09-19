# Tarefa atual

- **ID:** TASK-020
- **Milestone:** M3 — resultado realizado de um round trip paper
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_019.md`

## Objetivo

Criar a menor primitiva auditável para calcular o resultado realizado de uma operação paper completamente encerrada: exatamente um fill BUY seguido de exatamente um fill SELL da mesma quantidade, ativo e agente.

`FillEvent BUY + FillEvent SELL → ClosedRoundTripResult`

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, os documentos de contexto, arquitetura, decisões e roadmap, `docs/coordination/CHATGPT_REVIEW_TASK_019.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/ledger/events.ts`, `src/metrics/summarize-execution-costs.ts`, `src/money/fixed-point.ts` e esta tarefa.

## Escopo exato

Crie `src/metrics/summarize-closed-round-trip.ts`.

Implemente uma função pura que:

- receba dois `FillEvent`: abertura BUY e fechamento SELL;
- valide fail-closed que pertencem ao mesmo agente, ativo, quote e escala;
- exija quantidades idênticas e timestamps canônicos com SELL estritamente posterior ao BUY;
- rejeite lados invertidos, fills repetidos e qualquer inconsistência estrutural relevante;
- calcule exclusivamente a partir de `totalMicros`: custo realizado do BUY, receita líquida do SELL e direção `WIN | LOSS | BREAK_EVEN`;
- devolva magnitude absoluta exata em micros, usando as primitivas monetárias existentes;
- devolva resultado imutável e auditável com IDs dos dois eventos.

## Regras obrigatórias

- Esta tarefa aceita somente um round trip integral; posição parcial, múltiplos lotes, FIFO/LIFO e short ficam fora do escopo.
- Não executar ordem, broker, risco, replay ou valoração.
- Não mutar entradas.
- Nenhum número de ponto flutuante.
- Nenhum relógio, aleatoriedade, rede ou I/O.
- Toda inconsistência gera `ContractValidationError`.
- Não adicionar dependência runtime.

## Testes obrigatórios

- ganho, perda e empate;
- diferença exata de 1 micro nos dois sentidos;
- fees já refletidas em `totalMicros`, sem dupla contagem;
- rejeição por agente, ativo, quote, escala ou quantidade divergentes;
- rejeição por lado invertido, mesmo evento, timestamp inválido/fora de ordem e dinheiro inválido;
- imutabilidade, não mutação e determinismo;
- testes offline.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Agregação de múltiplos trades, win rate, posição parcial, FIFO/LIFO, short, novas estratégias, execução, wallet externa, blockchain, testnet, corretora, credenciais, dinheiro real, cloud ou dashboard.

## Critérios de aceite

- resultado realizado correto, exato e auditável;
- somente aritmética inteira existente;
- validação fail-closed;
- resultado imutável e determinístico;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: resume round trip paper fechado`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
