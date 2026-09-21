# Tarefa atual

- **ID:** TASK-034
- **Milestone:** M4 — resumo offline do lote finalizado
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_033.md`

## Objetivo

Criar uma transformação pura, determinística e offline que resuma o resultado já finalizado de N ciclos independentes em contagens e listas ordenadas de `itemId`:

```text
FinalizedAgentCycleBatchResults
→ summarizeFinalizedAgentCycles
→ total + ACCEPTED + HOLD + FAILED
```

O resumo serve somente para observabilidade e auditoria. Não classifica agentes, não compara desempenho, não vota, não escolhe proposta e não altera qualquer resultado.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_033.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/agent/run-finalized-agent-cycles.ts`, `src/agent/finalize-bounded-agent-attempts.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/summarize-finalized-agent-cycles.ts`.

Defina `FinalizedAgentCyclesSummary`, fechado e congelado, com exatamente:

- `total`;
- `acceptedCount`;
- `holdCount`;
- `failedCount`;
- `acceptedItemIds`;
- `holdItemIds`;
- `failedItemIds`.

Defina `summarizeFinalizedAgentCycles`, síncrona e pura, que:

- recebe a lista não vazia retornada por `runFinalizedAgentCycles`;
- revalida defensivamente a estrutura pública em runtime;
- classifica `COMPLETED/ACCEPTED`, `COMPLETED/HOLD` e `FAILED/AGENT_CYCLE_FAILED`;
- conta cada item exatamente uma vez;
- preserva a ordem original dentro de cada lista de IDs;
- garante `acceptedCount + holdCount + failedCount === total`;
- preserva `itemId` sem normalizar, gerar ou deduplicar silenciosamente;
- rejeita IDs duplicados, itens incompatíveis, uniões adulteradas, arrays esparsos e propriedades extras;
- rejeita propriedades próprias extras, inclusive não enumeráveis e `Symbol`;
- trata getters e `Proxy` de modo fail-closed, sem vazar mensagem, stack, payload ou segredo;
- não copia proposta, captura, avaliação ou texto livre para o resumo;
- congela o resumo e todas as listas;
- não muta a entrada.

Reutilize contratos e primitivas defensivas existentes onde forem adequados. Não recalcule tentativas nem resultados e não chame adapter ou finalizador.

## Testes obrigatórios

- lote misto com `ACCEPTED`, `HOLD` e `FAILED` produz contagens exatas;
- listas de IDs preservam a ordem da entrada;
- cada item aparece em exatamente uma lista e a soma das contagens é `total`;
- lotes contendo somente uma das três categorias funcionam;
- IDs duplicados, status/código incompatível, item adulterado, array vazio ou esparso falham fechados;
- propriedades extras enumeráveis, não enumeráveis e `Symbol` falham;
- getter/`Proxy` hostil, inclusive lançando `ContractValidationError` com segredo, não vaza conteúdo;
- array esparso com comprimento enorme é rejeitado sem alocação ou iteração proporcional ao comprimento declarado;
- saída e listas ficam congeladas;
- entrada não é mutada;
- mesmos dados produzem resultado campo a campo idêntico;
- nenhuma chamada a adapter, retry, finalizador, timer, relógio, aleatoriedade, HTTP, SDK, ambiente, persistência, Risk Manager, broker ou I/O;
- toda a suíte anterior continua verde.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Não criar ranking, pontuação, comparação de desempenho, agregação de propostas, votação, consenso, handoff, seleção de vencedor, retry, Risk Manager, PaperBroker, fill, carteira, ledger, persistência, provider de mercado ou integração Astra real.

Não usar HTTP, SDK externo, fila, timer, relógio, aleatoriedade, variável de ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora ou dinheiro real.

## Critérios de aceite

- resumo representa cada item exatamente uma vez;
- contagens e listas são coerentes e determinísticas;
- nenhuma proposta, captura, erro ou texto livre é propagado;
- entrada forjada falha fechada e sem vazamento;
- nenhuma geração implícita, ranking ou decisão;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: resume lote offline de ciclos finalizados`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
