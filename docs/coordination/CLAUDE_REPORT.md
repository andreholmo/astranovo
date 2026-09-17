# Relatório do Claude Code

## TASK-003 — Carteira, ledger e PaperBroker determinístico (M1)

- **ID da tarefa:** TASK-003
- **Milestone:** M1 — Carteira, ledger e PaperBroker
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-17

## Resumo da entrega

Núcleo contábil determinístico para N agentes: aritmética fixed-point em `bigint`, ledger append-only idempotente, carteiras isoladas derivadas por replay e `PaperBroker` puro com custos explícitos. Nenhuma conexão com Astra, mercado ao vivo, Risk Manager ou persistência em disco.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_002.md` e `TASK.md`.

## Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/money/fixed-point.ts` | criado |
| `src/domain/errors.ts` | criado |
| `src/domain/contracts.ts` | atualizado (`OrderIntent`, `ExecutionPolicy`, `orderIntentFromProposal`; erro extraído) |
| `src/ledger/events.ts` | criado |
| `src/ledger/ledger.ts` | criado |
| `src/portfolio/portfolio.ts` | criado |
| `src/broker/broker.ts` | criado |
| `src/broker/pricing.ts` | criado |
| `src/broker/paper-broker.ts` | criado |
| `tests/money.test.ts` | criado |
| `tests/ledger.test.ts` | criado |
| `tests/portfolio.test.ts` | criado |
| `tests/paper-broker.test.ts` | criado |
| `tests/support/fixtures.ts` | criado |
| `README.md` | atualizado (representação monetária, arredondamento, custos, ledger) |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero dependências de runtime.

## Representação monetária e arredondamento

Tudo centralizado em `src/money/fixed-point.ts`; nenhum outro módulo converte ou arredonda.

- Dinheiro: `bigint` em micros de USD (6 casas). Quantidades: `bigint` em unidades atômicas, com `assetScale` carregada junto. Preços: micros de quote por unidade inteira.
- Fronteira JSON: todo `bigint` é string decimal canônica — só dígitos, sem sinal, sem zeros à esquerda, sem expoente. `"01"`, `"+1"`, `"1.0"`, `"1e3"`, `"1_000"` e espaços são rejeitados, então duas strings nunca denotam o mesmo valor contábil.
- Arredondamento conservador, documentado em tabela no README e no cabeçalho do módulo: quantidade para baixo, valor pago para cima, valor recebido para baixo, fees para cima, frações truncadas em 6 casas.
- Duas políticas distintas e deliberadas de conversão a partir de `number`:
  - `microsFromUsdNumber` é **exata** — rejeita um orçamento que não caiba em 6 casas, porque uma verba configurada deve significar exatamente o que diz;
  - `fractionToMicros` **trunca** — `positionPct` é entrada de política, não dinheiro; uma proposta de `1/3` é um pedido legítimo de "um terço, tão perto quanto der", e truncar mantém o tamanho no máximo no que foi pedido.

## Modelo de custos

Metade do spread em cada lado mais o slippage integral, sempre contra o operador. O denominador é o dobro do denominador de bps, de modo que meio spread é exato em inteiros, sem arredondamento intermediário:

```text
BUY  efetivo = ceil (referência * (20000 + spreadBps + 2*slippageBps) / 20000)
SELL efetivo = floor(referência * (20000 - spreadBps - 2*slippageBps) / 20000)
fee          = ceil (gross * feeBps / 10000)
```

A quantidade máxima comprável é encontrada por **busca binária exata** sobre a função de custo (`ceil` do notional + `ceil` da fee), que é monotônica na quantidade. Uma divisão simples erraria por causa dos dois `ceil`; a busca binária dá o maior inteiro cujo custo total cabe no orçamento, o que é o que garante que uma compra de 100% nunca deixa caixa negativa.

## Comportamento verificado do PaperBroker

- **BUY** usa `positionPct` sobre o caixa disponível, incorpora spread, slippage e fee, reduz a quantidade determinísticamente até caber no caixa e rejeita quando a quantidade resultante é zero.
- **SELL** usa `positionPct` sobre a posição atual, nunca vende mais que a posição, rejeita ativo não detido e quantidade zero, e nunca gera caixa negativa.
- **HOLD** não chega ao broker: `orderIntentFromProposal` devolve `null`, então não existe ordem nem evento.
- O broker é uma função pura: recebe intent, carteira, política e instante, devolve um evento e **não** toca na carteira nem no ledger. É por isso que uma rejeição não pode alterar a contabilidade nem por acidente.

Códigos de rejeição estáveis: `INSUFFICIENT_CASH`, `QUANTITY_TOO_SMALL`, `NO_POSITION`, `COSTS_EXCEED_PRICE`, `COSTS_EXCEED_PROCEEDS`, `ASSET_SCALE_MISMATCH`.

## Ledger, idempotência e replay

- `eventId` é o hash SHA-256 (128 bits) da serialização canônica do próprio evento — chaves ordenadas, `bigint` como string. Dois processos que calculam o mesmo fill concordam sobre sua identidade sem coordenar.
- Mesmo `orderId` com conteúdo idêntico é **replay**: devolve o evento guardado, `appended: false`, e o ledger retornado é o mesmo objeto. Mesmo `orderId` com conteúdo diferente lança `LedgerConflictError` com código `ORDER_ID_CONFLICT`.
- `applyAppendResult` só aplica quando `appended` é `true`, então reprocessar uma ordem não move caixa duas vezes.
- Cada agente tem ledger independente; um append para um agente deixa os demais idênticos **por referência**, o que o teste verifica.
- `replayWallet` reconstrói exatamente o mesmo caixa e as mesmas posições. O teste de replay inclui deliberadamente uma rejeição na sequência, para provar que o replay a ignora.
- Invariantes verificadas a cada evento aplicado, não presumidas: caixa nunca negativa, posição nunca negativa, escala do ativo coerente. Um fill forjado que violasse qualquer uma delas lança erro — há teste para os três casos.

## Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **168 testes, 168 passaram, 0 falharam** |
| `git diff --cached --check` | sem erros de whitespace |

Ambiente local: Node v22.17.0, npm 10.9.2. A CI continua em Node 20 e 22, com `permissions: contents: read`.

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio (o instante de cada evento é injetado pelo chamador), nenhum uso de `random`.

## Fixtures

As fixtures são pequenas e conferíveis à mão: ativo com 2 casas decimais, uma unidade inteira custa exatamente US$10, carteira começa com US$100.

- Sem custos, US$100 compram 1000 atoms (10,00 unidades) e zeram o caixa.
- Com 1% de fee e 2% de spread, o preço de compra é US$10,10 e US$100 compram 980 atoms: gross 98.980.000, fee 989.800, total 99.969.800 micros — 981 atoms custariam 100.071.810, acima do caixa.
- Vendendo 490 atoms a US$9,90: gross 48.510.000, fee 485.100, líquido 48.024.900 micros.

## Decisões técnicas tomadas

1. **`ContractValidationError` extraído para `src/domain/errors.ts`.** `src/money` e `src/domain/contracts` precisam do mesmo erro; sem a extração haveria ciclo de import. `contracts.ts` reexporta a classe e `describeContractError`, então todo import existente continua válido e `instanceof` segue funcionando.
2. **Tipos `Micros` e `Atoms` são aliases de `bigint`, não tipos branded.** Branding daria checagem nominal, mas exigiria casts em toda operação aritmética. Como a tarefa exige centralizar as fórmulas — e elas estão todas em `src/money` e `src/broker/pricing.ts` — o alias documentado entrega a garantia pedida sem ruído. Se o revisor preferir branding nominal, é uma mudança contida nesses dois módulos.
3. **Busca binária para a quantidade comprável** em vez de divisão fechada, porque os dois `ceil` tornam a divisão levemente incorreta. Custo monotônico garante exatidão.
4. **Venda com resultado líquido zero é rejeitada** (`COSTS_EXCEED_PROCEEDS` quando `fee >= gross`), não executada. Entregar a posição por nada nunca deve ser simulado como sucesso.
5. **`MAX_POLICY_BPS = 10_000`** (100%) para fee, spread e slippage; `MAX_MICROS = 2^63-1` e `MAX_ATOMS = 2^96-1` como limites de sanidade contra overflow. Todos testados nos dois lados da fronteira.
6. **`policyVersion` adicionado à `ExecutionPolicy`.** A tarefa exige que o fill registre `policyVersion`; ele precisa vir de algum lugar, e a política é esse lugar.
7. **`totalMicros` em vez de um delta de caixa assinado.** Todo valor contábil permanece não negativo e a direção vem de `side`, o que mantém uma única convenção de sinal em todo o sistema.
8. **Posição zerada é removida da carteira**, para que duas carteiras sem nada comparem iguais; posições ficam ordenadas por ativo pelo mesmo motivo.

## Limitações conhecidas

- Apenas fill total ou rejeição: não há fill parcial, livro de ofertas nem modelo de liquidez.
- O modelo de custos é paramétrico e ainda não calibrado contra dados reais.
- O ledger vive em memória. Não há JSONL nem SQLite — o adaptador persistente é tarefa separada.
- Não há base de custo, P&L realizado nem marcação a mercado na carteira: métricas são M3.
- `ExecutionRequest` não valida que `intent.quote` corresponda a algum estado da carteira; o caixa é implicitamente USD nesta milestone.
- Não há Risk Manager: o broker aceita qualquer `OrderIntent` estruturalmente válido. Os limites de risco são M2.
- `fractionToMicros` trunca em 6 casas, então uma fração com mais precisão que isso é atendida com tamanho ligeiramente menor. É determinístico e conservador, mas é uma perda de precisão deliberada.

## Decisões pendentes para André / revisor

1. **Branding nominal de `Micros`/`Atoms`** — decisão técnica nº 2 acima.
2. **Metade do spread mais slippage integral** é o modelo de custo escolhido; a arquitetura permitia "metade do spread ou modelo explícito".
3. **Rejeitar venda de resultado líquido zero** — decisão técnica nº 4.
4. **`DEFAULT_EXECUTION_POLICY`** (10 bps de fee, 4 bps de spread, 5 bps de slippage) é um palpite conservador de partida, não um valor calibrado.
5. **Escala por ativo** hoje vem no `OrderIntent`; quando existir um registro de ativos, ela deve migrar para lá.

## Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

## Commit

- **Mensagem:** `feat: implementa carteira e paper broker deterministico`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.
