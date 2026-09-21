# Tarefa atual

- **ID:** TASK-036
- **Milestone:** M4 — serialização canônica do resumo offline
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_035.md`

## Objetivo

Criar uma função pura que transforme o resumo auditável de ciclos finalizados em JSON canônico, determinístico e seguro para registro ou consumo visual futuro, sem realizar I/O:

```text
FinalizedAgentCyclesSummary
→ serializeFinalizedAgentCyclesSummary
→ canonical JSON string
```

A função apenas valida e serializa o contrato existente. Não grava arquivos, não cria dashboard, não executa agentes e não altera decisões.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_035.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/agent/summarize-finalized-agent-cycles.ts`, `src/agent/run-finalized-agent-cycles-with-summary.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/serialize-finalized-agent-cycles-summary.ts`.

Defina `serializeFinalizedAgentCyclesSummary`, que:

- recebe um `FinalizedAgentCyclesSummary`;
- valida em runtime uma estrutura fechada com exatamente os campos públicos já definidos;
- rejeita campos extras, inclusive não enumeráveis e `Symbol`;
- rejeita arrays esparsos, propriedades extras em arrays, getters e `Proxy` hostis;
- exige contagens inteiras seguras, não negativas e coerentes com os comprimentos das listas;
- exige que `total` seja a soma exata de `acceptedCount + holdCount + failedCount`;
- exige `itemId` válido e único entre todas as listas;
- preserva a ordem dos IDs em cada categoria;
- retorna JSON compacto com ordem fixa de chaves, sem espaços nem quebras de linha;
- produz saída idêntica para entradas campo a campo idênticas;
- falha fechada com erro público estável e sanitizado, sem incorporar valores, mensagens, stacks ou segredos da entrada;
- não muta nem congela a entrada;
- não usa `toJSON` fornecido pela entrada;
- não executa I/O nem consulta estado externo.

Reutilize os tipos e limites existentes. Não altere os contratos públicos do executor, finalizador, lote, resumo ou composição.

## Testes obrigatórios

- resumo válido produz exatamente o JSON canônico esperado;
- ordem fixa de chaves e ordem dos IDs são preservadas;
- mesmas entradas produzem bytes idênticos;
- contagens incompatíveis, total incompatível e IDs duplicados falham;
- objeto com campo extra enumerável, não enumerável ou `Symbol` falha;
- arrays vazios válidos são aceitos quando coerentes; arrays esparsos ou com propriedades extras falham;
- números negativos, fracionários, infinitos ou acima de `Number.MAX_SAFE_INTEGER` falham;
- getter, `Proxy`, `toJSON` hostil e erro forjado não executam código útil nem vazam segredo;
- entrada não é mutada;
- nenhuma chamada a agente, adapter, timer, relógio, aleatoriedade, HTTP, SDK, ambiente, persistência, filesystem ou I/O;
- toda a suíte anterior continua verde.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Não criar arquivo de auditoria, banco, persistência, download, endpoint, dashboard, gráfico, UI, ranking, comparação, votação, consenso, seleção de vencedor ou novo agregador.

Não usar HTTP, SDK externo, fila, timer, relógio, aleatoriedade, variável de ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora ou dinheiro real.

## Critérios de aceite

- serialização é canônica, compacta e determinística;
- validação é fechada, coerente e fail-closed;
- nenhuma propriedade controlada pela entrada é executada durante a serialização;
- erros não vazam dados da entrada;
- nenhuma mutação, I/O ou execução de agente;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: serializa resumo offline em json canonico`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
