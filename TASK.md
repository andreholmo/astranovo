# Tarefa atual

- **ID:** TASK-035
- **Milestone:** M4 — composição offline do lote finalizado com resumo
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_034.md`

## Objetivo

Criar a menor composição assíncrona e offline que execute um lote de ciclos finalizados e produza, junto dos resultados integrais, o resumo auditável já definido:

```text
FinalizedAgentCycleBatchInputs
→ runFinalizedAgentCycles
→ summarizeFinalizedAgentCycles
→ { results, summary }
```

A composição apenas encadeia contratos existentes. Não classifica agentes, não compara desempenho, não vota, não escolhe proposta e não altera resultados.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_034.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/agent/run-finalized-agent-cycles.ts`, `src/agent/summarize-finalized-agent-cycles.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/run-finalized-agent-cycles-with-summary.ts`.

Defina um resultado fechado e congelado com exatamente:

- `results`: a lista retornada por `runFinalizedAgentCycles`, preservada sem cópia semântica;
- `summary`: o valor retornado por `summarizeFinalizedAgentCycles`, coerente com `results`.

Defina `runFinalizedAgentCyclesWithSummary`, que:

- recebe exatamente o contrato público de entrada de `runFinalizedAgentCycles`;
- chama `runFinalizedAgentCycles` exatamente uma vez;
- chama `summarizeFinalizedAgentCycles` exatamente uma vez sobre o resultado produzido;
- preserva ordem, `itemId`, resultados `ACCEPTED | HOLD` e falhas isoladas `FAILED/AGENT_CYCLE_FAILED`;
- retorna objeto congelado, sem mutar entrada nem resultados;
- mantém as validações e sanitizações fail-closed dos módulos compostos;
- não captura nem transforma erro de validação em sucesso;
- não adiciona retry, concorrência, ranking, votação, decisão ou efeitos colaterais.

Reutilize os tipos e funções existentes; não duplique suas validações internas.

## Testes obrigatórios

- lote misto produz `results` integrais e `summary` coerente;
- ordem e identidades são preservadas nos dois campos;
- cada adapter é chamado somente o número já determinado por seu ciclo, sem segunda execução causada pelo resumo;
- uma falha isolada continua como `FAILED` e os demais itens continuam;
- entrada inválida antes da execução falha fechada sem chamar adapter;
- getter/`Proxy` hostil não vaza mensagem, stack, payload ou segredo;
- objeto externo fica congelado e os congelamentos internos existentes são preservados;
- entrada não é mutada;
- mesmos dados e adapters determinísticos produzem resultado campo a campo idêntico;
- nenhuma chamada adicional a timer, relógio, aleatoriedade, HTTP, SDK, ambiente, persistência, Risk Manager, broker ou I/O;
- toda a suíte anterior continua verde.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Não criar ranking, pontuação, comparação de desempenho, agregação de propostas, votação, consenso, handoff, seleção de vencedor, novo retry, Risk Manager, PaperBroker, fill, carteira, ledger, persistência, provider de mercado ou integração Astra real.

Não usar HTTP, SDK externo, fila, timer, relógio, aleatoriedade, variável de ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora ou dinheiro real.

## Critérios de aceite

- composição usa exatamente os dois módulos existentes, uma vez cada;
- `summary` corresponde integralmente a `results`;
- nenhuma execução de agente é repetida pelo resumo;
- falhas e validações continuam fail-closed e sem vazamento;
- nenhuma geração implícita, ranking ou decisão;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: compoe lote finalizado com resumo offline`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
