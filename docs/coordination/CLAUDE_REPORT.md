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

## TASK-004 — Gate determinístico de risco (primeira fatia de M2)

- **ID da tarefa:** TASK-004
- **Milestone:** M2 — Risk Manager determinístico, primeira fatia
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-18

### Resumo da entrega

Primeiro gate determinístico de risco pré-trade entre um `OrderIntent` já validado e o `PaperBroker`: `RiskPolicy` configurável, `RiskDecision` imutável com id determinístico e `evaluateRisk`, uma função pura que só aprova ou bloqueia — nunca executa o broker, nunca altera portfolio/ledger, nunca lê o relógio e não usa IA. Reutiliza integralmente `src/money/fixed-point.ts` para toda conversão/arredondamento e `src/portfolio/portfolio.ts` para ler a carteira; nenhuma fórmula monetária foi duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_003.md`, `docs/coordination/CHATGPT_REVIEW_AUTOMATION_002.md` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/risk/policy.ts` | criado — `RiskPolicy` e `parseRiskPolicy` |
| `src/risk/decision.ts` | criado — `RiskDecision`, códigos estáveis e `createRiskDecision` (id determinístico) |
| `src/risk/risk-manager.ts` | criado — `RiskRequest` e `evaluateRisk` |
| `tests/risk.test.ts` | criado |
| `README.md` | atualizado (seção "Risk Manager determinístico (primeira fatia)") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero dependências de runtime.

### Política mínima (`RiskPolicy`)

`policyVersion` não vazia, `allowedAssets` (allowlist de símbolos, pode ser vazia), `maxOrderPositionBps` e `maxAssetExposureBps` (0–10.000, validados com `parseBps` de `src/money/fixed-point.ts`), `maxOpenPositions` (inteiro não negativo) e `circuitBreaker` (booleano). Política inválida falha fechada no parse, com `ContractValidationError` nomeando o campo, igual às demais políticas do repositório. Perda diária, drawdown, cooldown, liquidez e janela de trades ficam fora desta fatia, conforme o escopo exato da tarefa.

### Regras e códigos estáveis

`CIRCUIT_BREAKER_ACTIVE`, `ASSET_NOT_ALLOWED`, `ORDER_SIZE_LIMIT_EXCEEDED`, `ASSET_EXPOSURE_LIMIT_EXCEEDED`, `MAX_OPEN_POSITIONS_REACHED` e `INVALID_RISK_INPUT` — nomes idênticos aos exigidos na tarefa. Quando mais de um dispara, `codes` os lista sempre na mesma ordem fixa (a ordem declarada em `RISK_RULE_CODES`), filtrando essa lista canônica em vez de acumular na ordem em que os testes rodaram — há teste dedicado que dispara as cinco regras ao mesmo tempo e verifica a ordem. `INVALID_RISK_INPUT` é sempre o único código quando aparece, pois nenhuma outra regra pode ser avaliada com confiança sobre um input não confiável.

Circuit breaker e allowlist bloqueiam BUY e SELL igualmente. Limite de tamanho de ordem (`ORDER_SIZE_LIMIT_EXCEEDED`) compara os basis points da própria fração pedida (`positionPct`, a mesma semântica de `OrderIntent`) contra `maxOrderPositionBps`, sem redimensionar a ordem. Exposição de ativo e número máximo de posições só se aplicam a BUY, exatamente como pedido ("SELL que reduz risco não é bloqueado").

### Exposição de ativo: baseline documentado

`ASSET_EXPOSURE_LIMIT_EXCEEDED` compara a exposição projetada após uma BUY contra `maxAssetExposureBps`, usando caixa somado à posição atual do próprio ativo (avaliada em `intent.referencePriceMicros`) como base — não o patrimônio total do portfolio, porque esta fatia não recebe preço de nenhum outro ativo que a carteira possa deter. Isso está documentado no cabeçalho de `src/risk/risk-manager.ts` e no README como limitação deliberada, não uma omissão silenciosa.

### Arredondamento

Todo bps calculado aqui arredonda contra o operador (para cima quando arredondar para baixo poderia esconder uma violação de limite), na mesma linha conservadora documentada em `src/money/fixed-point.ts`. `positionPct` é convertido com `fractionToMicros` (truncamento em 6 casas, já usado por `PaperBroker`) antes de virar bps com `mulDivCeil`.

### Isolamento entre agentes

`evaluateRisk` recebe apenas a `Wallet` de um agente, nunca o `Portfolio` inteiro — o isolamento é estrutural, não apenas testado: não existe caminho de código para ler ou alterar a carteira de outro agente.

### `RiskDecision` e determinismo

`id` é um hash sha256 (128 bits, 32 caracteres hex) do conteúdo canônico do próprio `RiskDecision`, com chaves ordenadas — a mesma receita de `computeEventId` em `src/ledger/events.ts`, reproduzida localmente em `src/risk/decision.ts` porque essa função não é exportada de lá e a tarefa não autoriza alterar `src/ledger/`. Mesmo input canônico, política e timestamp produzem sempre o mesmo id; o teste de identidade também prova que a ordem em que os campos do rascunho foram escritos não influencia o hash, como já feito em `tests/ledger.test.ts`. A decisão e o array `codes` são devolvidos congelados.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **194 testes, 194 passaram, 0 falharam** (168 preexistentes + 26 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio (`evaluatedAt` é sempre injetado pelo chamador), nenhum uso de `random`.

### Testes cobertos em `tests/risk.test.ts`

Política válida e rejeição de cada campo inválido; circuit breaker (BUY e SELL); ativo permitido e não permitido; limite de tamanho de ordem exatamente na fronteira e acima; exposição de ativo exatamente na fronteira e acima, com e sem posição prévia; SELL não bloqueado por exposição/número de posições; nova posição com limite livre e limite atingido; BUY em posição já existente não conta como nova; múltiplas violações simultâneas em ordem determinística; três cenários de input inconsistente (agente divergente, timestamp não canônico, escala de ativo divergente da posição detida) falhando fechado; id determinístico e estável quanto à ordem dos campos; decisão e `codes` congelados; nenhuma mutação de wallet/intent; isolamento entre agentes via `Portfolio`.

### Decisões técnicas tomadas

1. **Hash de `RiskDecision.id` duplicado localmente em vez de importado de `src/ledger/events.ts`.** A função `computeEventId`/`canonicalJson` não é exportada de lá, e a tarefa restringe o escopo à criação de `src/risk/`; alterar as exportações do ledger seria ampliar escopo. A receita (sha256 de JSON com chaves ordenadas, 32 hex) é intencionalmente idêntica, documentada como tal no cabeçalho de `src/risk/decision.ts`.
2. **`maxOrderPositionBps` mede a fração da própria ordem (`positionPct`), não uma fração de patrimônio calculada com preços de mercado.** É a interpretação mais simples e autocontida compatível com "reutilize os contratos... não duplique conversões monetárias": usa só `intent.positionPct`, sem precisar de dados de mercado adicionais.
3. **Baseline de exposição = caixa + posição do próprio ativo, ambos ao `referencePriceMicros` da ordem.** Documentado como limitação, não como cálculo de patrimônio total do portfolio, porque nenhum outro preço está disponível no contexto mínimo desta fatia.
4. **`INVALID_RISK_INPUT` é exclusivo e checado antes de qualquer outra regra.** Uma vez que o agente da carteira diverge do agente da ordem, ou a escala de uma posição detida diverge da ordem, nenhuma outra regra pode ser calculada com significado, então nenhuma outra roda.
5. **`RiskPolicy` valida com um parser local no mesmo estilo hand-rolled de `src/domain/contracts.ts`**, reaproveitando apenas `parseBps` de `src/money/fixed-point.ts` para os campos em basis points; nenhuma dependência nova (como um validador de schema) foi adicionada.
6. **`evaluateRisk` recebe uma `Wallet`, nunca um `Portfolio`.** Garante isolamento entre agentes por construção, não apenas por convenção testada.

### Limitações conhecidas

- Exposição de ativo não considera o valor de outros ativos detidos pela carteira — depende de dados de mercado que esta fatia não recebe; ver "Exposição de ativo" acima.
- Nenhuma checagem de suficiência de caixa é feita aqui: isso permanece responsabilidade do `PaperBroker` (`INSUFFICIENT_CASH`), que roda depois da aprovação do risco.
- Não há perda diária, drawdown, cooldown, liquidez, spread/slippage máximo ou janela de trades — são fatias futuras de M2, fora do escopo exato da TASK-004.
- O Risk Manager não é chamado automaticamente antes do `PaperBroker`; essa integração de pipeline é trabalho futuro, não desta tarefa.

### Decisões pendentes para André / revisor

1. **Interpretação de `maxOrderPositionBps`** — decisão técnica nº 2 acima; se o arquiteto pretendia outra base (ex.: fração do patrimônio total), é ajuste contido em `src/risk/risk-manager.ts`.
2. **Baseline de exposição de ativo** — decisão técnica nº 3; alternativa exigiria mais contexto de mercado (preços de outros ativos) do que a tarefa autoriza receber nesta fatia.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. As duas decisões acima foram resolvidas com a interpretação mais simples e mais bem documentada, dentro do "contexto determinístico mínimo necessário à avaliação" pedido pela tarefa, e ficam registradas para revisão.

### Commit

- **Mensagem:** `feat: implementa gate deterministico de risco`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

### Correção — revisão técnica ciclo 1/3 (sobre o SHA `d26aa50`)

A revisão do ChatGPT/GPT-5.6 Sol apontou uma violação do critério fail-closed: em `projectedAssetExposureBps`, quando `wallet.cashMicros + heldValueMicros === 0n` (caixa zero e nenhuma posição detida), a função retornava `0n` em vez de sinalizar que `projectedValue / equity` é indefinido. Uma BUY partindo desse estado era aprovada com exposição "0%", quando a razão simplesmente não pode ser avaliada.

**Correção mínima em `src/risk/risk-manager.ts`:** `hasEvaluableInput` agora rejeita fail-closed, com `INVALID_RISK_INPUT`, toda BUY cujo baseline de exposição (caixa + valor da posição no próprio ativo) seja zero — antes de qualquer regra rodar, na mesma linha das demais checagens de admissibilidade (agente divergente, timestamp não canônico, escala de posição divergente). `projectedAssetExposureBps` deixa de precisar do guarda `equityMicros === 0n` (agora inatingível, já que só é chamada para BUY e só depois que `hasEvaluableInput` garante baseline não nulo) e passa a reaproveitar um novo helper `heldValueMicros`, compartilhado com `hasEvaluableInput`, em vez de duplicar o cálculo do valor da posição detida.

Teste novo em `tests/risk.test.ts`, no describe `fail-closed on inconsistent input`: carteira com `cashMicros = 0n` e nenhuma posição, ordem BUY padrão — `evaluateRisk` devolve `approved: false` e `codes: ["INVALID_RISK_INPUT"]`.

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **195 testes, 195 passaram, 0 falharam** (194 preexistentes + 1 novo) |

Nenhuma integração, dependência, wallet externa, corretora, testnet, credencial ou dinheiro real foi adicionada. Pureza, determinismo, imutabilidade e isolamento entre agentes preservados.

- **Commit:** `fix: rejeita BUY fail-closed quando baseline de exposicao e zero`
- **Hash:** informado a André na resposta após o push.

## TASK-005 — Integração determinística risco → execução paper (M2)

- **ID da tarefa:** TASK-005
- **Milestone:** M2 — integração determinística Risk Manager → PaperBroker
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-18

### Resumo da entrega

Fachada mínima e pura, `executePaperOrderWithRisk`, que torna explícita a sequência
obrigatória `OrderIntent validado → evaluateRisk → bloqueio OU PaperBroker.execute`. Não
reimplementa nenhuma regra de risco ou de execução: reutiliza `evaluateRisk`/`RiskDecision`
de `src/risk/`, `Broker`/`ExecutionOutcome` de `src/broker/broker.ts` e os contratos de
`src/domain/contracts.ts` e `src/portfolio/portfolio.ts` sem alterar nenhum deles. Não
aplica evento ao ledger/portfolio nesta tarefa — o `RiskDecision` rejeitado já é o registro
estruturado do bloqueio, e um fill/rejeição aprovado pelo broker é devolvido ao chamador
para essa decisão aplicar.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_004.md`,
`docs/coordination/CLAUDE_REPORT.md` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/execution/execute-paper-order-with-risk.ts` | criado — `executePaperOrderWithRisk`, `ExecutePaperOrderWithRiskRequest`, `ExecutePaperOrderWithRiskResult` |
| `tests/execution.test.ts` | criado |
| `README.md` | atualizado (seção "Integração determinística risco → execução paper") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com
zero dependências de runtime.

### Design da fachada

`executePaperOrderWithRisk` recebe `intent`, `wallet`, `riskPolicy`, `executionPolicy`,
`broker`, `evaluatedAt` (instante do `RiskDecision`) e `occurredAt` (instante do evento do
broker) — dois timestamps canônicos distintos, ambos injetados pelo chamador, nunca lidos
do relógio do sistema. Sequência interna, sem desvio possível:

1. Valida `broker.kind === "paper"` **antes** de qualquer avaliação ou execução; qualquer
   outro valor lança `Error` de imediato e o broker não é tocado.
2. Chama `evaluateRisk` exatamente uma vez.
3. Se `riskDecision.approved === false`, devolve `{ status: "RISK_REJECTED", riskDecision }`
   congelado; o broker nunca é chamado.
4. Se aprovado, chama `broker.execute` exatamente uma vez com o mesmo `intent`, `wallet`,
   `executionPolicy` e `occurredAt` recebidos, e devolve
   `{ status: "BROKER_EXECUTED", riskDecision, executionOutcome }` congelado, onde
   `executionOutcome` é exatamente o que o broker calculou — sem transformação.

Exceções inesperadas de `evaluateRisk` ou de `broker.execute` não são capturadas: propagam
para o chamador, para que uma falha real nunca seja disfarçada de resultado estruturado.

### Testes cobertos em `tests/execution.test.ts`

Circuit breaker, ativo fora da allowlist e input de risco inválido (agente divergente)
produzindo `RISK_REJECTED` com um broker duplo que lança erro se chamado (prova de zero
chamadas); decisão aprovada chamando um broker-spy exatamente uma vez com o mesmo intent,
carteira, política de execução e instante recebidos; BUY e SELL aprovados preservando
exatamente o `ExecutionOutcome` que uma chamada direta ao `PaperBroker` com o mesmo request
produz; uma rejeição nativa do `PaperBroker` (`NO_POSITION`, numa SELL sem posição que o
Risk Manager aprova) preservada como `BROKER_EXECUTED` com `executionOutcome.status ===
"REJECTED"`; um broker com `kind !== "paper"` lançando erro fail-closed sem ser chamado;
congelamento do resultado e do `ExecutionOutcome`/evento aninhados; ausência de mutação de
intent, carteira e políticas; ausência de qualquer efeito sobre a carteira recebida (prova
de que nenhum evento é aplicado); isolamento entre dois agentes; determinismo do resultado
completo para o mesmo input canônico; `riskDecision` devolvido idêntico a uma chamada
direta de `evaluateRisk` com o mesmo request, evidenciando avaliação única; uso independente
de `evaluatedAt` e `occurredAt` quando os dois instantes recebidos diferem.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **211 testes, 211 passaram, 0 falharam** (195 preexistentes + 16 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio (ambos os
instantes são injetados pelo chamador em todo teste), nenhum uso de `random`.

### Decisões técnicas tomadas

1. **Dois timestamps distintos (`evaluatedAt`, `occurredAt`) em vez de um único instante
   compartilhado.** A tarefa pede "timestamps canônicos injetados pelo chamador" (plural) e
   `RiskRequest.evaluatedAt`/`ExecutionRequest.occurredAt` já são campos semanticamente
   distintos nos módulos reutilizados; duplicar um único nome exigiria escolher um dos dois
   nomes existentes ou inventar um terceiro. Passar os dois nomes originais deixa explícito
   qual instante vai para qual registro, sem perder a possibilidade de o chamador usar o
   mesmo valor para ambos quando quiser.
2. **Falha no `kind` do broker lança `Error`, não devolve uma variante do resultado.** Um
   broker de `kind` incorreto é um erro de configuração do chamador — nunca uma decisão de
   negócio sobre a ordem — e seria uma terceira variante fora das duas que a tarefa define
   (`RISK_REJECTED`, `BROKER_EXECUTED`). `PaperBroker.execute` já lança `Error` (não
   `ContractValidationError`) para a mesma classe de problema (agente do intent divergente
   do agente da carteira), então lançar aqui segue a mesma convenção já estabelecida no
   repositório para invariantes estruturais quebradas pelo chamador, não pelo dado.
3. **A verificação de `kind` acontece antes de `evaluateRisk`.** A tarefa pede
   explicitamente que a implementação "valide `broker.kind === 'paper'` antes de qualquer
   avaliação/execução". Como consequência, quando o broker é rejeitado por `kind`, o Risk
   Manager não chega a ser avaliado nessa chamada — o que não conflita com "avaliar o risco
   exatamente uma vez por chamada", já que essa chamada nunca chega a produzir um resultado
   estruturado.
4. **Nenhum novo código de erro/rejeição foi criado.** A fachada devolve apenas o que
   `evaluateRisk` e o `PaperBroker` já produzem; não há terceiro tipo de rejeição nem evento
   de ledger inventado para a rejeição de risco, exatamente como a tarefa exige.

### Limitações conhecidas

- A fachada não aplica o `ExecutionOutcome`/`RiskDecision` a nenhum ledger ou portfolio;
  isso permanece responsabilidade explícita do chamador, fora do escopo desta tarefa.
- Não há retry, idempotência de chamada dupla ou proteção contra o chamador invocar a
  fachada duas vezes para o mesmo `orderId`; a idempotência por `orderId` já existe no
  ledger (`src/ledger/ledger.ts`) e continua sendo responsabilidade de quem aplica o
  resultado, não desta fachada.
- Como no Risk Manager, a fachada não redimensiona uma ordem acima do limite de risco: ela
  é aprovada inteira ou rejeitada inteira.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as quatro decisões acima têm alternativa
única e mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: integra risco ao fluxo de execucao paper`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-006 — Liquidação contábil determinística do paper trade (M2)

- **ID da tarefa:** TASK-006
- **Milestone:** M2 — liquidação contábil determinística do paper trade
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-18

### Resumo da entrega

Menor fatia contábil do pipeline paper: `executePaperOrderWithRisk → evento do
PaperBroker → append idempotente no ledger → carteira derivada`. `settlePaperExecution`
recebe o `ExecutePaperOrderWithRiskResult` já produzido, a carteira imutável do mesmo
agente e seu `AgentLedger`, e aplica exatamente a contabilidade que esse resultado implica
— nunca chama `evaluateRisk`, `Broker.execute` ou `PaperBroker.execute` de novo. Reutiliza
integralmente `AgentLedger.append` e `applyAppendResult` de `src/ledger/ledger.ts` e
`src/portfolio/portfolio.ts`; nenhuma regra de idempotência ou de invariante de carteira foi
duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`,
`docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`,
`docs/coordination/CHATGPT_REVIEW_TASK_005.md`, `docs/coordination/CLAUDE_REPORT.md` e
`TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/execution/settle-paper-execution.ts` | criado — `settlePaperExecution`, `SettlePaperExecutionRequest`, `SettlePaperExecutionResult` |
| `tests/settle-paper-execution.test.ts` | criado |
| `README.md` | atualizado (seção "Liquidação contábil da execução paper") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com
zero dependências de runtime.

### Design de `settlePaperExecution`

Recebe `{ executionResult, wallet, ledger }` e devolve uma união discriminada, imutável e
congelada:

1. **`RISK_REJECTED`** — quando `executionResult.status === "RISK_REJECTED"`: nenhum evento
   é criado ou anexado; a mesma instância de `wallet` e a mesma instância de `ledger`
   recebidas são devolvidas por referência. Uma rejeição de risco nunca vira evento
   contábil.
2. **`BROKER_RECORDED`** — quando o Risk Manager aprovou e o `PaperBroker` produziu um
   `ExecutionOutcome`: anexa exatamente `executionOutcome.event` (fill **ou** rejeição do
   broker) ao `AgentLedger` recebido via `ledger.append`, deriva a carteira resultante via
   `applyAppendResult`, e devolve o `executionResult` original, o evento canônico
   armazenado, o novo ledger, a carteira resultante e `appended: boolean`.

Validação estrutural antes de qualquer append: `wallet.agentId` deve ser igual a
`ledger.agentId`, ou a função lança `Error` de imediato — na mesma convenção de erro puro já
usada em `PaperBroker.execute` e `executePaperOrderWithRisk` para preconditions de
configuração do chamador, não de dado de negócio. A divergência entre o agente do **evento**
e o agente do **ledger** não é checada aqui de novo: `AgentLedger.append` já lança
`LedgerAgentMismatchError` fail-closed para esse caso, e reimplementar a checagem seria
duplicar uma regra existente.

Toda a semântica de idempotência e de efeito contábil vem, sem alteração, dos módulos
reutilizados:

- **replay idêntico** do mesmo `orderId` — `ledger.append` reconhece o evento já registrado,
  devolve `appended: false`, a mesma instância de ledger e o mesmo evento por referência;
  `applyAppendResult` não aplica o evento de novo, então a carteira devolvida é exatamente a
  instância recebida — nenhum segundo efeito contábil;
- **conflito** do mesmo `orderId` com conteúdo diferente — `ledger.append` lança
  `LedgerConflictError`, propagada sem captura;
- **rejeição do PaperBroker** — é anexada ao ledger como qualquer outro evento (para que a
  tentativa fique auditável), mas `applyEvent`/`applyAppendResult` nunca movem caixa ou
  posição para um `RejectionEvent`, então a carteira devolvida é a mesma referência recebida,
  mesmo quando `appended` é `true` nesse primeiro append.

### Testes cobertos em `tests/settle-paper-execution.test.ts`

`RISK_REJECTED` sem eventos e com wallet/ledger preservados por referência; BUY preenchida
com caixa e posição atualizados uma vez; SELL preenchida com caixa e posição atualizados uma
vez; rejeição do `PaperBroker` anexada ao ledger com wallet preservada por referência; replay
idêntico com `appended: false`, mesmo evento e mesma carteira por referência; conflito do
mesmo `orderId` com conteúdo diferente lançando `LedgerConflictError`; wallet e ledger de
agentes diferentes falhando fechado antes de qualquer append; evento pertencente a outro
agente falhando fechado via `LedgerAgentMismatchError` do próprio ledger; isolamento entre
dois agentes; congelamento do resultado, do ledger, da carteira e do evento; ausência de
mutação do `executionResult`, da carteira e do ledger recebidos; determinismo do resultado
completo para o mesmo input canônico; uso independente de `evaluatedAt`/`occurredAt` através
do evento liquidado. Os cenários principais (BUY, SELL, rejeição do broker) usam o
`PaperBroker` real via `executePaperOrderWithRisk`; um evento com `agentId` de outro agente é
construído manualmente com `createFillEvent`, porque esse cenário de dado inconsistente não
pode ser produzido por um fluxo real e válido.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **225 testes, 225 passaram, 0 falharam** (211 preexistentes + 14 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio (todo
instante é injetado pelo chamador em cada teste), nenhum uso de `random`.

### Decisões técnicas tomadas

1. **Nome do resultado `BROKER_RECORDED`, não `BROKER_EXECUTED`.** `TASK.md` usa os dois
   nomes em seções diferentes: a definição formal da união discriminada (`## Escopo exato`)
   nomeia o segundo membro `BROKER_RECORDED`, enquanto uma frase isolada em `## Regras
   obrigatórias` ("Em `BROKER_EXECUTED`, registrar exatamente `executionOutcome.event`")
   reaproveita o nome já usado pela TASK-005 para a variante análoga de
   `ExecutePaperOrderWithRiskResult`. Interpretei isso como uma inconsistência de redação
   entre as duas seções do mesmo documento, não uma ambiguidade material: as duas frases
   descrevem inequivocamente o mesmo ramo (o caso em que o broker produziu um evento).
   Adotei `BROKER_RECORDED`, o nome do cabeçalho que define formalmente o tipo, porque
   `settlePaperExecution` e `executePaperOrderWithRisk` são funções e resultados distintos —
   reusar `BROKER_EXECUTED` para os dois tipos diferentes teria sido mais confuso, não menos.
   Se o arquiteto pretendia `BROKER_EXECUTED` aqui também, é um `rename` de um único
   identificador de tipo, sem qualquer mudança de comportamento.
2. **A validação estrutural de agente (`wallet.agentId === ledger.agentId`) roda
   incondicionalmente, mesmo em `RISK_REJECTED`.** A tarefa pede a checagem "antes de
   qualquer append", o que tecnicamente só se aplica ao ramo `BROKER_RECORDED`. Preferi
   validar sempre porque é uma invariante estrutural do próprio `SettlePaperExecutionRequest`
   — um chamador que passa carteira e ledger de agentes diferentes está com um bug de
   fiação, independentemente do resultado de risco que está liquidando — e falhar fechado
   cedo é mais seguro do que só falhar quando o caminho de código específico é exercitado.
3. **Erro de agente divergente é um `Error` simples, não uma subclasse dedicada.** Segue a
   mesma convenção já usada em `PaperBroker.execute` (agente do intent divergente do agente
   da carteira) e em `executePaperOrderWithRisk` (broker de `kind` incorreto): um erro de
   configuração do chamador, não uma decisão de negócio sobre a ordem, então não é uma
   terceira variante do resultado estruturado.
4. **O evento de uma rejeição do `PaperBroker` é anexado ao ledger mesmo não alterando a
   carteira.** A tarefa exige "rejeição do PaperBroker deve entrar no ledger, mas manter a
   carteira inalterada por referência" — isso já é exatamente o que `applyEvent` faz para
   `RejectionEvent` (devolve a mesma instância de carteira), então nenhuma ramificação
   adicional foi necessária em `settlePaperExecution`: o mesmo caminho de código que
   trata um fill trata uma rejeição do broker.
5. **Nenhuma nova classe de erro foi criada.** `LedgerConflictError` e
   `LedgerAgentMismatchError`, já existentes em `src/ledger/ledger.ts`, cobrem os dois casos
   de fail-closed exigidos pela tarefa (conflito de `orderId` e evento de agente
   divergente); criar um alias ou uma subclasse local duplicaria uma regra existente sem
   necessidade.

### Limitações conhecidas

- `settlePaperExecution` opera sobre o `AgentLedger` de um único agente, não sobre o
  `Ledger` agregando todos os agentes; um chamador que precise atualizar o `Ledger`
  multiagente precisa extrair e recompor o `AgentLedger` do agente correspondente — essa
  orquestração fica fora do escopo desta fatia.
- Não há persistência em arquivo: o ledger e a carteira liquidados continuam em memória,
  exatamente como nas milestones anteriores.
- Nenhum pipeline automático chama `settlePaperExecution` após
  `executePaperOrderWithRisk`; essa fiação de ciclo completo é trabalho futuro.

### Decisões pendentes para André / revisor

1. **Nome `BROKER_RECORDED` vs. `BROKER_EXECUTED`** — decisão técnica nº 1 acima; peço
   confirmação explícita do arquiteto sobre qual nome é o pretendido, já que `TASK.md` usa
   os dois.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. A única inconsistência textual encontrada em `TASK.md` (decisão técnica
nº 1) foi resolvida com a leitura mais literal da definição formal do tipo, e registrada
acima para revisão — não interrompi a execução da tarefa por ela, por não afetar
comportamento, testes ou critérios de aceite.

### Commit

- **Mensagem:** `feat: liquida execucao paper no ledger`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.


## TASK-007 — Valoração de patrimônio sem look-ahead (primeira fatia de M3)

- **ID da tarefa:** TASK-007
- **Milestone:** M3 — valoração determinística sem look-ahead, primeira fatia
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-18

### Resumo da entrega

Menor base de métricas do replay: `valueWalletAt` calcula um `EquityPoint` imutável e
auditável — patrimônio de uma `Wallet` num único instante, usando somente
`MarketSnapshot`s completos, em USD, que já estavam disponíveis em `valuedAt`. Não calcula
série temporal, P&L, drawdown, win rate ou benchmark; essa fatia valora apenas um instante,
como o escopo exato da tarefa exige. Reutiliza integralmente `parseMarketSnapshot(snapshot,
{ notAfter: valuedAt })` para a prova de disponibilidade/anti-look-ahead e
`microsFromUsdNumber`, `scaleFactor`, `mulDivFloor`, `addBounded` e `MAX_MICROS` de
`src/money/fixed-point.ts` para toda a aritmética; nenhuma fórmula monetária foi
duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`,
`docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`,
`docs/coordination/CHATGPT_REVIEW_TASK_006.md`, `docs/coordination/CLAUDE_REPORT.md` e
`TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/metrics/value-wallet-at.ts` | criado — `valueWalletAt`, `EquityPoint`, `PositionValuation` |
| `tests/value-wallet-at.test.ts` | criado |
| `README.md` | atualizado (seção "Valoração de patrimônio sem look-ahead") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com
zero dependências de runtime.

### Design de `valueWalletAt`

Recebe `{ wallet, valuedAt, snapshots }`, onde `snapshots` é uma lista de valores não
validados (a mesma forma "software valida" já usada em todo o repositório), em qualquer
ordem. Para cada entrada:

1. `parseMarketSnapshot(raw, { notAfter: valuedAt })` valida o schema e prova, sem regra
   duplicada, que `availableAt <= valuedAt` — dado futuro é rejeitado nessa chamada, não
   depois;
2. regras específicas desta fatia, que `parseMarketSnapshot` não impõe porque são
   estruturalmente válidas para um `MarketSnapshot` isolado: `complete === true`,
   `quote === "USD"`, o ativo precisa ser um que a carteira detém, e não pode haver dois
   snapshots para o mesmo ativo — qualquer violação falha fechado imediatamente, sem
   escolher silenciosamente um snapshot ou ignorar o excedente.

Depois de validado o conjunto, cada posição da carteira (`wallet.positions`, já ordenada
por ativo por invariante de `src/portfolio/portfolio.ts`) precisa ter exatamente um
snapshot correspondente — a ausência falha fechada. O preço vem de
`microsFromUsdNumber(snapshot.price, ...)`, que rejeita precisão incompatível com seis
casas decimais em vez de arredondar; o valor da posição é
`mulDivFloor(quantityAtoms, priceMicros, scaleFactor(assetScale))`; a soma usa
`addBounded(..., MAX_MICROS, ...)`, que falha fechado em overflow. `equityMicros` é
`addBounded(cashMicros, positionsValueMicros, MAX_MICROS, ...)`.

Como a saída é construída iterando `wallet.positions` (já canonicamente ordenada), a ordem
em que `snapshots` foi fornecida nunca influencia `positions` nem `snapshotIds` no
resultado — só influencia qual violação é detectada primeiro quando a entrada é inválida.

### Testes cobertos em `tests/value-wallet-at.test.ts`

Carteira somente em caixa com lista vazia e `equityMicros === cashMicros`; uma posição
corretamente valorada com evidência de preço auditável; duas posições com soma correta;
mesmo conjunto de snapshots em ordens diferentes produzindo resultado idêntico; floor
conservador com resto genuíno (`floor(1 * 3_333_333 / 100) = 33_333`, não 33_334); snapshot
disponível exatamente em `valuedAt` aceito; snapshot disponível depois de `valuedAt`
rejeitado; snapshot incompleto rejeitado; `quote` diferente de USD rejeitado; posição sem
snapshot correspondente rejeitada; snapshot duplicado para o mesmo ativo rejeitado;
snapshot de ativo não possuído pela carteira rejeitado; preço com sete casas decimais
falhando fechado; overflow na soma de valores falhando fechado; congelamento do
`EquityPoint`, de `positions` e de cada `PositionValuation`; ausência de mutação da
carteira e dos snapshots recebidos; isolamento entre dois agentes; determinismo para o
mesmo input canônico.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **243 testes, 243 passaram, 0 falharam** (225 preexistentes + 18 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio
(`valuedAt` é sempre injetado pelo chamador), nenhum uso de `random`.

### Decisões técnicas tomadas

1. **`isCanonicalTimestamp` duplicado localmente**, com o mesmo padrão regex e a mesma
   checagem de round-trip por `Date` já usadas em `src/domain/contracts.ts` (privada, não
   exportada) e duplicadas de novo em `src/risk/risk-manager.ts`. O escopo exato desta
   tarefa é criar `src/metrics/`, não alterar as exportações de `src/domain/contracts.ts`;
   a duplicação de uma checagem de formato de três linhas segue o precedente já registrado
   na TASK-004 (hash de `RiskDecision.id` duplicado pelo mesmo motivo).
2. **`complete`, `quote === "USD"`, "um snapshot por ativo detido" e "rejeitar ativo não
   detido" são verificados aqui, não em `parseMarketSnapshot`.** Um `MarketSnapshot`
   isolado com `complete: false` ou `quote: "EUR"` é estruturalmente válido — só se torna
   inadmissível no contexto de *valorar esta carteira*. Colocar a regra em
   `src/domain/contracts.ts` alteraria o contrato para todo consumidor futuro de
   `MarketSnapshot` que não valora patrimônio (ex.: um adaptador que só precisa do preço
   bruto), o que amplia escopo além desta fatia.
3. **A saída é construída iterando `wallet.positions`, nunca a lista `snapshots` recebida.**
   `Wallet.positions` já é canonicamente ordenada por ativo (invariante de
   `src/portfolio/portfolio.ts`), então reaproveitar essa ordem entrega "a ordem de entrada
   não altera o resultado" sem precisar ordenar nada aqui, e sem duplicar a comparação de
   string usada em `withPosition`.
4. **Nenhuma classe de erro nova.** Toda rejeição usa `rejectContract`/
   `ContractValidationError`, o mesmo mecanismo de todo o resto do repositório
   (`src/domain/contracts.ts`, `src/money/fixed-point.ts`, `src/portfolio/portfolio.ts`);
   um código de motivo estilo `RiskDecision.codes` não foi pedido pela tarefa e teria sido
   uma abstração nova sem necessidade demonstrada.
5. **O teste de overflow constrói uma `Wallet` diretamente com um objeto literal, em vez de
   produzi-la por um fluxo real do `PaperBroker`.** Nenhuma compra real pode alcançar um
   valor de posição que exceda `MAX_MICROS`, porque o próprio broker e `MAX_ATOMS`/
   `MAX_PRICE` já limitam isso antes de chegar aqui; o mesmo padrão já foi usado na
   TASK-006 para forjar um evento de agente inconsistente que "não pode ser produzido por
   um fluxo real e válido".

### Limitações conhecidas

- Valora um único instante; não existe série temporal, P&L, drawdown, win rate ou
  benchmark — são fatias futuras de M3, fora do escopo exato desta tarefa.
- Não há seleção automática do snapshot mais recente nem tolerância de "quase o mesmo
  instante": o chamador precisa fornecer exatamente um snapshot por ativo detido.
- Não há verificação de frescor (staleness) além do anti-look-ahead: um snapshot com
  `availableAt` muito anterior a `valuedAt`, mas ainda `<= valuedAt`, é aceito.
- Não persiste nada em arquivo; o `EquityPoint` vive apenas em memória, como as milestones
  anteriores.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as cinco decisões acima têm alternativa
única e mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: calcula patrimonio sem look-ahead`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-008 — Resumo determinístico da série de patrimônio (segunda fatia de M3)

- **ID da tarefa:** TASK-008
- **Milestone:** M3 — resumo determinístico de série de patrimônio, segunda fatia
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Menor redução de série do replay: `summarizeEquitySeries` recebe uma coleção não vazia de
`EquityPoint` de um único agente, já ordenada cronologicamente pelo chamador, e devolve um
`EquitySeriesSummary` imutável e auditável com P&L final (direção + magnitude, sem tipo
monetário assinado) e o maior drawdown absoluto observado, com evidência de onde ocorreu
(timestamp do pico e do vale). Não calcula replay de ciclos, drawdown percentual, win rate,
fees agregadas ou benchmarks — fora do escopo exato desta fatia. Reutiliza integralmente
`subtractChecked` e `MAX_MICROS` de `src/money/fixed-point.ts` para toda comparação
monetária; nenhuma fórmula foi duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_007.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/metrics/value-wallet-at.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/metrics/summarize-equity-series.ts` | criado — `summarizeEquitySeries`, `EquitySeriesSummary`, `PnlDirection` |
| `tests/summarize-equity-series.test.ts` | criado |
| `README.md` | atualizado (seção "Resumo determinístico da série de patrimônio") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com
zero dependências de runtime.

### Design de `summarizeEquitySeries`

Recebe `points: readonly EquityPoint[]` e percorre a série uma única vez, validando à medida
que avança:

1. lista vazia falha fechado antes de qualquer leitura;
2. todo ponto deve pertencer ao mesmo `agentId` do primeiro ponto — agente divergente falha
   fechado;
3. `valuedAt` de cada ponto precisa ser canônico (mesma checagem de
   `src/metrics/value-wallet-at.ts`) e estritamente maior que o anterior — timestamp não
   canônico, duplicado ou fora de ordem falha fechado, sem ordenar silenciosamente;
4. `equityMicros` de cada ponto é validado como `bigint` não negativo e no máximo
   `MAX_MICROS`, mesmo que a tarefa receba `EquityPoint`s já tipados — um chamador pode
   montá-los manualmente (como os próprios testes fazem), e a fatia falha fechada perante
   um valor fora do intervalo em vez de confiar cegamente no tipo.

Um pico corrente (`peakEquityMicros`/`peakAt`) é atualizado sempre que o patrimônio do ponto
atual é maior ou igual ao pico já visto — assim uma recuperação completa que empata com o
pico anterior passa a referenciar o instante mais recente dessa recuperação, sem alterar o
valor do pico nem apagar um drawdown máximo já registrado antes dela. O drawdown de cada
ponto é `subtractChecked(pico corrente, patrimônio do ponto)`, nunca negativo por construção
(o pico corrente nunca é menor que o patrimônio atual). `maxDrawdownMicros` só é substituído
por um drawdown estritamente maior, o que garante que um empate entre dois episódios mantém
o primeiro cronológico, exatamente como a tarefa exige.

P&L é a diferença exata entre o patrimônio do último e do primeiro ponto, calculada com
`subtractChecked` sobre o maior menos o menor e reportada como `pnlDirection`
(`GAIN`/`LOSS`/`FLAT`) mais `pnlMagnitudeMicros` não negativo — nunca um delta assinado.

### Testes cobertos em `tests/summarize-equity-series.test.ts`

Série de um único ponto (P&L `FLAT`, drawdown zero); ganho; perda; resultado flat com dois
pontos iguais; novo pico seguido de drawdown; recuperação parcial mantendo o drawdown mais
profundo; recuperação completa retornando a P&L `FLAT` sem apagar o drawdown máximo
histórico; múltiplos drawdowns escolhendo o maior; empate de drawdown mantendo o primeiro
episódio cronológico; rejeição de lista vazia; rejeição de agentes misturados; rejeição de
timestamp duplicado; rejeição de timestamps fora de ordem; rejeição de timestamp não
canônico; rejeição de patrimônio negativo; rejeição de patrimônio acima de `MAX_MICROS`;
congelamento do `EquitySeriesSummary`; ausência de mutação dos pontos recebidos;
determinismo para o mesmo input canônico.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **262 testes, 262 passaram, 0 falharam** (243 preexistentes + 19 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio (todo
`valuedAt` já vem nos `EquityPoint` de entrada, injetados pelo chamador em cada teste),
nenhum uso de `random`.

### Decisões técnicas tomadas

1. **`isCanonicalTimestamp` duplicado localmente pela terceira vez** (após
   `src/domain/contracts.ts`, `src/risk/risk-manager.ts` e
   `src/metrics/value-wallet-at.ts`). O escopo exato desta tarefa é criar `src/metrics/`, e
   a checagem não é exportada de `contracts.ts`; segue o precedente já registrado nas
   TASK-004 e TASK-007 para esse mesmo trade-off.
2. **Pico corrente atualizado com `>=`, não apenas `>`.** Isso faz `peakAt` acompanhar a
   ocorrência mais recente de um patrimônio máximo (por exemplo, após uma recuperação
   completa que empata com o pico anterior), o que é a base mais intuitiva para um drawdown
   futuro medido a partir dali. Não afeta o valor de `peakEquityMicros` (idêntico em caso de
   empate) nem o registro de um drawdown máximo já ocorrido antes da atualização, porque
   `maxDrawdownMicros` só é observado, nunca recalculado retroativamente.
3. **`equityMicros` de cada ponto é revalidado (bigint, não negativo, ≤ `MAX_MICROS`)**, em
   vez de confiar que todo `EquityPoint` recebido veio de `valueWalletAt`. A tarefa pede
   explicitamente "validar limites monetários e falhar fechado diante de valores inválidos";
   como `EquityPoint` é apenas um tipo estrutural em tempo de compilação, nada impede um
   chamador (ou um teste) de construir um com um valor fora do intervalo.
4. **Nenhuma classe de erro nova.** Toda rejeição usa `rejectContract`/
   `ContractValidationError`, o mesmo mecanismo de todo o resto do repositório.
5. **Nenhum tipo monetário assinado foi criado.** `pnlDirection` mais `pnlMagnitudeMicros`
   (sempre não negativo) descrevem o P&L completamente, exatamente como a tarefa autoriza:
   "não crie um tipo monetário signed se a representação direção + magnitude for
   suficiente".

### Limitações conhecidas

- Não calcula drawdown percentual, win rate, fees agregadas, benchmarks ou replay de ciclos
  — fatias futuras de M3, fora do escopo exato desta tarefa.
- Não seleciona nem busca `EquityPoint`s: o chamador precisa fornecer a série já ordenada
  cronologicamente e já filtrada para um único agente.
- Não há verificação de que os `EquityPoint`s recebidos foram de fato produzidos por
  `valueWalletAt` para o mesmo conjunto de snapshots/carteira — apenas os campos usados aqui
  (`agentId`, `valuedAt`, `equityMicros`) são validados.
- Não persiste nada em arquivo; o `EquitySeriesSummary` vive apenas em memória, como as
  milestones anteriores.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as cinco decisões acima têm alternativa
única e mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. `git pull --ff-only origin main` não pôde ser executado neste ambiente
sandboxed (operações de rede exigem aprovação que não foi concedida); a branch já havia sido
criada a partir do topo de `main` (commit `23c814d`), confirmado por `git log`/`git status`
antes de iniciar o trabalho, então nenhuma sincronização adicional era necessária.

### Commit

- **Mensagem:** `feat: resume serie de patrimonio`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.
