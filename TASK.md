# Tarefa atual

- **ID:** TASK-033
- **Milestone:** M4 — lote offline de ciclos independentes finalizados
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_032.md`

## Objetivo

Criar a menor composição assíncrona, determinística e offline que execute uma lista não vazia de ciclos de agente já finalizados, em ordem, isolando a falha de um item para que os demais continuem:

```text
readonly FinalizedAgentCycleBatchItem[]
→ runFinalizedAgentCycle (uma vez por item, em ordem)
→ COMPLETED | FAILED por item
→ readonly FinalizedAgentCycleBatchResult[]
```

Esta tarefa somente compõe ciclos individuais já revisados. Não agrega propostas, não vota, não escolhe vencedor, não chama Risk Manager ou broker e não compartilha carteira ou estado entre agentes.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_032.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/agent/run-finalized-agent-cycle.ts`, `src/agent/run-bounded-agent-attempts.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/run-finalized-agent-cycles.ts`.

Defina contratos fechados e congelados:

- `FinalizedAgentCycleBatchItem`: `itemId` explícito e `request` no contrato existente de `runFinalizedAgentCycle`;
- resultado `COMPLETED`: preserva `itemId` e o resultado final do ciclo sem remodelá-lo;
- resultado `FAILED`: preserva somente `itemId` e o código fechado `AGENT_CYCLE_FAILED`, sem mensagem, stack, payload ou objeto de erro;
- `FinalizedAgentCycleBatchResults`: lista readonly, congelada e na mesma ordem da entrada.

Defina `runFinalizedAgentCycles`, assíncrona, que:

- valida toda a estrutura do lote antes da primeira chamada a qualquer adapter;
- exige array não vazio, denso, sem propriedades extras, não enumeráveis ou `Symbol`;
- exige `itemId` string não vazia e única, sem gerar ou normalizar IDs;
- rejeita itens com propriedades extras, ausentes ou incompatíveis;
- executa os itens sequencialmente, na ordem recebida;
- chama `runFinalizedAgentCycle` exatamente uma vez por item;
- converte qualquer rejeição do ciclo em `FAILED/AGENT_CYCLE_FAILED` sem inspecionar, interpolar ou propagar o erro;
- continua para os itens seguintes após uma falha;
- nunca transforma falha em `COMPLETED`, `ACCEPTED` ou `HOLD`;
- preserva diretamente o resultado `ACCEPTED | HOLD` retornado em cada item `COMPLETED`;
- não muta entrada, requests, resultados nem listas;
- devolve objeto e lista congelados.

A validação estrutural do lote deve ser defensiva contra getters e `Proxy`: qualquer exceção originada por entrada não confiável vira `ContractValidationError` com mensagem constante e sem segredo. Reutilize contratos existentes; não duplique validação interna do request, retry ou finalização.

## Testes obrigatórios

- lote com um item aceito devolve um `COMPLETED/ACCEPTED`;
- lote com um item esgotado devolve um `COMPLETED/HOLD`;
- lote com três itens preserva ordem, `itemId` e resultados;
- cada ciclo e cada adapter são chamados exatamente o necessário, sem duplicação;
- falha sanitizada ou hostil em um item produz `FAILED/AGENT_CYCLE_FAILED` e os itens seguintes ainda executam;
- nenhuma mensagem, stack, segredo ou payload do erro aparece no resultado;
- entrada nula, array vazio, esparso, item inválido, `itemId` duplicado e propriedades extras falham antes da primeira chamada a adapter;
- propriedades extras não enumeráveis e `Symbol` falham fechadas;
- getters e `Proxy` que lançam, inclusive `ContractValidationError` malicioso, não vazam segredo;
- resultados, lista e itens ficam congelados;
- entradas não são mutadas;
- mesmos stubs e dados produzem resultado campo a campo idêntico;
- nenhuma chamada a timer, relógio, aleatoriedade, HTTP, SDK, ambiente, persistência, Risk Manager, broker ou I/O;
- toda a suíte anterior continua verde.

Use somente adapters stub locais e determinísticos. Não altere `StubAgentAdapter` nem contratos públicos existentes.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Não criar agregação, votação, consenso, handoff, seleção de proposta, compartilhamento de contexto, concorrência/paralelismo, Risk Manager, PaperBroker, fill, carteira, ledger, persistência, provider de mercado, integração Astra real, timeout, backoff ou agendamento.

Não usar HTTP, SDK externo, fila, timer, relógio, aleatoriedade, variável de ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora ou dinheiro real.

## Critérios de aceite

- cada item executa exatamente um ciclo individual já existente;
- ordem e identidade explícita são preservadas;
- falha de um item é sanitizada, auditável por código fechado e não impede os demais;
- entrada estrutural inválida bloqueia o lote inteiro antes de qualquer chamada externa;
- nenhuma geração implícita de dado e nenhuma duplicação material;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: executa lote offline de ciclos finalizados`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
