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

## TASK-009 — Métricas determinísticas de execução e custos (terceira fatia de M3)

- **ID da tarefa:** TASK-009
- **Milestone:** M3 — resumo determinístico de custos de execução, terceira fatia
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Menor resumo de custos do ledger paper: `summarizeExecutionCosts` recebe `agentId` e uma
coleção readonly de `LedgerEvent` (qualquer ordem, possivelmente vazia) e devolve um
`ExecutionCostSummary` imutável e auditável — contagens de fills/rejeições, fees e o impacto
de spread/slippage embutido no preço de cada fill, separados da fee. Não reconstrói
carteira, não calcula win rate, P&L realizado por trade, drawdown percentual ou benchmarks —
fora do escopo exato desta fatia. Reutiliza integralmente `mulDivFloor`, `addBounded`,
`subtractChecked`, `parseAssetScale`, `MAX_MICROS` e `MAX_ATOMS` de
`src/money/fixed-point.ts`, e `REJECTION_CODES` de `src/ledger/events.ts`; nenhuma fórmula
monetária ou lista de códigos foi duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_008.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/ledger/events.ts`, `src/money/fixed-point.ts` e
`TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/metrics/summarize-execution-costs.ts` | criado — `summarizeExecutionCosts`, `ExecutionCostSummary`, `RejectionCounts` |
| `tests/summarize-execution-costs.test.ts` | criado |
| `README.md` | atualizado (seção "Resumo determinístico de custos de execução") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com
zero dependências de runtime.

### Design de `summarizeExecutionCosts`

Percorre `events` uma única vez, validando à medida que avança:

1. todo evento precisa ter `agentId` igual ao solicitado — um agente divergente falha
   fechado;
2. todo `eventId` só pode aparecer uma vez num `Set` — uma duplicata falha fechado, para
   impedir dupla contagem (não importa se o conteúdo é idêntico ou não: a identidade do
   evento é o que conta);
3. uma `RejectionEvent` incrementa `rejectionCount` e a contagem do seu `code`, validado
   contra a lista estável `REJECTION_CODES` — um código fora dessa lista falha fechado — e
   não toca em nenhum total monetário;
4. uma `FillEvent` incrementa `fillCount`/`buyFillCount`/`sellFillCount`, revalida
   `quantityAtoms`, `referencePriceMicros`, `effectivePriceMicros`, `grossMicros` e
   `feeMicros` como `bigint` não negativos dentro dos limites de sanidade existentes
   (`MAX_ATOMS`/`MAX_MICROS`) e `assetScale` com `parseAssetScale` — mesmo que `FillEvent`
   já seja tipado, nada impede um chamador de construir um evento com um campo fora do
   intervalo, o mesmo trade-off já registrado nas TASK-007/TASK-008.

O impacto de execução de cada fill usa exatamente a fórmula da tarefa: `BUY` usa
`subtractChecked(effectivePriceMicros, referencePriceMicros, ...)`, `SELL` usa
`subtractChecked(referencePriceMicros, effectivePriceMicros, ...)` — a checagem direcional
(`effectivePriceMicros >= referencePriceMicros` para BUY, `<=` para SELL) roda antes, então
`subtractChecked` nunca vê um delta negativo por construção; um fill que viole essa direção
falha fechado como preço "direcionalmente inválido". O custo do fill é
`mulDivFloor(quantityAtoms, deltaPriceMicros, scaleFactor(assetScale))`, e a soma protegida
de `grossMicros`, `feeMicros` e do impacto usa `addBounded(..., MAX_MICROS, ...)` — uma
única fill cujo custo já exceda `MAX_MICROS`, ou uma soma que ultrapasse esse limite, falha
fechada por overflow.

As contagens por código de rejeição são construídas iterando `REJECTION_CODES` (não os
eventos recebidos) para inicializar um objeto com todo código presente e zerado; a ordem das
chaves desse objeto é portanto sempre a ordem declarada em `REJECTION_CODES`, qualquer que
seja a ordem em que os eventos chegaram — não há necessidade de ordenar nada depois. Como
tanto a detecção de duplicata quanto toda soma são independentes de ordem, a saída completa
não depende da ordem de `events`.

### Testes cobertos em `tests/summarize-execution-costs.test.ts`

Lista vazia com todas as contagens/totais zerados; um fill BUY; um fill SELL; múltiplos
fills somando gross e fees; cálculo exato do impacto de um fill BUY; cálculo exato do
impacto de um fill SELL; arredondamento conservador por floor no impacto
(`floor(1 * 3_333_333 / 100) = 33_333`, não 33_334); rejeições contadas sem alterar nenhum
total monetário; contagem de cada código de rejeição usado no fixture, com a ordem das
chaves igual a `REJECTION_CODES`; mesmo conjunto de eventos em ordens diferentes produzindo
resultado idêntico; evento de agente divergente rejeitado; `eventId` duplicado rejeitado
(dois fills com o mesmo conteúdo produzem o mesmo `eventId` via `createFillEvent`, e a
segunda ocorrência é rejeitada); fill BUY abaixo do preço de referência rejeitado; fill SELL
acima do preço de referência rejeitado; valor negativo rejeitado (evento construído à mão,
já que `createFillEvent` por si só nunca produz um `bigint` negativo — `formatIntegerString`
rejeitaria isso ao computar o `eventId`); escala de ativo inválida rejeitada; overflow do
impacto total de execução falhando fechado; overflow do total de gross falhando fechado;
congelamento do resumo e de `rejectionCounts`; ausência de mutação dos eventos recebidos;
determinismo para o mesmo input canônico.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **283 testes, 283 passaram, 0 falharam** (262 preexistentes + 21 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio (todo
`occurredAt` já vem nos eventos de entrada, injetados pelo chamador em cada teste), nenhum
uso de `random`.

### Decisões técnicas tomadas

1. **`eventId` duplicado é detectado com um `Set`, independentemente de conteúdo.** A tarefa
   pede "duplicata deve falhar fechada para impedir dupla contagem"; a identidade do evento
   já é o `eventId` (hash de conteúdo, por `src/ledger/events.ts`), então duas ocorrências do
   mesmo id — venham de conteúdo idêntico ou (impossível na prática, mas não verificado aqui)
   de uma colisão — nunca devem ser somadas duas vezes.
2. **`rejectionCounts` inclui todos os `REJECTION_CODES`, com zero para os não usados**, em
   vez de listar apenas os códigos observados. Construir o objeto iterando a lista estável
   entrega "ordem determinística" sem nenhuma ordenação adicional, e um consumidor não
   precisa checar a presença de uma chave antes de lê-la.
3. **Todo campo monetário do fill é revalidado (bigint, não negativo, dentro do limite de
   sanidade), mesmo que `FillEvent` já seja tipado.** Mesmo trade-off já registrado nas
   TASK-007 e TASK-008: nada impede um chamador de montar um evento fora do intervalo, e a
   tarefa pede explicitamente falha fechada para esse caso.
4. **Nenhuma classe de erro nova.** Toda rejeição usa `rejectContract`/
   `ContractValidationError`, o mesmo mecanismo do resto do repositório.
5. **Nenhum tipo monetário assinado foi criado.** `totalGrossMicros`, `totalFeeMicros` e
   `totalExecutionImpactMicros` são sempre não negativos por construção (gross, fee e o
   próprio impacto — já garantido não negativo pela checagem direcional — nunca são
   subtraídos de um total).

### Limitações conhecidas

- Não calcula P&L realizado por trade, win rate, drawdown percentual, benchmarks ou replay
  completo — fatias futuras de M3, fora do escopo exato desta tarefa.
- Não seleciona nem filtra eventos: o chamador precisa fornecer a coleção já pertencente a
  um único agente (o resumo apenas valida essa condição e falha fechado se violada).
- Não persiste nada em arquivo; o `ExecutionCostSummary` vive apenas em memória, como as
  milestones anteriores.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as cinco decisões acima têm alternativa
única e mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. `git pull`/`git fetch origin main` não puderam ser executados neste
ambiente sandboxed (operações de rede exigem aprovação que não foi concedida); `git log`/
`git status` confirmaram que a branch já estava no mesmo commit de `main` (`69dbdb6`) antes
de iniciar o trabalho, então nenhuma sincronização adicional era necessária — mesma
limitação já registrada na entrega da TASK-008.

### Commit

- **Mensagem:** `feat: resume custos de execucao paper`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-010 — Benchmark cash determinístico (quarta fatia de M3)

- **ID da tarefa:** TASK-010
- **Milestone:** M3 — benchmark cash determinístico, quarta fatia
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Primeiro benchmark experimental do replay: `buildCashBenchmark` recebe `agentId`,
`initialCashMicros` e uma coleção readonly e não vazia de timestamps `valuedAt`, e devolve
um `CashBenchmark` imutável e auditável — uma carteira que permanece integralmente em caixa
durante os mesmos instantes em que uma estratégia seria avaliada. Não executa nenhuma ordem,
não cria `LedgerEvent`, fill ou custo. Reutiliza integralmente `createWallet`
(`src/portfolio/portfolio.ts`), `valueWalletAt` com lista de snapshots vazia e
`summarizeEquitySeries` (`src/metrics/`); nenhuma validação de timestamp, cálculo de
patrimônio, P&L ou drawdown foi duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_009.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/portfolio/portfolio.ts`,
`src/metrics/value-wallet-at.ts`, `src/metrics/summarize-equity-series.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/benchmark/build-cash-benchmark.ts` | criado — `buildCashBenchmark`, `CashBenchmark` |
| `tests/build-cash-benchmark.test.ts` | criado |
| `README.md` | atualizado (seção "Benchmark cash (controle sem operações)" e listas de escopo) |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com
zero dependências de runtime.

### Design de `buildCashBenchmark`

A função constrói uma única `Wallet` com `createWallet(agentId, initialCashMicros)` e chama
`valueWalletAt(wallet, instant, [])` uma vez por timestamp de `valuedAt`, na mesma ordem
recebida, produzindo um `EquityPoint` por instante. A lista completa de pontos é passada
inteira para `summarizeEquitySeries`, que devolve o `EquitySeriesSummary`. Nenhuma outra
lógica existe na função: toda regra exigida pela tarefa é uma consequência da reutilização
dessas três primitivas, não de uma checagem escrita para esta tarefa:

- **canônico, estritamente crescente, sem duplicata** — `valueWalletAt` rejeita um
  `valuedAt` não canônico em cada chamada individual; `summarizeEquitySeries` rejeita
  duplicata ou ordem inválida ao validar a série completa construída na mesma ordem de
  entrada;
- **lista vazia rejeitada** — `valuedAt: []` produz zero `EquityPoint`s, e
  `summarizeEquitySeries([])` já falha fechado com "must contain at least one EquityPoint";
  nenhuma checagem de tamanho foi escrita aqui;
- **capital inicial: tipo inválido, negativo ou acima do limite rejeitados** —
  `valueWalletAt` calcula `equityMicros = addBounded(wallet.cashMicros, 0n, MAX_MICROS, ...)`;
  como a carteira não tem posições, esse é exatamente `initialCashMicros`, e `addBounded`
  já rejeita um valor que não seja `bigint`, que seja negativo, ou cuja soma exceda
  `MAX_MICROS` — nenhuma validação monetária própria foi escrita;
- **caixa e patrimônio exatamente iguais ao capital inicial em todo ponto** — consequência
  direta de uma carteira que nunca recebe um evento: `wallet.cashMicros` nunca muda entre as
  chamadas de `valueWalletAt`;
- **posições e `snapshotIds` sempre vazios** — `valueWalletAt` itera `wallet.positions`, que
  está vazio, e a lista de snapshots recebida também está vazia;
- **resumo sempre `FLAT`, com `pnlMagnitudeMicros` e `maxDrawdownMicros` zero** — como todo
  ponto tem `equityMicros` idêntico, o primeiro e o último ponto empatam (`FLAT`) e o pico
  corrente nunca fica acima do patrimônio atual (drawdown zero) — não é um caso especial
  verificado, é o resultado de `summarizeEquitySeries` sobre uma série constante.

### Testes cobertos em `tests/build-cash-benchmark.test.ts`

Um único instante com ponto flat igual ao capital fictício de US$100; vários instantes com
caixa/patrimônio constantes, timestamps preservados e alinhados na mesma ordem de entrada, e
resumo flat com drawdown zero; lista vazia rejeitada; timestamp duplicado rejeitado;
timestamps fora de ordem rejeitados; timestamp não canônico rejeitado; capital negativo
rejeitado; capital de tipo inválido rejeitado (`bigint` forjado via `as unknown as bigint`,
já que o tipo estático do parâmetro é `Micros`); capital acima do limite de sanidade
rejeitado; isolamento entre dois agentes com capitais diferentes; congelamento do
`CashBenchmark`, de `points`, de cada `EquityPoint` e de suas coleções próprias; ausência de
mutação da coleção de timestamps recebida; determinismo para o mesmo input canônico.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **296 testes, 296 passaram, 0 falharam** (283 preexistentes + 13 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio (todo
`valuedAt` é injetado pelo chamador em cada teste), nenhum uso de `random`.

### Decisões técnicas tomadas

1. **Nenhuma validação própria de `initialCashMicros`, `valuedAt` (canonicidade, ordem,
   duplicata) ou tamanho da lista foi escrita.** A tarefa exige explicitamente reutilizar
   `createWallet`, `valueWalletAt` e `summarizeEquitySeries`, e não replicar validação de
   timestamp ou cálculo de patrimônio/P&L/drawdown. Como essas três funções já impõem, juntas,
   toda regra obrigatória da tarefa sobre o input recebido, escrever uma checagem equivalente
   aqui seria exatamente a duplicação que a tarefa proíbe.
2. **Assinatura posicional (`agentId, initialCashMicros, valuedAt`), não um objeto de
   opções.** Mantém a mesma convenção de `createWallet(agentId, initialCashMicros)`
   (`src/portfolio/portfolio.ts`) e de `valueWalletAt(wallet, valuedAt, snapshots)`
   (`src/metrics/value-wallet-at.ts`), as duas funções mais próximas que este módulo compõe.
3. **`CashBenchmark` expõe `points: readonly EquityPoint[]` e `summary: EquitySeriesSummary`
   sem reexportar ou redefinir esses tipos.** A tarefa pede a série de `EquityPoint` "alinhada
   aos timestamps recebidos" e o `EquitySeriesSummary` "calculado pela função existente";
   como os dois tipos já existem e já são exportados por `src/metrics/`, não havia motivo
   para uma cópia ou um alias local.
4. **Nenhuma classe de erro nova.** Toda rejeição chega de `ContractValidationError`, lançada
   dentro de `valueWalletAt`/`summarizeEquitySeries`; este módulo não chama `rejectContract`
   em nenhum ponto.

### Limitações conhecidas

- Não implementa buy-and-hold, benchmark aleatório, comparação ou ranking entre agentes —
  fora do escopo exato desta tarefa e do M3 atual.
- Não persiste nada em arquivo; o `CashBenchmark` vive apenas em memória, como as milestones
  anteriores.
- Como em `summarizeEquitySeries`, o chamador precisa fornecer `valuedAt` já em ordem
  cronológica; a função não ordena nem deduplica silenciosamente.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as quatro decisões acima têm alternativa
única e mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. `git fetch`/`git pull --ff-only origin main` não puderam ser executados
neste ambiente sandboxed (operações de rede exigem aprovação que não foi concedida);
`git log`/`git status` confirmaram que a branch já estava no mesmo commit de `main`
(`a344acf`) antes de iniciar o trabalho, então nenhuma sincronização adicional era
necessária — mesma limitação já registrada nas entregas das TASK-008 e TASK-009.

### Commit

- **Mensagem:** `feat: adiciona benchmark cash`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-011 — Comparação determinística com o benchmark cash (quinta fatia de M3)

- **ID da tarefa:** TASK-011
- **Milestone:** M3 — comparação determinística com benchmark, quinta fatia
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Menor comparação do replay: `compareToCashBenchmark` recebe o `EquitySeriesSummary` de uma
estratégia e um `CashBenchmark` do mesmo experimento e devolve um `BenchmarkComparison`
imutável e auditável — se a estratégia terminou acima, abaixo ou empatada com o controle
cash. Não executa nenhuma ordem e não cria ranking entre agentes. Reutiliza integralmente os
tipos `EquitySeriesSummary` (`src/metrics/summarize-equity-series.ts`) e `CashBenchmark`
(`src/benchmark/build-cash-benchmark.ts`), sem redefini-los, e `subtractChecked`/`MAX_MICROS`
de `src/money/fixed-point.ts` para toda aritmética monetária; nenhuma fórmula foi duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_010.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/benchmark/build-cash-benchmark.ts`,
`src/metrics/summarize-equity-series.ts`, `src/money/fixed-point.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/benchmark/compare-to-cash-benchmark.ts` | criado — `compareToCashBenchmark`, `BenchmarkComparison`, `BenchmarkComparisonResult` |
| `tests/compare-to-cash-benchmark.test.ts` | criado |
| `README.md` | atualizado (seção "Comparação com o benchmark cash") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com
zero dependências de runtime.

### Design de `compareToCashBenchmark`

Recebe `(strategySummary, cashBenchmark)`, posicional, na mesma convenção de
`buildCashBenchmark(agentId, initialCashMicros, valuedAt)` e `valueWalletAt(wallet, valuedAt,
snapshots)` — as duas funções mais próximas que este módulo compõe, ambas de dois ou três
parâmetros posicionais em vez de um objeto de opções.

Duas fases, nessa ordem:

1. **Validação monetária de cada campo `bigint` lido** (`strategySummary.startingEquityMicros`,
   `strategySummary.endingEquityMicros`, `cashBenchmark.initialCashMicros`,
   `cashBenchmark.summary.endingEquityMicros`): cada um precisa ser um `bigint` entre `0` e
   `MAX_MICROS`, o mesmo padrão de `assertValidEquityMicros` em
   `src/metrics/summarize-equity-series.ts`, repetido aqui porque `EquitySeriesSummary` e
   `CashBenchmark` são apenas tipos estruturais em tempo de compilação — nada impede um
   chamador (ou um teste) de construir um com um campo forjado.
2. **Compatibilidade entre os dois resumos**: mesmo `agentId`, mesmo `startedAt`, mesmo
   `endedAt`, mesmo `pointCount` e patrimônio inicial da estratégia igual a
   `cashBenchmark.initialCashMicros`. Qualquer divergência falha fechado imediatamente, antes
   de qualquer comparação de patrimônio final.

Só então a direção é decidida comparando exclusivamente `strategyEndingEquityMicros` e
`benchmarkEndingEquityMicros`: `OUTPERFORMED` quando a estratégia é maior, `UNDERPERFORMED`
quando é menor, `TIED` quando são iguais. A magnitude usa `subtractChecked` sobre o maior menos
o menor — nunca negativa por construção — e é `0n` no caso `TIED`, sem chamar
`subtractChecked` com operandos iguais.

### Testes cobertos em `tests/compare-to-cash-benchmark.test.ts`

Estratégia supera o cash (`OUTPERFORMED` com diferença exata); estratégia perde para o cash
(`UNDERPERFORMED` com diferença exata); empate (`TIED`, diferença zero); diferença exata em
micros (1 micro, não uma aproximação); capital fictício de US$100 compartilhado entre
estratégia e benchmark; rejeição por `agentId` diferente; rejeição por `startedAt` diferente;
rejeição por `endedAt` diferente; rejeição por `pointCount` diferente; rejeição por patrimônio
inicial diferente; rejeição de patrimônio final forjado como não-`bigint`, negativo e acima de
`MAX_MICROS`; congelamento do `BenchmarkComparison` devolvido; ausência de mutação do
`EquitySeriesSummary` e do `CashBenchmark` recebidos; determinismo para o mesmo input
canônico; ausência de relógio, rede ou aleatoriedade (suíte offline, valores só `bigint`
injetados).

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **313 testes, 313 passaram, 0 falharam** (296 preexistentes + 17 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio (todo
timestamp já vem nos resumos de entrada, injetados pelo chamador em cada teste), nenhum uso
de `random`.

### Decisões técnicas tomadas

1. **Assinatura posicional `(strategySummary, cashBenchmark)`, não um objeto de opções.**
   Segue a mesma convenção de `buildCashBenchmark` e `valueWalletAt`, as funções mais próximas
   que este módulo compõe; um objeto de request só foi usado em `settlePaperExecution`/
   `executePaperOrderWithRisk`, que recebem seis ou mais campos.
2. **`assertValidMicros` duplicado localmente**, no mesmo padrão de `assertValidEquityMicros`
   em `src/metrics/summarize-equity-series.ts`. A tarefa exige explicitamente reutilizar os
   tipos existentes sem redefini-los e "rejeitar valores monetários inválidos ou forjados";
   como nenhum desses tipos é uma classe com validação em tempo de execução, a única forma de
   cumprir essa exigência é revalidar cada campo `bigint` lido, o mesmo trade-off já registrado
   nas TASK-007/008/009.
3. **Compatibilidade do patrimônio inicial comparada contra `cashBenchmark.initialCashMicros`,
   não contra `cashBenchmark.summary.startingEquityMicros`.** Os dois valores são sempre iguais
   por construção de `buildCashBenchmark` (a carteira nunca opera), mas `initialCashMicros` é o
   campo que a tarefa nomeia explicitamente ("mesmo... patrimônio inicial" comparado a um
   `CashBenchmark`), então comparar contra ele é mais direto e não depende de uma invariante
   implícita de outro módulo.
4. **`TIED` nunca chama `subtractChecked`.** Uma subtração de dois valores iguais já devolveria
   `0n`, mas evitar a chamada nesse ramo deixa explícito, sem uma checagem extra, que a
   magnitude de um empate é sempre exatamente zero.
5. **Nenhuma classe de erro nova.** Toda rejeição usa `rejectContract`/`ContractValidationError`,
   o mesmo mecanismo do resto do repositório.

### Limitações conhecidas

- Compara apenas contra o benchmark cash; buy-and-hold, benchmark aleatório ou ranking entre
  agentes seguem fora do escopo desta fatia e do M3 atual.
- Não persiste nada em arquivo; o `BenchmarkComparison` vive apenas em memória, como as
  milestones anteriores.
- Não recalcula nem revalida a série de `EquityPoint` subjacente a nenhum dos dois resumos —
  confia que `EquitySeriesSummary` e `CashBenchmark` foram produzidos por
  `summarizeEquitySeries`/`buildCashBenchmark`, exceto pelos quatro campos monetários
  explicitamente revalidados.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as cinco decisões acima têm alternativa única
e mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. `git pull --ff-only origin main`/`git fetch origin main` não puderam ser
executados neste ambiente sandboxed (operações de rede exigem aprovação que não foi
concedida); `git status`/`git log --all`/`git rev-parse HEAD main origin/main` confirmaram que
a branch já estava no mesmo commit de `main` (`a32bcfc`) antes de iniciar o trabalho, então
nenhuma sincronização adicional era necessária — mesma limitação já registrada nas entregas
das TASK-008, TASK-009 e TASK-010.

### Commit

- **Mensagem:** `feat: compara estrategia ao benchmark cash`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

### Correção — revisão técnica ciclo 1/3 (sobre o SHA `ceadce4d7789a7284b7828f81855b4c890628c4e`)

A revisão do ChatGPT/GPT-5.6 Sol apontou que `compareToCashBenchmark` validava alguns campos
monetários, mas confiava cegamente na consistência interna do próprio `CashBenchmark`
recebido: como `CashBenchmark` é só um tipo estrutural em tempo de compilação, nada impedia um
chamador de passar um objeto forjado com `kind !== "CASH"`, com `summary.agentId` divergente de
`cashBenchmark.agentId`, ou com `summary.startingEquityMicros` inválido ou divergente de
`cashBenchmark.initialCashMicros` — e a função ainda produzia uma comparação aparentemente
válida. Isso viola a compatibilidade contábil fail-closed exigida pela tarefa.

**Correção mínima em `src/benchmark/compare-to-cash-benchmark.ts`:** três checagens novas,
antes de qualquer comparação de patrimônio final, na mesma linha das já existentes (`agentId`,
`startedAt`, `endedAt`, `pointCount`, patrimônio inicial da estratégia):

1. `cashBenchmark.summary.startingEquityMicros` passa por `assertValidMicros` (o mesmo
   validador monetário já usado para os outros quatro campos `bigint`);
2. `cashBenchmark.kind` precisa ser exatamente `"CASH"`;
3. `cashBenchmark.summary.agentId` precisa ser igual a `cashBenchmark.agentId`;
4. `cashBenchmark.summary.startingEquityMicros` (já validado no passo 1) precisa ser igual a
   `cashBenchmark.initialCashMicros`.

Como a checagem pré-existente já exige `strategySummary.startingEquityMicros ===
cashBenchmark.initialCashMicros`, a nova checa (4) fecha a cadeia: as três grandezas —
patrimônio inicial da estratégia, `initialCashMicros` e `summary.startingEquityMicros` do
benchmark — ficam obrigatoriamente iguais entre si, sem precisar de uma terceira comparação
redundante.

Quatro testes novos em `tests/compare-to-cash-benchmark.test.ts`, no describe `fail-closed
compatibility rules`: `kind` forjado; `summary.agentId` interno divergente do `agentId` do
próprio benchmark; `summary.startingEquityMicros` forjado como não-`bigint`; e
`summary.startingEquityMicros` divergente de `initialCashMicros`.

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **317 testes, 317 passaram, 0 falharam** (313 preexistentes + 4 novos) |

Nenhuma ordem, rede, credencial ou rota financeira real foi adicionada. Pureza, determinismo,
imutabilidade e o restante do escopo da TASK-011 preservados sem alteração.

- **Commit:** `fix: valida consistencia interna do cash benchmark fail-closed`
- **Hash:** informado a André na resposta após o push.

## TASK-012 — Seleção de snapshot sem look-ahead para replay (quarta fatia de M3)

- **ID da tarefa:** TASK-012
- **Milestone:** M3 — seleção determinística de snapshot sem look-ahead, quarta fatia
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Menor primitiva de seleção do replay: `selectLatestAvailableSnapshot` recebe uma coleção não
validada de entradas, um `asset`, um `quote` e um `decisionAt` canônico, e devolve o
`MarketSnapshot` validado e imutável do par pedido com o maior `availableAt` tal que
`availableAt <= decisionAt`. Não implementa replay completo, coleta de mercado, indicadores
nem qualquer outra peça fora desta seleção pontual — fora do escopo exato desta fatia.
Reutiliza integralmente `parseMarketSnapshot` de `src/domain/contracts.ts` para toda validação
estrutural; nenhuma regra do contrato `MarketSnapshot` foi duplicada ou redefinida.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_011.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/domain/contracts.ts`,
`src/metrics/value-wallet-at.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/replay/select-latest-available-snapshot.ts` | criado — `selectLatestAvailableSnapshot` |
| `tests/select-latest-available-snapshot.test.ts` | criado |
| `README.md` | atualizado (seção "Seleção de snapshot sem look-ahead para replay") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero
dependências de runtime.

### Design de `selectLatestAvailableSnapshot`

Recebe `(snapshots, asset, quote, decisionAt)`, onde `snapshots` é uma lista de valores não
validados em qualquer ordem — a mesma forma "software valida" já usada em
`src/metrics/value-wallet-at.ts`. Para cada entrada bruta:

1. um teste estrutural barato (`record.asset === asset && record.quote === quote`, sem chamar
   `parseMarketSnapshot`) decide se a entrada pertence ao par pedido; entradas de outro par são
   ignoradas sem validação alguma — mesmo se malformadas;
2. toda entrada que pertence ao par pedido passa por `parseMarketSnapshot(raw)` **sem** a
   opção `notAfter` — a tarefa exige validar inclusive snapshots futuros do par, e passar
   `notAfter` faria `parseMarketSnapshot` rejeitar um snapshot futuro *válido* antes mesmo de a
   seleção poder simplesmente ignorá-lo por não ser elegível;
3. a elegibilidade temporal (`candidate.availableAt <= decisionAt`) é então checada
   manualmente, à parte da validação estrutural.

Entre os candidatos elegíveis, o maior `availableAt` e a contagem de candidatos empatados
nesse máximo são computados num único laço sobre `snapshots`, sem ordenar a coleção: cada
candidato estritamente maior que o melhor atual substitui o melhor e zera a marca de empate;
cada candidato igual ao melhor atual liga a marca de empate. Esse algoritmo de "máximo e
multiplicidade do máximo" é uma redução comutativa e associativa — o resultado (vencedor e
se houve empate no topo) não depende da ordem de iteração, verificado por teste dedicado.
Ausência de candidato elegível e empate no maior `availableAt` falham fechados com
`ContractValidationError`, sem escolher um vencedor arbitrário.

`decisionAt` é validado com uma checagem de timestamp canônico duplicada localmente — mesma
regex e mesmo round-trip por `Date` já usados (e já duplicados por precedente) em
`src/domain/contracts.ts` (privada, não exportada), `src/risk/risk-manager.ts` e
`src/metrics/value-wallet-at.ts`. Como toda comparação de `availableAt` ocorre apenas entre
strings que já passaram por essa checagem — e o formato canônico tem largura fixa —, a
comparação de elegibilidade e de máximo usa comparação de string diretamente (`>`, `===`),
sem precisar calcular epoch: duas datas UTC canônicas de mesmo formato comparam
lexicograficamente na mesma ordem que cronologicamente.

### Testes cobertos em `tests/select-latest-available-snapshot.test.ts`

Seleção do único snapshot elegível; escolha do mais recente entre três snapshots passados
(dois deles com `availableAt` empatado, mas não no máximo); aceitação de
`availableAt === decisionAt`; snapshot futuro ignorado a favor do passado mais recente;
snapshot de outro `asset` ignorado; snapshot de outro `quote` ignorado; entrada de outro par
nunca validada mesmo quando estruturalmente malformada (preço negativo); rejeição de coleção
vazia; rejeição quando todo snapshot do par é futuro; rejeição quando só há snapshots de
outros pares; rejeição de empate no maior `availableAt`; confirmação de que um empate que não
está no máximo não causa rejeição; rejeição de `decisionAt` sem milissegundos; rejeição de
`decisionAt` com offset diferente de `Z`; rejeição de snapshot malformado do par pedido mesmo
quando futuro; independência da ordem de entrada (três permutações, resultado idêntico);
ausência de mutação da coleção e de cada entrada recebida; congelamento do `MarketSnapshot`
devolvido; determinismo para o mesmo input canônico.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **336 testes, 336 passaram, 0 falharam** (317 preexistentes + 19 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio
(`decisionAt` é sempre injetado pelo chamador), nenhum uso de `random`.

### Decisões técnicas tomadas

1. **`isCanonicalTimestamp` duplicado localmente**, seguindo o mesmo precedente já registrado
   nas TASK-004/007/008 (hash de `RiskDecision.id`/checagem de timestamp duplicados porque o
   escopo exato desta tarefa é criar `src/replay/`, não alterar as exportações de
   `src/domain/contracts.ts`).
2. **`parseMarketSnapshot` é chamado sem a opção `notAfter`.** A tarefa exige duas coisas que
   `notAfter` não consegue satisfazer ao mesmo tempo: validar estruturalmente um snapshot
   futuro do par (para não escondê-lo atrás do filtro temporal) e, separadamente, apenas
   *ignorar* — não rejeitar toda a chamada — um snapshot futuro que é estruturalmente válido.
   Passar `notAfter: decisionAt` faria `parseMarketSnapshot` lançar erro para qualquer snapshot
   futuro do par, válido ou não, o que quebraria "ignora snapshot futuro" sempre que ele fosse
   estruturalmente correto. A elegibilidade temporal é, por isso, uma checagem manual separada
   da validação estrutural, feita por comparação de string sobre timestamps já canônicos.
3. **Comparação de `availableAt`/`decisionAt` por string, não por epoch.** Como os dois lados
   da comparação já passaram por uma checagem de timestamp canônico (formato fixo,
   zero-padded, sempre `Z`), a ordem lexicográfica de string coincide exatamente com a ordem
   cronológica; calcular e comparar epochs seria uma conversão redundante sem mudar nenhum
   resultado.
4. **Pertencimento ao par pedido é decidido por uma comparação de campo barata
   (`record.asset === asset && record.quote === quote`), antes de qualquer chamada a
   `parseMarketSnapshot`.** É a única forma de cumprir "ignorar snapshots de outros pares" sem
   validá-los — validar tudo indiscriminadamente rejeitaria a chamada inteira diante de um
   snapshot malformado de um par que nem interessa à seleção, o que a tarefa proíbe
   implicitamente ao pedir que apenas o par pedido seja submetido à validação completa.
5. **Máximo e empate no máximo computados num único laço, sem ordenar `snapshots`.** Ordenar
   violaria a regra explícita "não ordenar nem alterar a coleção recebida"; o algoritmo de
   "máximo e contagem de empates no máximo" é uma redução que não depende da ordem de
   iteração, então entrega "a ordem da entrada não pode mudar o resultado" sem precisar de uma
   cópia ordenada.
6. **Nenhuma classe de erro nova.** Toda rejeição usa `rejectContract`/`ContractValidationError`
   sob o nome de contrato `SnapshotSelection`, o mesmo mecanismo do resto do repositório.

### Limitações conhecidas

- Seleciona um único snapshot por chamada; não monta o contexto completo de uma decisão nem
  itera sobre múltiplos ativos de uma vez — isso, se necessário, é responsabilidade do
  chamador ou de uma fatia futura de M3.
- Não verifica frescor além do anti-look-ahead: um snapshot elegível com `availableAt` muito
  anterior a `decisionAt` é aceito, na mesma linha já documentada em
  `src/metrics/value-wallet-at.ts`.
- Não persiste nada em arquivo; roda inteiramente em memória.
- Não implementa replay de ciclos, indicadores, benchmarks ou qualquer peça listada em "Fora
  do escopo" da TASK-012.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as seis decisões acima têm alternativa única e
mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. `git pull --ff-only origin main`/`git fetch origin main` não puderam ser
executados neste ambiente sandboxed (operações de rede exigem aprovação que não foi
concedida); `git status`/`git log`/`git rev-parse HEAD origin/main` confirmaram que a branch já
estava no mesmo commit de `main` (`896676a`) antes de iniciar o trabalho, então nenhuma
sincronização adicional era necessária — mesma limitação já registrada nas entregas das
TASK-008 a TASK-011.

### Commit

- **Mensagem:** `feat: seleciona snapshot sem look-ahead para replay`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-013 — Série cronológica de snapshots para replay (terceira fatia de M3)

- **ID da tarefa:** TASK-013
- **Milestone:** M3 — série cronológica de snapshots para replay
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Composição pequena da primitiva da TASK-012 numa linha temporal auditável:
`buildReplaySnapshotSeries` recebe uma coleção não confiável de snapshots, `asset`, `quote` e
uma coleção de `decisionTimes` já em ordem cronológica estritamente crescente, e devolve uma
coleção imutável e congelada de pontos `{ decisionAt, snapshot }` — um por instante. Não
decide BUY/SELL/HOLD, não roda agente, Risk Manager, PaperBroker ou replay de portfólio; monta
apenas a evidência de mercado que estava disponível em cada instante. Reutiliza integralmente
`selectLatestAvailableSnapshot` de `src/replay/select-latest-available-snapshot.ts` para toda
seleção; nenhuma lógica de seleção foi duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_012.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/domain/contracts.ts`,
`src/replay/select-latest-available-snapshot.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/replay/build-replay-snapshot-series.ts` | criado — `buildReplaySnapshotSeries`, `ReplaySnapshotPoint` |
| `tests/build-replay-snapshot-series.test.ts` | criado |
| `README.md` | atualizado (seção "Série cronológica de snapshots para replay") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero
dependências de runtime.

### Design de `buildReplaySnapshotSeries`

Percorre `decisionTimes` uma única vez, validando à medida que avança:

1. lista vazia falha fechado antes de qualquer seleção;
2. cada instante precisa ser um timestamp canônico UTC ISO-8601 — a mesma checagem de formato
   fixo já duplicada em `src/risk/risk-manager.ts`, `src/metrics/value-wallet-at.ts` e
   `src/replay/select-latest-available-snapshot.ts`;
3. cada instante precisa ser estritamente maior que o anterior — como o formato canônico é de
   largura fixa, a comparação de string já concorda com a ordem cronológica, então duplicata e
   fora de ordem são a mesma checagem (`decisionAt <= previous`);
4. para cada instante validado, `selectLatestAvailableSnapshot(snapshots, asset, quote,
   decisionAt)` é chamada exatamente uma vez; qualquer rejeição dela (ausência de snapshot
   elegível, empate no maior `availableAt`, snapshot malformado do par pedido) propaga sem
   captura, interrompendo a montagem da série inteira.

Cada instante é resolvido de forma independente — não há reaproveitamento implícito do
snapshot do ponto anterior. Um ponto só muda de snapshot quando, para aquele `decisionAt`
específico, um snapshot mais recente já satisfaz `availableAt <= decisionAt`; a "troca de
snapshot" observável nos testes é, portanto, um efeito emergente de chamar a mesma primitiva
pura em instantes diferentes, não uma regra nova implementada aqui.

Cada ponto (`{ decisionAt, snapshot }`) é congelado individualmente, e a coleção de pontos é
congelada por inteiro antes de ser devolvida. `snapshot` é exatamente o objeto validado e
congelado que `selectLatestAvailableSnapshot`/`parseMarketSnapshot` produziu — não é copiado
nem recriado.

### Testes cobertos em `tests/build-replay-snapshot-series.test.ts`

Série de um único ponto; série cronológica para vários instantes; troca de snapshot somente
quando um mais recente já está disponível (com um instante intermediário reutilizando o
mesmo snapshot do ponto anterior); snapshot aceito com `availableAt === decisionAt`; prova de
que um snapshot futuro nunca aparece antes de sua disponibilidade, mesmo quando existe no
conjunto; rejeição de `decisionTimes` vazio, de instante não canônico, de instantes
duplicados e de instantes fora de ordem; propagação de ausência de snapshot elegível, de
empate no maior `availableAt` e de snapshot malformado do par pedido; snapshots de outros
pares ignorados, herdado da primitiva; ausência de mutação de `snapshots` e de
`decisionTimes`; congelamento de cada ponto, do snapshot aninhado e da coleção externa;
determinismo para o mesmo input canônico.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **353 testes, 353 passaram, 0 falharam** (336 preexistentes + 17 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio (todo
instante é injetado pelo chamador em cada teste), nenhum uso de `random`.

### Decisões técnicas tomadas

1. **`isCanonicalTimestamp` duplicado localmente**, com o mesmo padrão regex e a mesma
   checagem de round-trip por `Date` já usadas em `src/domain/contracts.ts` (privada, não
   exportada) e duplicadas em `src/risk/risk-manager.ts`, `src/metrics/value-wallet-at.ts` e
   `src/replay/select-latest-available-snapshot.ts`. O escopo exato desta tarefa é criar um
   módulo em `src/replay/`, não alterar exportações de `src/domain/contracts.ts` ou de
   `src/replay/select-latest-available-snapshot.ts`; a duplicação de uma checagem de três
   linhas segue o precedente já registrado nas tarefas anteriores.
2. **Duplicata e fora de ordem verificados numa única comparação (`decisionAt <=
   previous`).** A tarefa pede as duas rejeições separadamente, mas como `decisionTimes`
   deve ser estritamente crescente, qualquer par adjacente que não seja estritamente maior é,
   por definição, ou uma duplicata ou uma inversão — tratar os dois casos com a mesma
   comparação evita uma segunda passada ou uma estrutura de dados auxiliar (ex.: um `Set`)
   sem perder nenhuma cobertura de teste.
3. **Cada instante é resolvido de forma totalmente independente, sem estado compartilhado
   além do "instante anterior" usado só para validar ordem.** A tarefa exige "trocar de
   snapshot somente quando um mais recente já está disponível" como propriedade observável,
   não como uma regra a ser implementada por comparação entre pontos consecutivos — chamar a
   primitiva pura de novo para cada `decisionAt` já entrega essa propriedade por construção,
   e evita duplicar, mesmo que parcialmente, a lógica de seleção que a tarefa proíbe
   duplicar.
4. **Nenhuma classe de erro nova.** Toda rejeição usa `rejectContract`/`ContractValidationError`
   sob o nome de contrato `ReplaySnapshotSeries`, o mesmo mecanismo do resto do repositório;
   erros da primitiva reutilizada propagam sem re-envelopamento, preservando `contract:
   "SnapshotSelection"` original para quem inspeciona o erro.

### Limitações conhecidas

- Monta a série para um único par `asset`/`quote` por chamada; um replay multiativo precisa
  chamar a função uma vez por ativo, orquestração que fica fora desta fatia.
- Não verifica frescor além do anti-look-ahead herdado da primitiva: um snapshot elegível com
  `availableAt` muito anterior ao `decisionAt` correspondente é aceito.
- Não persiste nada em arquivo; roda inteiramente em memória.
- Não implementa replay de ciclos, decisão de agente, indicadores, benchmarks ou qualquer
  peça listada em "Fora do escopo" da TASK-013.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as quatro decisões acima têm alternativa
única e mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. `git pull --ff-only origin main`/`git fetch origin main` não puderam ser
executados neste ambiente sandboxed (operações de rede exigem aprovação que não foi
concedida); `git status`/`git log` confirmaram que a branch já estava no mesmo commit de
`main` (`ead47d9`) antes de iniciar o trabalho, então nenhuma sincronização adicional era
necessária — mesma limitação já registrada nas entregas anteriores.

### Commit

- **Mensagem:** `feat: constroi serie de snapshots para replay`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-014 — Benchmark buy-and-hold com custos paper (quarta fatia de M3)

- **ID da tarefa:** TASK-014
- **Milestone:** M3 — benchmark buy-and-hold com custos paper
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Segundo benchmark de M3: `buildBuyAndHoldBenchmark` recebe `agentId`, `initialCashMicros`, uma
coleção não confiável de snapshots, `asset`, `quote`, `assetScale`, uma coleção de
`decisionTimes` e uma `ExecutionPolicy` não confiável, e devolve um `BuyAndHoldBenchmark`
imutável: uma única compra paper no primeiro instante da série de replay, mantida sem nenhuma
outra ordem e marcada a mercado em todos os pontos seguintes. Não vende ao final — o patrimônio
devolvido é marcação a mercado, sem custo de saída. Reutiliza integralmente
`buildReplaySnapshotSeries` (`src/replay/`), `createWallet`/`applyEvent`
(`src/portfolio/portfolio.ts`), `parseOrderIntent`/`parseExecutionPolicy`
(`src/domain/contracts.ts`), `PaperBroker.execute` (`src/broker/paper-broker.ts`),
`microsFromUsdNumber`/`formatIntegerString` (`src/money/fixed-point.ts`) e
`valueWalletAt`/`summarizeEquitySeries` (`src/metrics/`); nenhuma fórmula de preço, fee,
spread, slippage, contabilidade, valoração ou resumo foi duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_013.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/replay/build-replay-snapshot-series.ts`,
`src/benchmark/build-cash-benchmark.ts`, `src/broker/paper-broker.ts`,
`src/domain/contracts.ts`, `src/portfolio/portfolio.ts`, `src/metrics/value-wallet-at.ts`,
`src/metrics/summarize-equity-series.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/benchmark/build-buy-and-hold-benchmark.ts` | criado — `buildBuyAndHoldBenchmark`, `BuyAndHoldBenchmark` |
| `tests/build-buy-and-hold-benchmark.test.ts` | criado |
| `README.md` | atualizado (seção "Benchmark buy-and-hold (compra única com custos paper)") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero
dependências de runtime.

### Design de `buildBuyAndHoldBenchmark`

Segue exatamente a sequência descrita no escopo exato da tarefa, na mesma ordem:

1. `buildReplaySnapshotSeries(snapshots, asset, quote, decisionTimes)` monta a série sem
   look-ahead; qualquer rejeição dela (série vazia, instante não canônico/fora de ordem,
   ausência de snapshot elegível, empate, snapshot malformado) propaga sem captura;
2. `quote !== "USD"` falha fechado antes de gastar qualquer caixa;
3. `createWallet(agentId, initialCashMicros)` cria a carteira cash-only;
4. `parseExecutionPolicy(executionPolicy)` valida a política de custo recebida;
5. o preço do primeiro ponto da série (`series[0].snapshot.price`) é convertido para micros por
   `microsFromUsdNumber` e devolvido à string decimal canônica por `formatIntegerString`, para
   compor um `OrderIntent` BUY de `positionPct: 1` validado por `parseOrderIntent`, com
   `orderId`/`cycleId` determinísticos (`${agentId}-buy-and-hold-${asset}`) e
   `createdAt`/`occurredAt` iguais a `series[0].decisionAt`;
6. `new PaperBroker().execute(...)` roda exatamente uma vez;
7. se o resultado não for `FILLED`, a função falha fechado imediatamente — uma rejeição do
   broker (caixa insuficiente, quantidade pequena demais) nunca vira um benchmark cash nem um
   resultado parcial;
8. `applyEvent(startingWallet, outcome.event)` aplica o fill e deriva `walletAfterPurchase`;
9. cada ponto de `series` é valorado por `valueWalletAt(walletAfterPurchase, point.decisionAt,
   [point.snapshot])` — a carteira nunca muda entre pontos, só o snapshot usado para marcar a
   posição a mercado, o que já garante "sem venda final" por construção;
10. `summarizeEquitySeries(points)` reduz a série valorada ao resumo final.

O `BuyAndHoldBenchmark` devolvido é congelado, junto com `points` (array próprio construído
aqui) — `series`, `walletAfterPurchase`, `initialFill` e `executionPolicy` já chegam congelados
dos módulos reutilizados, então nenhum congelamento é duplicado além do necessário.

### Testes cobertos em `tests/build-buy-and-hold-benchmark.test.ts`

Compra única no primeiro instante mantendo a posição, sem custos; fill incorporando fee, spread
e slippage sob `COSTED_POLICY` (980 atoms, gross 98.980.000, fee 989.800, total 99.969.800 —
mesmos números hand-checkable já documentados na TASK-003); primeiro ponto de patrimônio
refletindo o custo da compra (US$98.030.200 de US$100 iniciais); preço subsequente maior
aumentando o patrimônio e preço menor reduzindo; um snapshot mais novo só afetando pontos após
ficar disponível (réplica do teste de look-ahead da TASK-013, agora sobre o patrimônio);
`availableAt === decisionAt` aceito na fronteira; rejeição de `quote` diferente de "USD",
de série sem snapshot elegível, de `decisionTimes` vazio, de política de execução inválida, de
caixa inicial zero (rejeição `INSUFFICIENT_CASH` do broker) e de preço alto demais para o caixa
disponível (rejeição `QUANTITY_TOO_SMALL` do broker) — todas propagadas como
`ContractValidationError`; ausência de venda final (quantidade detida idêntica em todos os
pontos); exatamente um fill (custo e quantidade final consistentes com uma única ordem sob
`COSTED_POLICY`); ausência de mutação de `snapshots`, `decisionTimes` e da política recebida;
congelamento do resultado e de cada coleção/objeto aninhado; determinismo para o mesmo input
canônico.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **371 testes, 371 passaram, 0 falharam** (353 preexistentes + 18 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio (todo
instante é injetado pelo chamador em cada teste), nenhum uso de `random`.

### Decisões técnicas tomadas

1. **`orderId`/`cycleId` determinísticos, derivados apenas de `agentId` e `asset`
   (`${agentId}-buy-and-hold-${asset}`).** A tarefa exige "mesmo input canônico deve produzir
   resultado idêntico" e proíbe qualquer relógio ou aleatoriedade; um identificador aleatório
   ou baseado em timestamp quebraria o determinismo. Como o benchmark nunca executa mais de uma
   ordem por chamada, um identificador estável por agente/ativo é suficiente e nunca colide
   dentro de uma mesma execução.
2. **`executionPolicy` recebido como `unknown` e validado com `parseExecutionPolicy` dentro da
   função**, em vez de exigir um `ExecutionPolicy` já tipado. A regra obrigatória "Validar
   `ExecutionPolicy` com o parser existente" só faz sentido como uma validação em tempo de
   execução — `ExecutionPolicy` é apenas um tipo estrutural em tempo de compilação, então nada
   impede um chamador de montar um objeto malformado; validar aqui, com o parser já existente,
   evita duplicar as regras de `feeBps`/`spreadBps`/`slippageBps` e ainda documenta a "política
   efetivamente usada" pedida na saída mínima.
3. **A verificação de `quote === "USD"` roda depois de `buildReplaySnapshotSeries`, na ordem
   exata listada em "Escopo exato" da tarefa**, mesmo sendo tecnicamente possível verificar
   antes. Segui a ordem declarada da tarefa em vez de reordenar por preferência própria, porque
   nenhuma das duas ordens muda o comportamento observável (ambas falham fechado sem gastar
   caixa) e a tarefa é explícita sobre a sequência.
4. **Nenhuma classe de erro nova.** Toda rejeição usa `rejectContract`/`ContractValidationError`
   sob o nome de contrato `BuyAndHoldBenchmark`, incluindo a rejeição fail-closed de uma compra
   que não produz `FILL` — a mensagem não repete o código de rejeição do broker (`INSUFFICIENT_CASH`,
   `QUANTITY_TOO_SMALL`, ...) para não se afastar da convenção do repositório de nunca embutir o
   valor/motivo bruto recebido na mensagem de erro.
5. **`points` é o único array congelado por esta função.** `series`, `walletAfterPurchase`,
   `initialFill` e `executionPolicy` já chegam congelados de `buildReplaySnapshotSeries`,
   `applyEvent`/`createWallet`, `PaperBroker.execute` e `parseExecutionPolicy` respectivamente;
   recongelá-los seria redundante.

### Limitações conhecidas

- Não implementa venda ou custo de saída: o patrimônio final é marcação a mercado da posição
  aberta na primeira compra, e um custo de liquidação real ainda não está incluído em nenhum
  ponto da série — documentado no README e no cabeçalho do módulo, como a tarefa exige.
- Não compara o benchmark contra nenhuma estratégia; `compareToCashBenchmark`
  (`src/benchmark/compare-to-cash-benchmark.ts`) só sabe comparar contra `CashBenchmark`, e uma
  comparação genérica está fora do escopo desta tarefa.
- Um par `asset`/`quote` por chamada, como as demais primitivas de replay reutilizadas; um
  benchmark multiativo exigiria uma chamada por ativo.
- Não persiste nada em arquivo; roda inteiramente em memória, como as milestones anteriores.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as cinco decisões acima têm alternativa única e
mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. `git pull --ff-only origin main`/`git fetch origin main` não puderam ser
executados neste ambiente sandboxed (operações de rede exigem aprovação que não foi concedida);
`git status`/`git log`/`git branch -a` confirmaram que a branch já estava no mesmo commit de
`main` (`d4e2eba`) antes de iniciar o trabalho, então nenhuma sincronização adicional era
necessária — mesma limitação já registrada nas entregas anteriores.

### Commit

- **Mensagem:** `feat: adiciona benchmark buy and hold`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-015 — Comparação determinística entre buy-and-hold e cash (quinta fatia de M3)

- **ID da tarefa:** TASK-015
- **Milestone:** M3 — comparação buy-and-hold versus cash
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Terceira comparação determinística de M3: `compareBuyAndHoldToCash` recebe um
`BuyAndHoldBenchmark` e um `CashBenchmark` já construídos e devolve um
`BuyAndHoldVsCashComparison` imutável, sempre da perspectiva do buy-and-hold. Não executa
nenhuma ordem, não reconstrói nenhum dos dois benchmarks e não calcula patrimônio, P&L ou
drawdown — só compara dois resultados já existentes, exatamente como o escopo exato da tarefa
exige (`CashBenchmark + BuyAndHoldBenchmark → BuyAndHoldVsCashComparison`). Reutiliza
integralmente `subtractChecked`/`MAX_MICROS` de `src/money/fixed-point.ts` para toda
comparação monetária; nenhuma fórmula foi duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_014.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/benchmark/build-cash-benchmark.ts`,
`src/benchmark/build-buy-and-hold-benchmark.ts`, `src/benchmark/compare-to-cash-benchmark.ts`,
`src/metrics/summarize-equity-series.ts`, `src/money/fixed-point.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/benchmark/compare-buy-and-hold-to-cash.ts` | criado — `compareBuyAndHoldToCash`, `BuyAndHoldVsCashComparison`, `BuyAndHoldVsCashResult` |
| `tests/compare-buy-and-hold-to-cash.test.ts` | criado |
| `README.md` | atualizado (seção "Comparação entre buy-and-hold e cash"; lista "O que existe hoje" e "Ainda não existem" corrigidas para refletir os benchmarks e comparações já entregues) |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero
dependências de runtime. `src/benchmark/compare-to-cash-benchmark.ts` não foi alterado: nenhuma
correção mínima foi necessária nele.

### Design de `compareBuyAndHoldToCash`

Segue o mesmo formato de `compareToCashBenchmark`, adaptado às duas checagens de consistência
interna extras que os dois benchmarks exigem (uma para cada `kind`):

1. **Validação monetária primeiro** — `assertValidMicros` (duplicado localmente do mesmo padrão
   de `compareToCashBenchmark`, porque `BuyAndHoldBenchmark`/`CashBenchmark` são só tipos
   estruturais em tempo de compilação) valida como `bigint` em `[0, MAX_MICROS]` exatamente os
   seis campos monetários usados pela comparação: `initialCashMicros` dos dois benchmarks,
   `startingEquityMicros`/`endingEquityMicros` do `summary` do cash, `endingEquityMicros` do
   `summary` do buy-and-hold, e o `equityMicros` do último ponto do buy-and-hold.
2. **`kind` de cada benchmark** — `"BUY_AND_HOLD"` e `"CASH"`, exatamente.
3. **Consistência interna `agentId` ↔ `summary.agentId`** — para os dois benchmarks
   separadamente, antes de qualquer comparação cruzada.
4. **Compatibilidade entre os dois benchmarks** — mesmo `agentId`, mesmo `initialCashMicros`, e
   mesmo `startedAt`/`endedAt`/`pointCount` nos dois resumos.
5. **Consistência interna do cash** — `summary.startingEquityMicros` **e**
   `summary.endingEquityMicros` precisam ser iguais ao próprio `initialCashMicros`: uma carteira
   que nunca opera não pode ter patrimônio inicial ou final diferente do capital com que
   começou.
6. **Consistência mínima do buy-and-hold** — `initialFill.side === "BUY"`, e
   `initialFill.agentId`/`asset`/`quote` iguais aos campos externos do próprio benchmark; o
   `equityMicros` do último ponto de `points` precisa ser igual ao `endingEquityMicros` do
   próprio `summary`, para que um `summary` forjado sem relação com os `points` reais também
   falhe fechado. Deliberadamente **não** exige que o primeiro ponto de patrimônio do
   buy-and-hold seja igual a `initialCashMicros` — essa checagem só se aplica ao cash, porque o
   buy-and-hold paga fee/spread na compra de entrada.
7. **Resultado** — a mesma comparação de três vias de `compareToCashBenchmark`
   (`OUTPERFORMED`/`UNDERPERFORMED`/`TIED` + `subtractChecked` para a diferença absoluta), mas
   sempre nomeada a partir do buy-and-hold: `strategyEndingEquityMicros` vira
   `buyAndHoldEndingEquityMicros`, `benchmarkEndingEquityMicros` vira `cashEndingEquityMicros`.

### Testes cobertos em `tests/compare-buy-and-hold-to-cash.test.ts`

Buy-and-hold supera cash (`OUTPERFORMED`, diferença exata); buy-and-hold perde para cash
(`UNDERPERFORMED`, diferença exata); empate (`TIED`, diferença zero); primeiro patrimônio do
buy-and-hold abaixo do capital inicial por custos de entrada aceito normalmente (mesmos números
hand-checkable de `tests/build-buy-and-hold-benchmark.test.ts`: US$98.030.200 de US$100
iniciais); `kind` forjado em cada benchmark separadamente; `agentId` divergente entre os dois
benchmarks e `summary.agentId` internamente divergente em cada benchmark separadamente; capital
inicial divergente; `pointCount` divergente; `endedAt` divergente; `summary.startingEquityMicros`
e `summary.endingEquityMicros` do cash divergindo do seu próprio `initialCashMicros`
(separadamente); `initialFill` que não é `BUY`, e que diverge em `agentId`/`asset`/`quote`
(quatro casos); último ponto do buy-and-hold divergindo do `endingEquityMicros` do próprio
`summary`; valor monetário forjado não-`bigint`, negativo e acima de `MAX_MICROS`; resultado
congelado; ausência de mutação das duas entradas; determinismo para o mesmo input canônico;
testes offline (sem relógio, rede ou aleatoriedade).

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **397 testes, 397 passaram, 0 falharam** (371 preexistentes + 26 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum uso
de `random`. Nenhuma wallet externa, blockchain, testnet, corretora, credencial ou dinheiro
real foi tocado — a tarefa só lê dois benchmarks já construídos em memória.

### Decisões técnicas tomadas

1. **`assertValidMicros` duplicado localmente**, em vez de exportado de
   `src/benchmark/compare-to-cash-benchmark.ts`. O escopo exato desta tarefa é criar
   `src/benchmark/compare-buy-and-hold-to-cash.ts`; a tarefa não autoriza alterar
   `compareToCashBenchmark` além de uma "correção mínima indispensável demonstrada por teste",
   que não foi necessária aqui. A duplicação de uma checagem de seis linhas segue o precedente
   já registrado nas TASK-004, TASK-007 e TASK-008.
2. **Tipo de resultado próprio, `BuyAndHoldVsCashResult`**, em vez de reexportar
   `BenchmarkComparisonResult` de `compare-to-cash-benchmark.ts`. Os dois são a mesma união
   literal de três strings, mas cada módulo de comparação já define seu próprio tipo de
   resultado com nome específico (o padrão de `PnlDirection` em
   `summarize-equity-series.ts`); acoplar este módulo a um tipo nomeado por outra comparação
   pareceu mais confuso do que repetir três literais.
3. **Consistência interna do cash exige patrimônio inicial *e* final iguais a
   `initialCashMicros`**, enquanto `compareToCashBenchmark` só verifica o inicial. A tarefa pede
   explicitamente os dois ("capital inicial igual ao patrimônio inicial e final"); como o cash
   nunca opera, os três valores são sempre iguais em qualquer `CashBenchmark` real — a checagem
   extra só importa contra um `summary` forjado.
4. **O último ponto de `points` é comparado ao `endingEquityMicros` do `summary`, não
   recalculado.** A tarefa proíbe duplicar cálculo de patrimônio; comparar o ponto já existente
   ao resumo já existente prova a consistência interna sem revalorar nada.
5. **Ordem de validação:** monetária → `kind` → `agentId` interno de cada benchmark →
   compatibilidade cruzada → consistência interna do cash → consistência mínima do
   buy-and-hold. Segue a mesma ordem de `compareToCashBenchmark` (monetário antes de
   estrutural), estendida com as duas checagens específicas de cada `kind` por último, porque
   elas dependem de campos (`initialFill`, `points`) que a validação monetária/estrutural básica
   já não precisa tocar.

### Limitações conhecidas

- Compara exatamente um `BuyAndHoldBenchmark` contra exatamente um `CashBenchmark`; não produz
  ranking entre agentes nem compara mais de dois benchmarks de uma vez — fora do escopo exato
  desta tarefa.
- Não valida nenhum campo de `initialFill` além de `side`/`agentId`/`asset`/`quote` (por
  exemplo, `quantityAtoms` ou `totalMicros`): esses valores não são usados pela comparação, e
  validá-los duplicaria checagens que já pertencem a `buildBuyAndHoldBenchmark`.
- Não persiste nada em arquivo; opera inteiramente em memória, como as milestones anteriores.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as cinco decisões acima têm alternativa única e
mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. `git fetch origin`/`git pull` exigiram aprovação de rede não concedida neste
ambiente sandboxed — mesma limitação já registrada na entrega da TASK-014; `git status`/`git
log`/`git branch -a` confirmaram que a branch de trabalho (`claude/issue-26-20260919-1558`) já
partia do commit mais recente disponível localmente, sem alterações pendentes, então nenhuma
sincronização adicional era possível ou necessária.

### Commit

- **Mensagem:** `feat: compara buy and hold com cash`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-016 — Drawdown percentual determinístico (sexta fatia de M3)

- **ID da tarefa:** TASK-016
- **Milestone:** M3 — drawdown percentual determinístico
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Sexta fatia de M3: `summarizeDrawdownRate` recebe uma coleção não vazia de `EquityPoint`
já calculados de um agente e devolve um `DrawdownRateSummary` imutável, expressando o maior
drawdown absoluto que `summarizeEquitySeries` já encontrou como um percentual em basis
points inteiros, arredondado para baixo. Não recalcula patrimônio, não reimplementa a
detecção de pico/vale, não reavalia carteira e não executa ordens — reutiliza integralmente
`summarizeEquitySeries` para o drawdown absoluto e sua evidência de pico/vale, e
`mulDivFloor`/`MAX_MICROS` de `src/money/fixed-point.ts` para a única divisão desta fatia;
nenhuma fórmula monetária ou de pico/vale foi duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_015.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/metrics/value-wallet-at.ts`,
`src/metrics/summarize-equity-series.ts`, `src/money/fixed-point.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/metrics/summarize-drawdown-rate.ts` | criado — `summarizeDrawdownRate`, `DrawdownRateSummary` |
| `tests/summarize-drawdown-rate.test.ts` | criado |
| `README.md` | atualizado (seção "Drawdown percentual determinístico"; listas "O que existe hoje"/"Ainda não existem" corrigidas para refletir a entrega) |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero
dependências de runtime. `src/metrics/summarize-equity-series.ts` não foi alterado: nenhuma
correção mínima foi necessária nele.

### Design de `summarizeDrawdownRate`

1. Chama `summarizeEquitySeries(points)` exatamente uma vez — toda validação de entrada
   (coleção vazia, agentes mistos, timestamps não canônicos/duplicados/fora de ordem,
   dinheiro inválido) e toda a detecção de pico/vale do maior drawdown absoluto vêm
   inteiramente dessa chamada, sem reimplementação.
2. Localiza, na própria coleção `points` recebida, o ponto cujo `valuedAt` é exatamente
   `summary.maxDrawdownPeakAt`, e usa o `equityMicros` **desse ponto específico** como
   `maxDrawdownPeakEquityMicros` — nunca o `peakEquityMicros` (pico global final) devolvido
   por `EquitySeriesSummary`, que pode ser um pico posterior e maior do que aquele de onde o
   maior drawdown realmente partiu (exigência explícita da tarefa). Esse valor é
   revalidado como `bigint` em `[0, MAX_MICROS]` antes do uso, na mesma linha defensiva já
   usada por `summarizeEquitySeries`/`valueWalletAt` para valores que um chamador poderia
   ter construído manualmente.
3. Se `maxDrawdownMicros === 0n`, devolve `maxDrawdownBps = 0` diretamente, sem dividir.
4. Caso contrário, calcula `mulDivFloor(maxDrawdownMicros, 10_000n, maxDrawdownPeakEquityMicros)`
   — a única divisão desta fatia, inteiramente em `bigint`, reaproveitando o `floor` já
   centralizado em `src/money/fixed-point.ts` — e só converte o resultado para `number`
   depois de provar que ele é um inteiro em `[0, 10_000]`. Um pico igual a zero com
   drawdown positivo falha fechado com `ContractValidationError` antes da divisão.

### Testes cobertos em `tests/summarize-drawdown-rate.test.ts`

Drawdown zero em série estritamente crescente (`maxDrawdownBps === 0`); drawdown de 100%
(equity cai a zero, `maxDrawdownBps === 10_000`); drawdown fracionário com arredondamento
`FLOOR` (`100_000_000 / 300_000_000` → `3_333`, não `3_334`); maior drawdown absoluto usando
o pico correto mesmo quando um pico global maior ocorre depois (série 100M → 50M → 1000M →
990M: `maxDrawdownPeakEquityMicros` é 100M, não 1000M); recuperação após o fundo preservando
a evidência do maior drawdown; série de um único ponto (`maxDrawdownBps === 0`); rejeição de
coleção vazia, agentes mistos, timestamp não canônico, timestamps fora de ordem e dinheiro
inválido (negativo e acima de `MAX_MICROS`) — todos delegados a `summarizeEquitySeries`;
congelamento do resultado; ausência de mutação dos pontos recebidos; determinismo para o
mesmo input canônico. Suíte offline: nenhum acesso de rede, nenhuma leitura de relógio,
nenhum uso de `random`.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **412 testes, 412 passaram, 0 falharam** (397 preexistentes + 15 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum
uso de `random`. Nenhuma wallet externa, blockchain, testnet, corretora, credencial ou
dinheiro real foi tocado — a tarefa só reduz pontos de patrimônio já existentes em memória.

### Decisões técnicas tomadas

1. **`assertValidEquityMicros` duplicado localmente**, com a mesma checagem já usada em
   `summarize-equity-series.ts` e `value-wallet-at.ts` (não exportada de lá). O escopo exato
   desta tarefa é criar `src/metrics/summarize-drawdown-rate.ts`; a duplicação de uma
   checagem de quatro linhas segue o precedente já registrado nas TASK-004, TASK-007,
   TASK-008 e TASK-015.
2. **O pico é obtido por busca (`Array.find`) na coleção `points` recebida pelo `valuedAt`
   de `maxDrawdownPeakAt`, nunca por um novo cálculo de pico/vale.** A tarefa proíbe
   duplicar o algoritmo de pico/vale; localizar o ponto já existente que corresponde à
   evidência devolvida por `summarizeEquitySeries` prova a correspondência exata sem
   recalcular nada. Como `summarizeEquitySeries` já garante timestamps estritamente
   crescentes (portanto únicos) e `maxDrawdownPeakAt` é sempre o `valuedAt` de um ponto
   real da série, essa busca sempre encontra exatamente um ponto para qualquer entrada que
   `summarizeEquitySeries` aceitou.
3. **A checagem "drawdown positivo com pico igual a zero" está implementada, mas é
   inatingível através da API pública com uma entrada válida.** `summarizeEquitySeries`
   calcula cada drawdown como `subtractChecked(pico, patrimônio, ...)`, que exige
   `patrimônio ≤ pico` e nunca produz negativo; e o ponto que localizamos em
   `maxDrawdownPeakAt` é exatamente o ponto cujo `equityMicros` foi lido como esse mesmo
   `pico` no momento em que o maior drawdown foi registrado. Logo, se o pico fosse zero, o
   drawdown também seria zero, e o branch de drawdown positivo nunca seria alcançado. A
   checagem foi mantida porque a tarefa a exige explicitamente na definição matemática,
   como salvaguarda documentada contra uma futura mudança em `summarizeEquitySeries` que
   quebrasse essa invariante — não porque um teste real da suíte a alcança (nenhum teste da
   lista obrigatória da tarefa pede esse cenário, e não existe forma de construir um
   `EquityPoint[]` válido, aceito por `summarizeEquitySeries`, que o alcance).
4. **Nenhuma classe de erro nova.** Toda rejeição usa `rejectContract`/
   `ContractValidationError`, com o nome de contrato `"DrawdownRateSummary"`, o mesmo
   mecanismo de todo o resto de `src/metrics/`.
5. **`maxDrawdownBps` é revalidado no intervalo `[0, 10_000]` antes da conversão para
   `number`**, mesmo sendo matematicamente garantido pela relação `drawdownMicros ≤
   peakMicros`. A tarefa exige explicitamente que a conversão para `number` só ocorra
   "já provado no intervalo inteiro `[0, 10_000]`"; a checagem torna essa prova explícita no
   código, em vez de depender apenas do raciocínio matemático externo a ele.

### Limitações conhecidas

- Não calcula win rate, P&L realizado por trade, replay de ciclos ou benchmarks — fora do
  escopo exato desta tarefa.
- Não persiste nada em arquivo; opera inteiramente em memória, como as milestones
  anteriores.
- A busca linear do ponto de pico (`Array.find`) é O(n) na quantidade de pontos da série;
  não há índice por timestamp, porque a tarefa não exige desempenho para séries grandes
  nesta fatia.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as cinco decisões acima têm alternativa
única e mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. Como nas TASK-014/TASK-015, `git fetch origin main` exigiu aprovação de
rede não concedida neste ambiente sandboxed; `git status`/`git log`/`git branch -vv`
confirmaram que a branch de trabalho (`claude/issue-28-20260919-1610`) já partia do commit
mais recente (`a25ce46`, idêntico a `origin/main`), sem alterações pendentes, então nenhuma
sincronização adicional era possível ou necessária.

### Commit

- **Mensagem:** `feat: calcula drawdown percentual`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-017 — Comparação determinística entre estratégia e buy-and-hold (sétima fatia de M3)

- **ID da tarefa:** TASK-017
- **Milestone:** M3 — comparação determinística estratégia versus buy-and-hold
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Sétima fatia de M3: `compareStrategyToBuyAndHold` recebe o `EquitySeriesSummary` de uma
estratégia e um `BuyAndHoldBenchmark` do mesmo experimento e devolve um
`StrategyVsBuyAndHoldComparison` imutável e auditável, medindo apenas se a estratégia
terminou acima, abaixo ou empatada com o benchmark — sempre da perspectiva da estratégia.
Não executa nenhuma ordem, não reconstrói o benchmark, não reavalia carteira e não usa
Risk Manager, Broker ou replay. Reutiliza integralmente `EquitySeriesSummary`
(`src/metrics/summarize-equity-series.ts`) e `BuyAndHoldBenchmark`
(`src/benchmark/build-buy-and-hold-benchmark.ts`) como entrada já computada, e
`subtractChecked`/`MAX_MICROS` de `src/money/fixed-point.ts` para a única aritmética
monetária desta fatia; nenhuma fórmula de patrimônio, P&L ou custo é duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/coordination/CHATGPT_REVIEW_TASK_016.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/metrics/summarize-equity-series.ts`,
`src/benchmark/build-buy-and-hold-benchmark.ts`,
`src/benchmark/compare-to-cash-benchmark.ts`, `src/benchmark/compare-buy-and-hold-to-cash.ts`
e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/benchmark/compare-strategy-to-buy-and-hold.ts` | criado — `compareStrategyToBuyAndHold`, `StrategyVsBuyAndHoldComparison`, `StrategyVsBuyAndHoldResult` |
| `tests/compare-strategy-to-buy-and-hold.test.ts` | criado |
| `README.md` | atualizado (seção "Comparação entre estratégia e buy-and-hold"; listas "O que existe hoje" atualizadas) |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero
dependências de runtime. Nenhum dos módulos reutilizados (`summarize-equity-series.ts`,
`build-buy-and-hold-benchmark.ts`, `compare-to-cash-benchmark.ts`,
`compare-buy-and-hold-to-cash.ts`) foi alterado.

### Design de `compareStrategyToBuyAndHold`

A função funde os dois padrões já estabelecidos pelos comparadores existentes, porque este é
o primeiro comparador cujos dois lados (um `EquitySeriesSummary` externo e um
`BuyAndHoldBenchmark`) exigem, ao mesmo tempo, checagem de compatibilidade entre dois
resumos independentes (como em `compareToCashBenchmark`) **e** checagem de consistência
interna do próprio `BuyAndHoldBenchmark` (como em `compareBuyAndHoldToCash`):

1. Todo valor monetário lido — `strategySummary.startingEquityMicros`,
   `strategySummary.endingEquityMicros`, `buyAndHoldBenchmark.initialCashMicros`,
   `buyAndHoldBenchmark.summary.endingEquityMicros` e
   `buyAndHoldBenchmark.points[último].equityMicros` — é revalidado como `bigint` em
   `[0, MAX_MICROS]` antes de qualquer comparação, porque `EquitySeriesSummary` e
   `BuyAndHoldBenchmark` são apenas tipos estruturais em tempo de compilação.
2. Consistência estrutural mínima do benchmark recebido, reutilizando exatamente as mesmas
   checagens que `compareBuyAndHoldToCash` já aplica ao lado buy-and-hold: `kind` precisa
   ser `"BUY_AND_HOLD"`; `summary.agentId` precisa coincidir com o `agentId` externo do
   benchmark; `initialFill` precisa ser uma `BUY` cujo `agentId`/`asset`/`quote` coincidam
   com os campos externos do benchmark; e o último ponto de `points` precisa ter
   `equityMicros` igual ao `endingEquityMicros` do próprio `summary`.
3. Compatibilidade entre a estratégia e o benchmark — mesmo experimento: `agentId`,
   `startedAt`, `endedAt`, `pointCount` idênticos, e `strategySummary.startingEquityMicros`
   igual a `buyAndHoldBenchmark.initialCashMicros`.
4. Só então compara os dois patrimônios finais: `strategyEndingEquityMicros` contra
   `buyAndHoldEndingEquityMicros`. `result` é `OUTPERFORMED`/`UNDERPERFORMED`/`TIED` da
   perspectiva da estratégia; `differenceMagnitudeMicros` é a diferença absoluta exata,
   calculada com `subtractChecked`. Qualquer falha nas etapas 1–3 lança
   `ContractValidationError` antes de qualquer comparação — nunca um resultado parcial.

Um primeiro ponto de patrimônio do buy-and-hold abaixo do capital inicial (fee/spread da
compra de entrada) é aceito normalmente, como já é o caso em `compareBuyAndHoldToCash`: essa
fatia compara apenas os patrimônios finais, nunca o caminho intermediário da série.

### Testes cobertos em `tests/compare-strategy-to-buy-and-hold.test.ts`

Estratégia supera buy-and-hold (`OUTPERFORMED`) e perde (`UNDERPERFORMED`), com diferença
exata; empate (`TIED`) com diferença zero; diferença exata de 1 micro nos dois sentidos;
rejeição por divergência de `agentId`, `startedAt`, `endedAt`, `pointCount` e patrimônio
inicial entre estratégia e benchmark; rejeição de benchmark estruturalmente inconsistente —
`kind` forjado, `summary.agentId` interno divergente, `initialFill` que não é `BUY` ou cujo
`agentId`/`asset`/`quote` divergem do benchmark, e último ponto divergente do
`endingEquityMicros` do próprio resumo; rejeição de dinheiro inválido — `endingEquityMicros`
não-`bigint`, negativo, acima de `MAX_MICROS`, e `initialCashMicros` forjado no benchmark;
cenário de custos de entrada deixando o primeiro/único ponto do buy-and-hold abaixo do
capital inicial, comparado corretamente; congelamento do resultado; ausência de mutação de
ambas as entradas; determinismo para o mesmo input canônico; suíte offline (sem relógio,
rede ou aleatoriedade, apenas `bigint`).

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **438 testes, 438 passaram, 0 falharam** (412 preexistentes + 26 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum
uso de `random`. Nenhuma wallet externa, blockchain, testnet, corretora, credencial ou
dinheiro real foi tocado — a tarefa só compara resumos de patrimônio já computados em
memória.

### Decisões técnicas tomadas

1. **A checagem de consistência interna do benchmark é copiada literalmente de
   `compareBuyAndHoldToCash`, não fatorada num helper compartilhado.** `TASK.md` restringe o
   escopo exato desta tarefa à criação de
   `src/benchmark/compare-strategy-to-buy-and-hold.ts`; extrair um helper obrigaria alterar
   `compare-buy-and-hold-to-cash.ts` (ou criar um novo módulo compartilhado não pedido pela
   tarefa) só para eliminar uma duplicação pequena e já presente no repositório entre
   `compare-to-cash-benchmark.ts` e `compare-buy-and-hold-to-cash.ts` (a própria
   `assertValidMicros` já é duplicada nos dois). Repetir a checagem aqui segue o precedente
   já estabelecido nessas duas tarefas anteriores.
2. **Nome do tipo de resultado `StrategyVsBuyAndHoldComparison`, do enum
   `comparisonKind: "STRATEGY_VS_BUY_AND_HOLD"` e da função
   `compareStrategyToBuyAndHold`.** `TASK.md` define formalmente
   `EquitySeriesSummary + BuyAndHoldBenchmark → StrategyVsBuyAndHoldComparison`; o nome da
   função e o `comparisonKind` seguem a mesma convenção de nomenclatura já usada por
   `compareBuyAndHoldToCash`/`comparisonKind: "BUY_AND_HOLD_VS_CASH"`.
3. **Nenhuma classe de erro nova.** Toda rejeição usa `rejectContract`/
   `ContractValidationError`, com o nome de contrato `"StrategyVsBuyAndHoldComparison"`, o
   mesmo mecanismo de todo o resto de `src/benchmark/`.
4. **A ordem das checagens segue exatamente a de `compareBuyAndHoldToCash`**: primeiro toda
   validação de dinheiro (`assertValidMicros`), depois a consistência interna do benchmark
   (`kind`, `summary.agentId`, `initialFill`, último ponto), e só então a compatibilidade
   entre os dois lados da comparação (`agentId`, `startedAt`, `endedAt`, `pointCount`,
   patrimônio inicial) — preserva o padrão já revisado e aceito nas duas tarefas anteriores
   de comparação.

### Limitações conhecidas

- Compara apenas os patrimônios finais; não considera drawdown, volatilidade ou trajetória
  intermediária da série — fora do escopo exato desta tarefa.
- Não calcula win rate, P&L realizado por trade ou ranking multiagente — fora do escopo
  exato desta tarefa e explicitamente listado como fora de escopo em `TASK.md`.
- Não persiste nada em arquivo; opera inteiramente em memória, como as milestones
  anteriores.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as quatro decisões acima têm alternativa
única e mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. `git fetch` exigiu aprovação não concedida neste ambiente sandboxed;
`git rev-parse main origin/main HEAD` confirmou que os três apontam para o mesmo commit
(`d16a26a`) e `git status` confirmou árvore de trabalho limpa antes de iniciar, então a
branch de trabalho já partia sincronizada com `main` e nenhuma sincronização adicional era
possível ou necessária.

### Commit

- **Mensagem:** `feat: compara estratégia com buy-and-hold`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-018 — Relatório determinístico consolidado de benchmarks (M3)

- **ID da tarefa:** TASK-018
- **Milestone:** M3 — relatório determinístico consolidado de benchmarks
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Menor composição do replay de M3: `buildStrategyBenchmarkReport` recebe o
`EquitySeriesSummary` de uma estratégia, um `CashBenchmark` e um `BuyAndHoldBenchmark` do
mesmo experimento e devolve um `StrategyBenchmarkReport` imutável e auditável, consolidando
as duas comparações já existentes (`compareToCashBenchmark` e
`compareStrategyToBuyAndHold`) numa única estrutura, com a identificação comum do
experimento. Não executa nenhuma ordem, broker, risco ou replay; não reconstrói nenhum
benchmark; não recalcula nenhuma fórmula monetária ou de comparação — reutiliza
integralmente as duas funções de comparação exigidas pela tarefa.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/coordination/CHATGPT_REVIEW_TASK_017.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/benchmark/compare-to-cash-benchmark.ts`,
`src/benchmark/compare-strategy-to-buy-and-hold.ts`, `src/benchmark/build-cash-benchmark.ts`,
`src/benchmark/build-buy-and-hold-benchmark.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/benchmark/build-strategy-benchmark-report.ts` | criado — `buildStrategyBenchmarkReport`, `StrategyBenchmarkReport` |
| `tests/build-strategy-benchmark-report.test.ts` | criado |
| `README.md` | atualizado (seção "Relatório determinístico consolidado de benchmarks") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com
zero dependências de runtime.

### Design de `buildStrategyBenchmarkReport`

Recebe `(strategySummary, cashBenchmark, buyAndHoldBenchmark)` e:

1. chama `compareToCashBenchmark(strategySummary, cashBenchmark)` exatamente uma vez;
2. chama `compareStrategyToBuyAndHold(strategySummary, buyAndHoldBenchmark)` exatamente uma
   vez;
3. devolve um `StrategyBenchmarkReport` congelado com a identificação comum do experimento
   (`agentId`, `startedAt`, `endedAt`, `pointCount`, `startingEquityMicros`,
   `strategyEndingEquityMicros`) lida dos próprios resultados dessas duas chamadas, mais os
   dois objetos de comparação (`vsCash`, `vsBuyAndHold`) carregados verbatim — mesmos valores
   em micros, mesma direção (`OUTPERFORMED`/`UNDERPERFORMED`/`TIED`) — sem transformação.

Nenhuma das duas chamadas de comparação é envolvida em `try/catch`: uma rejeição de qualquer
uma delas propaga como `ContractValidationError` para o chamador, exatamente como a tarefa
exige ("falhe fechado quando qualquer entrada for incompatível ou inconsistente").

### Por que nenhuma checagem cruzada extra entre os dois benchmarks foi adicionada

`compareToCashBenchmark` já exige que `strategySummary.agentId`/`startedAt`/`endedAt`/
`pointCount`/`startingEquityMicros` coincidam com o `cashBenchmark`; `compareStrategyToBuyAndHold`
exige exatamente o mesmo conjunto de campos contra o `buyAndHoldBenchmark`. Como as duas
comparações usam o mesmo `strategySummary` como referência comum, chamar as duas garante,
por transitividade, que os dois benchmarks concordam entre si nesses campos — nenhuma
terceira checagem comparando `cashBenchmark` a `buyAndHoldBenchmark` diretamente foi
necessária ou adicionada, o que também evita duplicar uma regra que `compareBuyAndHoldToCash`
já implementa para esse par específico, mas que esta tarefa não pede para reutilizar.

### Testes cobertos em `tests/build-strategy-benchmark-report.test.ts`

Relatório consolidado com a estratégia superando os dois benchmarks; quatro combinações
distintas de resultado (supera caixa e perde do buy-and-hold; empata caixa e perde do
buy-and-hold; supera caixa e empata buy-and-hold; perde dos dois); propagação fail-closed de
divergências herdadas da comparação com o caixa (agentId incompatível, `kind` forjado do
`CashBenchmark`, `summary.agentId` interno divergente, patrimônio inicial divergente do
`initialCashMicros`) e da comparação com o buy-and-hold (`kind` forjado do
`BuyAndHoldBenchmark`, `initialFill` que não é uma `BUY`, `pointCount` divergente); prova de
que `vsCash` e `vsBuyAndHold` são exatamente o mesmo objeto que uma chamada direta a
`compareToCashBenchmark`/`compareStrategyToBuyAndHold` produziria (`deepEqual`); congelamento
do relatório; ausência de mutação dos três parâmetros recebidos; determinismo do relatório
completo para o mesmo input canônico; testes offline (nenhum valor monetário sai de
`bigint`).

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **456 testes, 456 passaram, 0 falharam** (438 preexistentes + 18 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum
uso de `random`. `git rev-parse main origin/main HEAD` confirmou que os três apontavam para
o mesmo commit (`8bef3a3`) e `git status` confirmou árvore de trabalho limpa antes de
iniciar, então a branch de trabalho já partia sincronizada com `main`.

### Decisões técnicas tomadas

1. **`StrategyBenchmarkReport` carrega os dois objetos de comparação completos
   (`vsCash: BenchmarkComparison`, `vsBuyAndHold: StrategyVsBuyAndHoldComparison`) em vez de
   apenas seus campos de resultado.** A tarefa exige preservar "os resultados exatos em
   micros e os sentidos das comparações" — carregar o objeto inteiro, produzido inalterado
   pela função reutilizada, é a forma mais direta de não duplicar nem transformar nenhum
   valor, e mantém `differenceMagnitudeMicros` de cada comparação auditável no relatório.
2. **`reportKind: "STRATEGY_BENCHMARK_REPORT"` foi adicionado por simetria com `kind` em
   `CashBenchmark`/`BuyAndHoldBenchmark` e `comparisonKind` em
   `StrategyVsBuyAndHoldComparison`/`BuyAndHoldVsCashComparison`.** Não é exigido literalmente
   pela tarefa, mas seguir a convenção já estabelecida no módulo torna o relatório
   identificável em runtime sem inspecionar sua forma, e é consistente com "relatório
   imutável" auditável.
3. **Nenhuma checagem cruzada direta entre `cashBenchmark` e `buyAndHoldBenchmark`.**
   Decisão técnica detalhada na seção acima: é redundante por transitividade, dado que ambos
   já são validados contra o mesmo `strategySummary`.
4. **`startingEquityMicros` e `strategyEndingEquityMicros` do relatório vêm de
   `strategySummary`/`vsCash` diretamente, sem revalidação local.** Ambos já foram validados
   como `Micros` em `[0, MAX_MICROS]` dentro de `compareToCashBenchmark` antes de essa chamada
   retornar sem lançar; revalidar aqui duplicaria a checagem monetária que a tarefa proíbe
   duplicar.
5. **Nenhuma classe de erro nova.** Toda rejeição vem de `compareToCashBenchmark` ou
   `compareStrategyToBuyAndHold`, ambas já usando `ContractValidationError` — não há
   necessidade nem espaço no escopo exato da tarefa para uma terceira variante de erro.

### Limitações conhecidas

- Não calcula win rate, P&L realizado por trade ou ranking multiagente — explicitamente fora
  do escopo desta tarefa em `TASK.md`.
- Não compara `cashBenchmark` e `buyAndHoldBenchmark` diretamente entre si (isso já existe em
  `compareBuyAndHoldToCash`, não incluído neste relatório porque a tarefa define o relatório
  apenas em torno das duas comparações centradas na estratégia).
- Não persiste nada em arquivo; opera inteiramente em memória, como as milestones anteriores.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as cinco decisões acima têm alternativa
única e mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. `git fetch` exigiu aprovação não concedida neste ambiente sandboxed, na
mesma linha já registrada na TASK-017; `git rev-parse main origin/main HEAD` confirmou que os
três apontavam para o mesmo commit e `git status` confirmou árvore de trabalho limpa antes de
iniciar, então nenhuma sincronização adicional era possível ou necessária.

### Commit

- **Mensagem:** `feat: consolida relatório de benchmarks`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-019 — Relatório triangular completo de benchmarks (M3)

- **ID da tarefa:** TASK-019
- **Milestone:** M3 — relatório triangular completo de benchmarks
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Completa o relatório consolidado de M3: `buildStrategyBenchmarkReport` agora chama também
`compareBuyAndHoldToCash` exatamente uma vez, além das duas comparações já existentes
(`compareToCashBenchmark` e `compareStrategyToBuyAndHold`), e inclui no
`StrategyBenchmarkReport` o objeto completo `BuyAndHoldVsCashComparison` (campo
`buyAndHoldVsCash`), verbatim. O relatório passa a conter as três comparações pareadas entre
estratégia, caixa e buy-and-hold — um relatório triangular. Não recalcula nenhuma métrica,
não reconstrói nenhum benchmark e não duplica nenhuma fórmula ou validação monetária.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/coordination/CHATGPT_REVIEW_TASK_018.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/benchmark/build-strategy-benchmark-report.ts`,
`src/benchmark/compare-to-cash-benchmark.ts`, `src/benchmark/compare-strategy-to-buy-and-hold.ts`,
`src/benchmark/compare-buy-and-hold-to-cash.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/benchmark/build-strategy-benchmark-report.ts` | atualizado — chama também `compareBuyAndHoldToCash` e adiciona `buyAndHoldVsCash` ao `StrategyBenchmarkReport` |
| `tests/build-strategy-benchmark-report.test.ts` | atualizado — cobre a terceira comparação e sua checagem fail-closed exclusiva |
| `README.md` | atualizado (seção "Relatório triangular determinístico consolidado de benchmarks") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com
zero dependências de runtime.

### Design da mudança

`buildStrategyBenchmarkReport(strategySummary, cashBenchmark, buyAndHoldBenchmark)` agora:

1. chama `compareToCashBenchmark(strategySummary, cashBenchmark)` exatamente uma vez (sem
   mudança em relação à TASK-018);
2. chama `compareStrategyToBuyAndHold(strategySummary, buyAndHoldBenchmark)` exatamente uma
   vez (sem mudança);
3. chama `compareBuyAndHoldToCash(buyAndHoldBenchmark, cashBenchmark)` exatamente uma vez —
   a nova chamada exigida pela tarefa;
4. devolve o `StrategyBenchmarkReport` congelado com a mesma identificação comum do
   experimento de antes, mais os três objetos de comparação (`vsCash`, `vsBuyAndHold`,
   `buyAndHoldVsCash`) carregados verbatim, sem transformação.

Nenhuma das três chamadas é envolvida em `try/catch`: uma rejeição de qualquer uma delas
propaga como `ContractValidationError` para o chamador, herdando fail-closed exclusivamente
dos comparadores existentes, como a tarefa exige.

### Por que `compareBuyAndHoldToCash` não é redundante, mesmo com as outras duas chamadas

Como já registrado na TASK-018, `compareToCashBenchmark` e `compareStrategyToBuyAndHold`
já garantem, por transitividade (via `strategySummary` comum), que os benchmarks cash e
buy-and-hold concordam entre si em `agentId`/`startedAt`/`endedAt`/`pointCount`/patrimônio
inicial. Isso tornaria a maior parte das checagens de compatibilidade de
`compareBuyAndHoldToCash` redundante. No entanto, `compareBuyAndHoldToCash` verifica uma
invariante que nenhuma das outras duas chamadas checa: que o patrimônio final do
`CashBenchmark` (`cashBenchmark.summary.endingEquityMicros`) é igual ao seu próprio
`initialCashMicros` — "uma carteira só-caixa que nunca negocia não pode se mover".
`compareToCashBenchmark` valida apenas que o patrimônio **inicial** do resumo do cash
benchmark bate com `initialCashMicros`; nunca valida o patrimônio final do próprio cash
benchmark contra esse mesmo valor. Por isso a chamada direta a `compareBuyAndHoldToCash`
não é apenas uma cópia por simetria: ela fecha uma lacuna de validação real, sem duplicar
nenhuma fórmula (a checagem já existe dentro da própria função reutilizada). Há teste
dedicado (`tests/build-strategy-benchmark-report.test.ts`, describe "fail-closed propagation
from the buy-and-hold-vs-cash comparison") que forja um `CashBenchmark` com patrimônio final
divergente do `initialCashMicros`, mantendo tudo o mais válido, e confirma que só a terceira
chamada rejeita esse caso.

### Nome do novo campo (`buyAndHoldVsCash`)

`TASK.md` não define um nome literal para o campo — apenas exige "incluir no relatório o
objeto completo `BuyAndHoldVsCashComparison`, sem transformação". Nomeei o campo
`buyAndHoldVsCash`, espelhando o nome do próprio tipo (`BuyAndHoldVsCashComparison`) e a
convenção já usada pelos outros dois campos (`vsCash`, `vsBuyAndHold`, ambos do ponto de
vista da estratégia); como esta terceira comparação não envolve a estratégia, um prefixo
`vs` sozinho seria ambíguo sobre a partir de qual perspectiva.

### Testes cobertos (adicionados/atualizados) em `tests/build-strategy-benchmark-report.test.ts`

Todas as combinações de vitória/derrota/empate já existentes passam a também afirmar
`buyAndHoldVsCash` (constante nesses casos, pois cash e buy-and-hold não mudam entre eles);
novo caso de empate entre buy-and-hold e cash quando o preço do ativo do buy-and-hold nunca
se move; nova checagem fail-closed exclusiva da terceira comparação (patrimônio final do
`CashBenchmark` divergente do próprio `initialCashMicros`, não capturado por nenhuma das
outras duas chamadas); prova de que `buyAndHoldVsCash` é exatamente o mesmo objeto que uma
chamada direta a `compareBuyAndHoldToCash` produziria (`deepEqual`). Os testes de
congelamento, ausência de mutação, determinismo e offline já existentes cobrem o relatório
completo (incluindo o novo campo) sem alteração de estrutura.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **459 testes, 459 passaram, 0 falharam** (456 preexistentes + 3 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum
uso de `random`. A branch de trabalho (`claude/issue-34-20260919-1836`) já partia
sincronizada com `main`: `git log main..HEAD` e `git log HEAD..main` vazios, e `git status`
confirmou árvore de trabalho limpa antes de iniciar.

### Decisões técnicas tomadas

1. **`compareBuyAndHoldToCash` é chamada com `(buyAndHoldBenchmark, cashBenchmark)`, na
   mesma ordem de parâmetros da própria função reutilizada.** Nenhuma inversão ou adaptação
   foi necessária porque o relatório já recebe os dois benchmarks nessa forma.
2. **O campo novo se chama `buyAndHoldVsCash`, não `vsBuyAndHoldVsCash` ou similar.** Decisão
   detalhada acima; segue o nome do próprio tipo devolvido.
3. **Nenhuma checagem cruzada adicional foi escrita à mão entre `cashBenchmark` e
   `buyAndHoldBenchmark`.** A tarefa proíbe duplicar validação monetária; a única lacuna real
   (patrimônio final do cash) já é fechada pela própria chamada a `compareBuyAndHoldToCash`,
   então nenhum código de checagem adicional foi necessário no corpo de
   `buildStrategyBenchmarkReport`.
4. **Nenhuma classe de erro nova.** Toda rejeição continua vindo de uma das três funções de
   comparação reutilizadas, todas já usando `ContractValidationError`.

### Limitações conhecidas

- Continua sem calcular win rate, P&L realizado por trade ou ranking multiagente —
  explicitamente fora do escopo desta tarefa em `TASK.md`.
- O relatório triangular continua operando inteiramente em memória; nenhuma persistência em
  arquivo foi adicionada.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; a única questão de nomenclatura (campo
`buyAndHoldVsCash`) tem justificativa única e está registrada acima para revisão.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. `git fetch origin main` exigiu aprovação não concedida neste ambiente
sandboxed, na mesma linha já registrada nas TASK-017 e TASK-018; `git log main..HEAD`,
`git log HEAD..main` (ambos vazios) e `git status` (árvore limpa) confirmaram que a branch de
trabalho já partia sincronizada com `main`, então nenhuma sincronização adicional era
possível ou necessária.

### Commit

- **Mensagem:** `feat: completa relatório triangular de benchmarks`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-020 — Resultado realizado de um round trip paper fechado (M3)

- **ID da tarefa:** TASK-020
- **Milestone:** M3 — resultado realizado de um round trip paper
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Menor primitiva auditável de P&L realizado do replay: `summarizeClosedRoundTrip` recebe
exatamente um `FillEvent` de abertura BUY e um `FillEvent` de fechamento SELL da mesma
quantidade, ativo, quote e agente, e devolve um `ClosedRoundTripResult` imutável com o
custo realizado, a receita líquida, a direção (`WIN | LOSS | BREAK_EVEN`) e a magnitude
absoluta exata do resultado, calculados exclusivamente a partir de `totalMicros` de cada
fill. Não agrega múltiplos trades, não implementa FIFO/LIFO, não trata posição parcial ou
short, e não executa ordem, broker, risco ou replay. Reutiliza integralmente
`subtractChecked`, `parseAssetScale`, `MAX_MICROS` e `MAX_ATOMS` de
`src/money/fixed-point.ts` para toda validação e comparação monetária; nenhuma fórmula é
duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/coordination/CHATGPT_REVIEW_TASK_019.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/ledger/events.ts`,
`src/metrics/summarize-execution-costs.ts`, `src/money/fixed-point.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/metrics/summarize-closed-round-trip.ts` | criado — `summarizeClosedRoundTrip`, `ClosedRoundTripResult`, `ClosedRoundTripDirection` |
| `tests/summarize-closed-round-trip.test.ts` | criado |
| `README.md` | atualizado (seção "Resultado realizado de um round trip paper fechado") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com
zero dependências de runtime.

### Design de `summarizeClosedRoundTrip`

Recebe `(buyFill: FillEvent, sellFill: FillEvent)`, ambos tipados, mas revalida
defensivamente todo campo do qual depende — o mesmo padrão já usado em
`summarizeExecutionCosts` e nos comparadores de benchmark, porque nada em tempo de
compilação impede um chamador de construir um `FillEvent` à mão com um campo forjado, como
os próprios testes fazem para exercitar cada caminho fail-closed. A validação roda nesta
ordem, antes de qualquer cálculo:

1. `type` de cada fill deve ser `"FILL"`;
2. `buyFill.side` deve ser `"BUY"` e `sellFill.side` deve ser `"SELL"` — lado invertido
   falha fechado;
3. os dois fills não podem compartilhar o mesmo `eventId` — um fill repetido não é um round
   trip;
4. `agentId`, `asset` e `quote` devem coincidir entre as duas pernas;
5. `assetScale` (validado por `parseAssetScale`) deve coincidir;
6. `quantityAtoms` (validado por `assertValidAtoms`) deve coincidir e ser maior que zero;
7. `occurredAt` de cada perna deve ser um timestamp canônico UTC ISO-8601, e o do SELL deve
   ser estritamente posterior ao do BUY;
8. `totalMicros` de cada perna (validado por `assertValidMicros`) deve ser um `bigint` em
   `[0, MAX_MICROS]`.

Só então o custo realizado (`buyFill.totalMicros`) e a receita líquida
(`sellFill.totalMicros`) são comparados com um único `subtractChecked`: `WIN` quando a
receita excede o custo, `LOSS` quando fica abaixo, `BREAK_EVEN` quando são exatamente
iguais (magnitude zero nesse caso, sem chamar `subtractChecked`). O resultado devolvido
carrega `buyEventId`/`sellEventId` para auditoria, além da identidade comum já validada
(`agentId`, `asset`, `quote`, `assetScale`, `quantityAtoms`) e os dois timestamps
(`openedAt`, `closedAt`).

### Por que o cálculo usa só `totalMicros`, sem tocar `feeMicros`

`totalMicros` já é, por definição em `src/ledger/events.ts`, o caixa total movido pelo
fill: `gross + fee` numa BUY, `gross - fee` numa SELL. Somar ou subtrair `feeMicros` de
novo aqui contaria a fee duas vezes. Há teste dedicado (`tests/summarize-closed-round-trip.test.ts`,
describe "fees already reflected in totalMicros") que constrói uma BUY e uma SELL com
`grossMicros`/`feeMicros` explícitos e confirma que `resultMagnitudeMicros` é exatamente
`sellFill.totalMicros - buyFill.totalMicros`, sem nenhum ajuste adicional pela fee.

### Testes cobertos em `tests/summarize-closed-round-trip.test.ts`

Ganho, perda e empate; diferença exata de 1 micro em ambos os sentidos (WIN e LOSS);
fees já refletidas em `totalMicros` sem dupla contagem; rejeição por `agentId`, `asset`,
`quote`, `assetScale` ou `quantityAtoms` divergentes entre as duas pernas; rejeição por
lado de abertura invertido e por lado de fechamento invertido; rejeição do mesmo fill
forjado como as duas pernas (mesmo `eventId`, isolado do teste de lado invertido porque um
fill real nunca pode ser BUY e SELL ao mesmo tempo); rejeição de timestamp não canônico, de
timestamp de fechamento igual ao de abertura e de timestamp de fechamento anterior ao de
abertura; rejeição de dinheiro inválido em cada perna; congelamento do resultado; ausência
de mutação de qualquer um dos dois fills recebidos; determinismo do resultado completo para
o mesmo input canônico; identidade completa do resultado (`buyEventId`, `sellEventId`,
`agentId`, `asset`, `quote`, `assetScale`, `quantityAtoms`, `openedAt`, `closedAt`). Toda a
suíte é offline: nenhum valor monetário sai de `bigint`, nenhuma chamada de rede, relógio
ou aleatoriedade.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **482 testes, 482 passaram, 0 falharam** (459 preexistentes + 23 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum
uso de `random`. `git rev-parse HEAD main origin/main` confirmou que os três apontavam para
o mesmo commit (`4bc19ad`) e `git status` confirmou árvore de trabalho limpa antes de
iniciar, então a branch de trabalho já partia sincronizada com `main`.

### Decisões técnicas tomadas

1. **Nomes dos campos monetários do resultado (`realizedCostMicros`, `netProceedsMicros`,
   `resultMagnitudeMicros`) em vez de nomes genéricos como `costMicros`/`proceedsMicros`.**
   `TASK.md` pede "custo realizado do BUY, receita líquida do SELL"; os nomes escolhidos
   espelham essa redação diretamente, evitando ambiguidade com outros campos monetários já
   existentes no repositório (ex.: `grossMicros`, `totalMicros` do próprio `FillEvent`).
2. **Validação por campo com prefixo `buyFill.`/`sellFill.` no nome do campo rejeitado**,
   seguindo a convenção já usada em `compareToCashBenchmark`
   (`src/benchmark/compare-to-cash-benchmark.ts`) para comparações entre dois objetos
   estruturalmente distintos — deixa claro em qual das duas pernas a inconsistência foi
   encontrada, sem inventar uma convenção nova.
3. **`isCanonicalTimestamp` duplicada localmente**, seguindo o mesmo precedente já
   registrado nas TASK-004, TASK-007 e TASK-008: a função não é exportada de
   `src/domain/contracts.ts`, e o escopo exato desta tarefa é criar
   `src/metrics/summarize-closed-round-trip.ts`, não alterar as exportações do módulo de
   contratos.
4. **`assertValidMicros`/`assertValidAtoms` duplicadas localmente**, em vez de importadas de
   `src/metrics/summarize-execution-costs.ts`, pelo mesmo motivo: são funções privadas não
   exportadas de lá, e o mesmo precedente já foi registrado nessa própria tarefa (TASK-018)
   para `assertValidMicros`.
5. **A checagem de quantidade maior que zero (`quantityAtoms !== 0n`) foi incluída**, mesmo
   sem estar explicitamente listada em "Testes obrigatórios", porque um round trip de
   quantidade zero não é uma operação real e `assertValidAtoms` sozinha aceita zero como
   valor válido — a checagem adicional fecha essa lacuna sem duplicar nenhuma fórmula
   monetária.
6. **Nenhuma classe de erro nova.** Toda rejeição usa `rejectContract`/
   `ContractValidationError`, o mesmo mecanismo de todo o resto do repositório.

### Limitações conhecidas

- Opera sobre exatamente dois fills; não agrega múltiplos round trips, não calcula win rate
  nem ranking multiagente — explicitamente fora do escopo desta tarefa em `TASK.md`.
- Não implementa FIFO/LIFO, posição parcial ou short: um round trip é sempre "um BUY
  integral seguido de um SELL integral da mesma quantidade", nunca uma composição de vários
  fills.
- Não executa nenhuma ordem, broker, risco ou replay: opera inteiramente sobre `FillEvent`s
  já produzidos por um fluxo real ou construídos manualmente em teste.
- Não persiste nada em arquivo; opera inteiramente em memória, como as milestones
  anteriores.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as seis decisões acima têm alternativa
única e mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. `git fetch origin` exigiu aprovação não concedida neste ambiente
sandboxed, na mesma linha já registrada nas TASK-017, TASK-018 e TASK-019;
`git rev-parse HEAD main origin/main` (os três iguais) e `git status` (árvore limpa)
confirmaram que a branch de trabalho já partia sincronizada com `main`, então nenhuma
sincronização adicional era possível ou necessária.

### Commit

- **Mensagem:** `feat: resume round trip paper fechado`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

### Correção — revisão técnica ciclo 1/3 (sobre o SHA `9af9c31`)

A revisão do ChatGPT/GPT-5.6 Sol apontou que `summarizeClosedRoundTrip` usava `totalMicros`
como autoridade do P&L validando apenas seu tipo/faixa (`assertValidMicros`), sem checar que
ele de fato equivale a `grossMicros + feeMicros` (BUY) ou `grossMicros - feeMicros` (SELL) —
a relação que `src/ledger/events.ts` define para `totalMicros`. `createFillEvent` apenas
congela o rascunho e calcula `eventId`; nunca validou essa coerência monetária, então um
`FillEvent` forjado com `totalMicros` divergente de `gross`/`fee` era aceito sem erro, uma
inconsistência estrutural relevante que `TASK.md` já exigia rejeitar ("rejeite lados
invertidos, fills repetidos e qualquer inconsistência estrutural relevante").

**Correção em `src/metrics/summarize-closed-round-trip.ts`:** depois de validar
`totalMicros` de cada perna com `assertValidMicros` (como antes), a função agora também
valida `grossMicros` e `feeMicros` das duas pernas com a mesma checagem, deriva o total
esperado exclusivamente com as primitivas monetárias já existentes —
`addBounded(grossMicros, feeMicros, MAX_MICROS, ...)` na BUY,
`subtractChecked(grossMicros, feeMicros, ...)` na SELL — e rejeita com
`ContractValidationError` quando o total derivado não coincide exatamente com
`totalMicros`. Reaproveitar `subtractChecked` na SELL também cobre, de graça, o caso de
`feeMicros` maior que `grossMicros`: a própria primitiva já rejeita fail-closed antes de
qualquer comparação, sem checagem duplicada. O cálculo final de `direction` e
`resultMagnitudeMicros` continua exclusivamente sobre `totalMicros`, sem nenhuma dupla
contagem de fee — nenhuma mudança nessa parte.

Três testes novos em `tests/summarize-closed-round-trip.test.ts` (describe "fail-closed
structural rules"): BUY forjada com `totalMicros` divergente de `grossMicros + feeMicros`;
SELL forjada com `totalMicros` divergente de `grossMicros - feeMicros`; SELL forjada com
`feeMicros` maior que `grossMicros`. Cinco testes preexistentes que só sobrescreviam
`sellFill({ totalMicros: ... })` sem ajustar `grossMicros` (nos describes "gain, loss and
tie", "exact 1 micro difference" e "immutability, non-mutation and determinism") deixaram de
ser fixtures válidas sob a nova invariante — cada um foi ajustado para também sobrescrever
`grossMicros` com o mesmo valor de `totalMicros` (a fixture usa `feeMicros: 0n` por padrão,
então `gross - fee === gross`), preservando exatamente o cenário e a asserção originais.

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **485 testes, 485 passaram, 0 falharam** (482 preexistentes + 3 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum
uso de `random`. Nenhuma integração, dependência, wallet externa, corretora, testnet,
credencial ou dinheiro real foi adicionada. Pureza, imutabilidade e determinismo
preservados.

Nenhum bloqueio: `git status` confirmou árvore de trabalho limpa e idêntica ao SHA `9af9c31`
antes de iniciar; `git fetch origin` exigiu aprovação não concedida neste ambiente
sandboxed, na mesma linha já registrada nas correções anteriores, mas os refs locais de
`origin/main` e da própria branch já estavam presentes e atualizados, então nenhuma
sincronização adicional era possível ou necessária.

- **Commit:** `fix: valida coerencia de totalMicros com gross e fee`
- **Hash:** informado a André na resposta após o push.

## TASK-021 — Agregação determinística de desempenho realizado e win rate exato (M3)

- **ID da tarefa:** TASK-021
- **Milestone:** M3 — agregação de resultados realizados e win rate exato
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Menor agregação auditável de M3: `summarizeRealizedPerformance` recebe um `agentId` e uma
lista readonly de `ClosedRoundTripResult` já produzidos por `summarizeClosedRoundTrip`
(TASK-020), e devolve um `RealizedPerformanceSummary` imutável com contagens de trades
fechados/vitórias/derrotas/empates, ganhos e perdas absolutas somados separadamente com
proteção de overflow, o resultado líquido (`WIN | LOSS | BREAK_EVEN` com magnitude exata) e
o win rate representado sem ponto flutuante como a fração inteira `winRateNumerator /
winRateDenominator`. Não reconstrói fills, posições, FIFO/LIFO ou carteira; não pareia BUY
com SELL — isso já aconteceu em `summarizeClosedRoundTrip`, a única fonte de todo resultado
agregado aqui. Reutiliza integralmente `addBounded`, `subtractChecked` e `MAX_MICROS` de
`src/money/fixed-point.ts`; nenhuma fórmula monetária é duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/coordination/CHATGPT_REVIEW_TASK_020.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/metrics/summarize-closed-round-trip.ts`,
`src/money/fixed-point.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/metrics/summarize-realized-performance.ts` | criado — `summarizeRealizedPerformance`, `RealizedPerformanceSummary` |
| `tests/summarize-realized-performance.test.ts` | criado |
| `README.md` | atualizado (seção "Agregação determinística de desempenho realizado e win rate exato"; lista "O que existe hoje"; lista "Ainda não existem" corrigida — win rate e P&L realizado por trade já existiam/passam a existir) |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com
zero dependências de runtime.

### Design de `summarizeRealizedPerformance`

Recebe `(agentId: string, results: readonly ClosedRoundTripResult[])` e percorre a lista uma
única vez, validando à medida que avança, antes de qualquer soma:

1. `agentId` deve ser uma string não vazia;
2. cada resultado deve pertencer a `agentId` — um agente divergente falha fechado, na mesma
   convenção já usada por `summarizeExecutionCosts` (`event.agentId !== agentId`);
3. `buyEventId` e `sellEventId` de cada resultado são checados contra um único `Set`
   compartilhado entre as duas pernas e entre todos os resultados da lista — um id
   reutilizado em qualquer ponto, inclusive entre pernas distintas (o `buyEventId` de um
   round trip reaparecendo como `sellEventId` de outro), falha fechado antes de contar
   qualquer coisa;
4. `realizedCostMicros` e `netProceedsMicros` de cada resultado são revalidados como
   `bigint` em `[0, MAX_MICROS]`, e a mesma comparação exata usada por
   `summarizeClosedRoundTrip` é reexecutada para derivar a direção e a magnitude esperadas;
   se `result.direction` ou `result.resultMagnitudeMicros` divergirem do que essa
   revalidação produz, o resultado é forjado ou inconsistente e a agregação falha fechada
   em vez de confiar cegamente no campo já tipado.

Só então o resultado é contado: `winCount`/`totalGainMicros` para `WIN`,
`lossCount`/`totalLossMicros` para `LOSS` (ambos os totais somados com `addBounded` contra
`MAX_MICROS`, para que uma soma que estourasse o limite falhe fechado em vez de dar a volta
silenciosamente), `breakEvenCount` para `BREAK_EVEN`. Ao final, `closedTradeCount` é
`results.length`, o resultado líquido é a mesma comparação `WIN | LOSS | BREAK_EVEN` com
magnitude exata aplicada a `totalGainMicros` contra `totalLossMicros`
(`subtractChecked`), e `winRateNumerator`/`winRateDenominator` são exatamente `winCount` e
`closedTradeCount` — nunca reduzidos, nunca convertidos para `number` fracionário. Para lista
vazia, toda contagem e todo total saem zerados sem nenhuma iteração.

### Por que o resultado independe da ordem de entrada

Toda soma acumulada (`totalGainMicros`, `totalLossMicros`) opera sobre valores não negativos
limitados por `MAX_MICROS`; `addBounded` sobre valores não negativos é comutativa e
associativa, e como cada soma parcial nunca excede a soma final, nenhuma ordem de iteração
pode fazer uma soma estourar quando a soma final não estouraria — a rejeição por overflow
também independe da ordem. A detecção de id repetido depende apenas de pertencimento a um
`Set`, nunca de posição. Há teste dedicado (`tests/summarize-realized-performance.test.ts`,
describe "order invariance, immutability, non-mutation and determinism") que agrega a mesma
lista em ordem direta e invertida e confirma `deepEqual` entre os dois resumos.

### Testes cobertos em `tests/summarize-realized-performance.test.ts`

Lista vazia (toda contagem/total zerado, win rate 0/0); listas homogêneas de somente
vitórias, somente derrotas e somente empates; combinação de vitória, derrota e empate na
mesma lista; resultado líquido `WIN`, `LOSS` e `BREAK_EVEN`; diferença exata de 1 micro em
ganho e em perda; fração exata do win rate, incluindo empate contado no denominador mas não
no numerador, e o caso trivial 1/1 sem qualquer simplificação; rejeição por um resultado de
agente divergente (isolado e misturado com resultados válidos); rejeição por `buyEventId`
reutilizado entre dois resultados, por `sellEventId` reutilizado entre dois resultados, e por
um id reutilizado entre pernas distintas; rejeição por `direction` inconsistente com o
próprio custo/receita do resultado, por `resultMagnitudeMicros` inconsistente, e por dinheiro
inválido (`realizedCostMicros` negativo); proteção contra overflow tanto na soma de ganhos
quanto na soma de perdas, construindo um primeiro resultado no limite de `MAX_MICROS` e um
segundo que o excede; invariância à ordem de entrada, congelamento do resumo devolvido,
ausência de mutação de qualquer resultado recebido, e determinismo do resumo completo para o
mesmo input canônico. Toda a suíte é offline: nenhum valor monetário sai de `bigint`, nenhuma
chamada de rede, relógio ou aleatoriedade.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **511 testes, 511 passaram, 0 falharam** (485 preexistentes + 26 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum
uso de `random`. A branch de trabalho (`claude/issue-38-20260919-2003`) já partia
sincronizada com `main`: `git rev-parse HEAD main origin/main` confirmou os três apontando
para o mesmo commit (`dcc4165`) e `git status` confirmou árvore de trabalho limpa antes de
iniciar.

### Decisões técnicas tomadas

1. **`assertValidMicros` duplicada localmente**, em vez de importada de
   `summarize-closed-round-trip.ts` ou `summarize-execution-costs.ts`, seguindo o mesmo
   precedente já registrado nas TASK-004, TASK-007, TASK-008, TASK-018 e TASK-020: a função
   é privada e não exportada em nenhum dos dois módulos, e o escopo exato desta tarefa é
   criar `src/metrics/summarize-realized-performance.ts`, não alterar as exportações de
   outro módulo.
2. **Um único `Set` compartilhado para `buyEventId` e `sellEventId`**, em vez de dois `Set`s
   separados. A tarefa exige rejeitar "um ID reutilizado entre pernas distintas" — um
   `buyEventId` reaparecendo como `sellEventId` de outro resultado — o que só é detectável
   com um único espaço de nomes compartilhado; dois `Set`s separados perderiam exatamente
   esse caso.
3. **Nomes dos campos (`closedTradeCount`, `winCount`, `lossCount`, `breakEvenCount`,
   `totalGainMicros`, `totalLossMicros`, `netResultDirection`, `netResultMagnitudeMicros`,
   `winRateNumerator`, `winRateDenominator`) espelham diretamente a redação do escopo exato
   em `TASK.md`** ("conte trades fechados, vitórias, derrotas e empates"; "some
   separadamente ganhos e perdas absolutas"; "resultado líquido"; "winRateNumerator /
   winRateDenominator"), evitando qualquer nome genérico que exigisse reinterpretação.
4. **`totalLossMicros` é uma magnitude positiva, não um valor com sinal.** A mesma convenção
   já usada em `ClosedRoundTripResult.resultMagnitudeMicros` e em
   `EquitySeriesSummary`/`DrawdownRateSummary`: nenhum valor monetário deste repositório é
   representado como `bigint` negativo; a direção vem sempre de um campo discriminador
   separado (`netResultDirection`), nunca do sinal do número.
5. **`winRateNumerator`/`winRateDenominator` são `number`, não `bigint`.** São contagens de
   trades, não quantias monetárias — a mesma convenção já usada por `eventCount`/
   `fillCount`/`buyFillCount`/`sellFillCount` em `ExecutionCostSummary`
   (`src/metrics/summarize-execution-costs.ts`) e por `pointCount` em
   `EquitySeriesSummary`.
6. **Nenhuma classe de erro nova.** Toda rejeição usa `rejectContract`/
   `ContractValidationError`, o mesmo mecanismo de todo o resto do repositório.

### Limitações conhecidas

- Opera exclusivamente sobre `ClosedRoundTripResult` já produzidos; não pareia fills, não
  trata posição parcial, múltiplos lotes, FIFO/LIFO ou short — essas regras já vivem em
  `summarizeClosedRoundTrip` (TASK-020) e não são reimplementadas aqui, conforme o escopo
  exato desta tarefa.
- Não calcula retorno percentual, Sharpe ou qualquer métrica ajustada a risco — fora do
  escopo exato desta fatia.
- Não calcula ranking multiagente: agrega exatamente um agente por chamada, exatamente como
  a assinatura `agentId + ClosedRoundTripResult[] → RealizedPerformanceSummary` define;
  comparar vários agentes entre si é trabalho futuro que compõe várias chamadas desta
  função, não uma responsabilidade desta fatia.
- Não persiste nada em arquivo; opera inteiramente em memória, como as milestones
  anteriores.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as seis decisões acima têm alternativa única
e mais simples descartada por motivo explícito, com precedente direto em tarefas anteriores.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. `git fetch origin` exigiu aprovação não concedida neste ambiente sandboxed,
na mesma linha já registrada nas correções e tarefas anteriores (TASK-017 a TASK-020);
`git rev-parse HEAD main origin/main` (os três iguais) e `git status` (árvore limpa)
confirmaram que a branch de trabalho já partia sincronizada com `main`, então nenhuma
sincronização adicional era possível ou necessária.

### Commit

- **Mensagem:** `feat: agrega desempenho realizado exato`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-022 — Adaptador de agente stub determinístico (M4)

- **ID da tarefa:** TASK-022
- **Milestone:** M4 — adaptador de agente stub determinístico
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-19

### Resumo da entrega

Menor fronteira auditável para obter uma resposta bruta de agente em testes:
`AgentRequest + resposta roteirizada → resposta bruta`. `src/agent/agent-adapter.ts` define o
contrato mínimo `AgentAdapter` e `AgentRequest`/`parseAgentRequest`; `src/agent/stub-agent-adapter.ts`
define `StubAgentAdapter`, a única implementação desta tarefa — local, determinística,
sem relógio, aleatoriedade, rede, SDK, autenticação, credenciais, retry, persistência ou
concorrência. Esta tarefa não integra Astra, LLM ou qualquer serviço externo.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/coordination/CHATGPT_REVIEW_TASK_021.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/domain/contracts.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/agent/agent-adapter.ts` | criado — `AgentAdapter`, `AgentRequest`, `parseAgentRequest` |
| `src/agent/stub-agent-adapter.ts` | criado — `StubAgentAdapter`, `StubAgentAdapterConfig`, `StubAgentRoute` |
| `tests/agent-adapter.test.ts` | criado |
| `README.md` | atualizado (seção "Adaptador de agente stub determinístico") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero
dependências de runtime.

### Design de `AgentAdapter` e `AgentRequest`

`AgentRequest` carrega apenas `schemaVersion`, `agentId`, `cycleId` e `snapshotId` — a
identificação exata exigida pela tarefa. `parseAgentRequest` valida e devolve uma cópia
congelada; `agentId` segue a mesma regra de slug minúsculo de `AgentConfig.id`/
`AgentProposal.agentId`, e `cycleId`/`snapshotId` seguem a mesma regra de identificador de
`AgentProposal.cycleId`/`MarketSnapshot.snapshotId` em `src/domain/contracts.ts`. Essas
checagens são duplicadas localmente em miniatura porque os helpers de slug/identificador de
`src/domain/contracts.ts` não são exportados e a tarefa não autoriza alterar as exportações
desse módulo — o mesmo precedente já registrado nas TASK-004 e TASK-007.

`AgentAdapter.call(request: AgentRequest): unknown` devolve deliberadamente `unknown`: a
validação de `AgentProposal` fica inteiramente fora do adaptador, a cargo de
`parseAgentProposal` (`src/domain/contracts.ts`), chamado por uma camada posterior — o
adaptador nunca importa nem chama `parseAgentProposal`.

### Design de `StubAgentAdapter`

Recebe uma configuração de rotas — cada uma com `agentId`, `cycleId`, `snapshotId` e uma
`response: unknown` — e valida cada tripla de identificação com `parseAgentRequest` no
momento da construção, sem nunca inspecionar, validar, corrigir ou completar o campo
`response`: ele é copiado por referência para um `Map` interno privado (`#responsesByKey`),
exatamente como recebido, mesmo malformado.

- **Chave exata:** a chave é `JSON.stringify([agentId, cycleId, snapshotId])` dos três campos
  já validados — duas rotas com a mesma tripla são "chave duplicada na configuração" e falham
  fechado na construção, antes de qualquer chamada.
- **Consumo único, sem fallback:** um segundo `Set` privado (`#consumedKeys`) marca cada chave
  já respondida; uma segunda chamada com a mesma chave falha fechado em vez de repetir a
  resposta ou escolher parcialmente.
- **Chave ausente:** uma solicitação cuja tripla não foi configurada falha fechado, sem
  inferir ou aproximar por semelhança.
- **Solicitação inválida:** `call` chama `parseAgentRequest` de novo sobre o argumento
  recebido — mesmo que o tipo declarado já seja `AgentRequest` — porque nada garante em tempo
  de execução que um chamador não tenha construído ou repassado um objeto inconsistente; os
  testes exercitam isso construindo deliberadamente um objeto inválido do tipo declarado.
- **Imutabilidade e não mutação:** o construtor consome a lista de rotas recebida uma única
  vez, no momento da chamada, para dentro do `Map`/`Set` privados; uma mutação posterior do
  array de configuração pelo chamador não afeta o adaptador já construído (testado
  explicitamente). Nenhuma cópia defensiva do valor de `response` é feita — copiar ou congelar
  um valor arbitrário contaria como uma forma de tocá-lo além do que a tarefa autoriza
  ("o stub não deve validar, corrigir, completar ou interpretar a resposta bruta"); a
  imutabilidade exigida é a da configuração e do estado do adaptador, não a do conteúdo opaco
  da resposta.
- **Sem relógio, aleatoriedade, rede ou I/O:** nenhuma dessas primitivas aparece em nenhum dos
  dois módulos.

Toda inconsistência de ambos os módulos lança `ContractValidationError`
(`src/domain/errors.ts`), reexportado por `agent-adapter.ts`.

### Testes cobertos em `tests/agent-adapter.test.ts`

`parseAgentRequest`: aceitação e congelamento de uma solicitação válida; rejeição de valor não
objeto, `agentId` vazio, `agentId` fora do padrão slug, `cycleId` ausente, `snapshotId` em
branco e `schemaVersion` incorreto. `StubAgentAdapter`: retorno exato da resposta roteirizada
para a chave correspondente; duas chaves independentes resolvendo para respostas distintas;
rejeição de solicitação inválida, de chave ausente, de chave duplicada na configuração e de
segunda chamada da mesma chave; preservação por referência de uma resposta malformada e de
respostas primitivas/`undefined`, sem qualquer interpretação; integração demonstrativa com
`parseAgentProposal` — uma resposta roteirizada válida é aceita e uma inválida é rejeitada por
ele, nunca pelo stub; ausência de mutação da configuração recebida (incluindo o caso de o
chamador mutar seu próprio array de rotas depois da construção, sem efeito no adaptador já
construído) e da `AgentRequest` passada a `call`; determinismo entre instâncias
independentemente construídas com a mesma configuração canônica.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **531 testes, 531 passaram, 0 falharam** (511 preexistentes + 20 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum uso
de `random`, nenhum SDK ou credencial.

### Decisões técnicas tomadas

1. **`AgentAdapter.call` recebe `AgentRequest` (tipo já validado/imutável), não `unknown`.** A
   tarefa pede um contrato "para receber uma solicitação imutável identificada por `agentId`,
   `cycleId` e `snapshotId`" — a leitura mais literal é que a interface declara o tipo
   imutável já identificado, e não um valor bruto de fronteira. `StubAgentAdapter.call`
   permanece, ainda assim, fail-closed em tempo de execução: ele revalida com
   `parseAgentRequest` internamente, então um chamador que efetivamente repasse um valor
   inconsistente (testado via cast deliberado, no mesmo padrão já usado em
   `tests/settle-paper-execution.test.ts` para forjar um evento de outro agente) continua
   sendo rejeitado.
2. **Chave composta via `JSON.stringify([agentId, cycleId, snapshotId])`**, em vez de
   concatenação com separador. Os três campos já são restritos a um alfabeto sem aspas nem
   colchetes por `parseAgentRequest`, então um separador simples já seria seguro, mas a
   serialização estrutural remove qualquer dependência implícita desse alfabeto e deixa a
   regra de igualdade de chave auditável por inspeção.
3. **Nenhuma cópia ou congelamento do valor de `response`.** Ver "Design de
   `StubAgentAdapter`" acima — a tarefa proíbe explicitamente qualquer forma de interpretação
   da resposta bruta, e `Object.freeze` sobre um valor arbitrário do chamador seria mutar
   (ainda que superficialmente) algo que a tarefa pede para apenas encaminhar.
4. **Validação de `agentId`/`cycleId`/`snapshotId` duplicada localmente em
   `src/agent/agent-adapter.ts`**, em vez de importada de `src/domain/contracts.ts`. Mesmo
   motivo e mesmo precedente das TASK-004/TASK-007: os helpers relevantes não são exportados
   de lá e o escopo exato desta tarefa não autoriza alterar as exportações desse módulo.
5. **Nenhuma nova classe de erro.** Toda rejeição usa `ContractValidationError`/
   `rejectContract` já existentes em `src/domain/errors.ts`, exatamente como a tarefa exige
   ("toda inconsistência do adaptador gera `ContractValidationError`").

### Limitações conhecidas

- `StubAgentAdapter` é local e determinístico por construção; não há adaptador real de Astra
  ou de qualquer modelo — isso é integração futura, fora do escopo exato desta tarefa.
- Não há retry, backoff nem seleção de modelo: a tarefa proíbe explicitamente essas
  funcionalidades nesta fatia.
- Não há verificação de consistência entre os campos da `response` roteirizada e o
  `AgentRequest` que a solicitou (por exemplo, que `response.cycleId` combine com
  `request.cycleId`); isso pertenceria a `parseAgentProposal`/a uma camada posterior, nunca ao
  adaptador.

### Decisões pendentes para André / revisor

1. **`AgentAdapter.call` tipado com `AgentRequest`** — decisão técnica nº 1 acima; se o
   arquiteto pretendia a interface aceitando `unknown` diretamente (com `parseAgentRequest`
   chamado só internamente pelo adaptador, nunca pelo chamador), é uma mudança de assinatura
   contida em `src/agent/agent-adapter.ts` e `src/agent/stub-agent-adapter.ts`, sem mudança de
   comportamento observável em `StubAgentAdapter`.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio. A única decisão de interpretação (nº 1 acima) foi resolvida com a leitura
mais literal do texto da tarefa e não afeta o comportamento fail-closed observável do stub.

### Commit

- **Mensagem:** `feat: adiciona adaptador de agente stub`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-023 — Registro imutável de resposta bruta de agente (M4)

- **ID da tarefa:** TASK-023
- **Milestone:** M4 — registro imutável de resposta bruta
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-20

### Resumo da entrega

Menor registro em memória, determinístico e auditável do pipeline: `captureAgentResponse`
constrói e congela um `AgentResponseCapture` associando um `AgentRequest` já revalidado à sua
resposta bruta e às versões explícitas de prompt e modelo que a produziram.

```text
AgentRequest + rawResponse + promptVersion + model → AgentResponseCapture
```

Não persiste dados, não chama modelo, não integra Astra e não chama `parseAgentProposal`.
Reutiliza `parseAgentRequest` de `src/agent/agent-adapter.ts` para validar e congelar a cópia
de `AgentRequest`; nenhuma regra de validação de `AgentRequest` foi duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/coordination/CHATGPT_REVIEW_TASK_022.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/agent/agent-adapter.ts`, `src/domain/contracts.ts`
e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/agent/capture-agent-response.ts` | criado — `captureAgentResponse`, `AgentResponseCapture` |
| `tests/capture-agent-response.test.ts` | criado |
| `README.md` | atualizado (seção "Registro imutável de resposta bruta de agente") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero
dependências de runtime.

### Design de `captureAgentResponse`

Recebe um único `value: unknown` com os campos `request`, `responseId`, `rawResponse`,
`promptVersion` e `model`, e devolve um `AgentResponseCapture` congelado contendo somente:

1. `request` — `parseAgentRequest(source.request)`, que valida e congela uma cópia
   independente, aceitando tanto um `AgentRequest` já parseado quanto um objeto bruto
   equivalente;
2. `responseId` — string não vazia/não em branco, até `MAX_RESPONSE_ID_LENGTH` (64) caracteres,
   livre de caracteres de controle; fornecida pelo chamador, nunca gerada aqui;
3. `rawResponse` — string não vazia, até `MAX_RAW_RESPONSE_LENGTH` (65.536) caracteres,
   devolvida exatamente como recebida: sem `trim`, sem checagem de caracteres de controle e sem
   qualquer parse, normalização, correção ou interpretação de conteúdo. Texto que não é JSON
   válido é preservado do mesmo jeito, porque esta camada trata o conteúdo como opaco;
4. `promptVersion` e `model` — mesma validação de `responseId` (não vazios/em branco, limitados,
   livres de caracteres de controle), com limites próprios: `MAX_PROMPT_VERSION_LENGTH` (64) e
   `MAX_MODEL_LENGTH` (128), espelhando os limites já usados para os mesmos campos em
   `AgentProposal` (`src/domain/contracts.ts`).

`requireObject` e o validador de texto limitado são duplicados localmente em miniatura, no
mesmo padrão documentado em `src/agent/agent-adapter.ts`: os helpers equivalentes em
`src/domain/contracts.ts` são privados ao módulo, e a tarefa não autoriza alterar suas
exportações.

### Testes cobertos em `tests/capture-agent-response.test.ts`

Captura válida com cópia de `AgentRequest` congelada e distinta por referência da instância
recebida; aceitação de um `request` bruto/não parseado, revalidado; preservação byte a byte de
texto malformado, de texto com quebras de linha/tabulação/unicode e de um `rawResponse` composto
só de espaços; `responseId`/`promptVersion`/`model` ausentes, vazios, em branco, não string,
acima do limite e contendo caractere de controle, com o caso de fronteira exatamente no limite
aceito; `rawResponse` ausente, vazio, não string e acima do limite, com o caso de fronteira
exatamente no limite aceito; `request` ausente, com `agentId` vazio e com `schemaVersion`
incorreto; valor de entrada não-objeto (string, `null`, `undefined`, array); congelamento do
resultado e do `request` aninhado, com tentativa de mutação lançando `TypeError`; ausência de
mutação do objeto de entrada e da instância de `AgentRequest` recebida; determinismo campo a
campo para o mesmo input canônico; ausência de leitura de relógio (resultado idêntico
independentemente do instante da chamada) e confirmação de que `responseId` nunca é fabricado —
é exatamente o valor fornecido pelo chamador.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **564 testes, 564 passaram, 0 falharam** (531 preexistentes + 33 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum uso
de `random`, nenhuma escrita em disco além dos artefatos de build padrão.

### Decisões técnicas tomadas

1. **`responseId`/`promptVersion`/`model` não impõem um formato de slug/identificador**, apenas
   "não vazio/em branco, limitado, livre de caracteres de controle" — exatamente o que a tarefa
   pede. Um padrão adicional (como o usado para `orderId`/`proposalId`) restringiria formatos de
   versão de prompt ou de identificador de modelo legítimos (ex.: `gpt-4.1@2026-01`) sem que a
   tarefa tenha pedido essa restrição.
2. **`rawResponse` não é validado contra caracteres de controle nem sofre `trim`.** A tarefa
   exige essa checagem explicitamente para `responseId`/`promptVersion`/`model`, mas não para
   `rawResponse`, e afirma que seu conteúdo é opaco. Texto real de um agente pode conter quebras
   de linha e tabulações (caracteres de controle) legitimamente; rejeitá-las seria interpretar
   conteúdo, o que a tarefa proíbe.
3. **`MAX_RAW_RESPONSE_LENGTH = 65.536` é um limite de sanidade documentado, não um valor
   calibrado.** A tarefa exige "limite explícito" sem especificar o número; escolhi um valor
   generoso o bastante para uma resposta longa de agente, exportado como constante nomeada para
   que o arquiteto possa ajustá-lo sem tocar na lógica de validação.
4. **Nenhuma interface de "input" nomeada foi exportada** para os parâmetros de
   `captureAgentResponse`; a função aceita `value: unknown`, no mesmo padrão de toda função
   `parseX` do repositório (`parseAgentRequest`, `parseMarketSnapshot`, `parseAgentProposal`).
5. **`AgentResponseCapture` não inclui `schemaVersion`.** A tarefa lista explicitamente os cinco
   campos que o registro deve conter "somente" (`request`, `responseId`, `rawResponse`,
   `promptVersion`, `model`); adicionar um campo não listado ampliaria o escopo exato definido.

### Limitações conhecidas

- Não há persistência: o `AgentResponseCapture` vive apenas em memória, como toda fundação
  anterior a uma tarefa de persistência dedicada.
- Não há geração de `responseId`: um chamador real precisa decidir sua própria estratégia de
  identificador estável (fora do escopo desta tarefa).
- `rawResponse` não é comprimido nem truncado silenciosamente: uma resposta acima do limite é
  rejeitada por inteiro, não cortada.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as cinco decisões acima têm alternativa única e
mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: registra resposta bruta de agente`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-024 — Política de retry controlado (M4)

- **ID da tarefa:** TASK-024
- **Milestone:** M4 — política de retry controlado
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-20

### Resumo da entrega

Menor contrato puro, determinístico e fail-closed do pipeline de agentes: uma política
imutável de no máximo três tentativas e uma decisão pura sobre se resta mais uma.

```text
RetryPolicy + tentativa explícita → decisão determinística
```

`src/agent/retry-policy.ts` define `AgentRetryPolicy` (somente `maxAttempts`),
`parseAgentRetryPolicy(value)` e `shouldRetryAgentAttempt(policy, completedAttempts)`. Nenhuma
das duas funções cria uma tentativa, chama `AgentAdapter`, executa retry, lê o relógio,
aguarda, calcula backoff, usa aleatoriedade ou faz I/O — a decisão de que uma tentativa é
permitida permanece inteiramente separada de jamais fazer uma, a mesma separação que
`src/agent/agent-adapter.ts` e `src/agent/capture-agent-response.ts` já traçam entre chamar um
agente e validar o que ele devolveu.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/coordination/CHATGPT_REVIEW_TASK_023.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/agent/agent-adapter.ts`,
`src/agent/capture-agent-response.ts`, `src/domain/contracts.ts` e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/agent/retry-policy.ts` | criado — `AgentRetryPolicy`, `parseAgentRetryPolicy`, `shouldRetryAgentAttempt` |
| `tests/retry-policy.test.ts` | criado |
| `README.md` | atualizado (seção "Política de retry controlado") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero
dependências de runtime.

### Design de `retry-policy.ts`

`AgentRetryPolicy` carrega exatamente o campo pedido pela tarefa — "somente `maxAttempts`" —
sem `schemaVersion` nem qualquer outro campo. `parseAgentRetryPolicy` exige um objeto JSON com
`maxAttempts` inteiro seguro (`Number.isSafeInteger`) entre `MIN_AGENT_RETRY_ATTEMPTS` (1) e
`MAX_AGENT_RETRY_ATTEMPTS` (3), inclusive; qualquer outro valor — zero, acima de 3, negativo,
fração, `NaN`, infinito, string ou objeto — falha fechado com `ContractValidationError`. O
resultado é uma cópia congelada contendo somente `maxAttempts`; campos desconhecidos no valor
de entrada são descartados, não confiados, no mesmo padrão de todo parser do repositório.

`shouldRetryAgentAttempt(policy, completedAttempts)` trata `policy` como já validada — a mesma
convenção que `evaluateRisk` já segue para `RiskRequest.policy` em
`src/risk/risk-manager.ts` — e revalida apenas `completedAttempts`, por ser um valor explícito
por chamada que um chamador pode fornecer diretamente, sem necessariamente ter passado por um
parser antes. `completedAttempts` deve ser um inteiro seguro não negativo; qualquer outro valor
falha fechado com `ContractValidationError`. A decisão é `completedAttempts < policy.maxAttempts`
— `true` somente quando resta pelo menos uma tentativa dentro do limite explícito.

### Testes cobertos em `tests/retry-policy.test.ts`

`parseAgentRetryPolicy`: aceitação e congelamento nos limites 1 e 3 e no valor intermediário 2;
rejeição de valor não-objeto (string, `null`, `undefined`, array); rejeição de zero, valor acima
de 3, negativo, fração, `NaN`, infinito, string, objeto e campo ausente; descarte de campos
desconhecidos, mantendo somente `maxAttempts`; ausência de mutação do objeto de entrada;
determinismo para o mesmo input canônico.

`shouldRetryAgentAttempt`: decisão exata em cada fronteira, para as três políticas válidas
(`maxAttempts` 1, 2 e 3) — permite toda tentativa abaixo do limite e nega exatamente na
igualdade e acima dela; permite a primeira tentativa quando nenhuma foi completada; rejeição de
`completedAttempts` negativo, fracionário, `NaN`, infinito, string e objeto; ausência de mutação
da política recebida; determinismo para o mesmo input canônico.

Suíte offline dedicada: um teste substitui `Date.now`, `Math.random`, `setTimeout` e `fetch` por
funções que lançam erro se chamadas, e prova que `parseAgentRetryPolicy`/`shouldRetryAgentAttempt`
continuam funcionando normalmente sob essa restrição — evidência direta de ausência de relógio,
timer, aleatoriedade, rede e I/O, não apenas ausência de asserção sobre eles.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **591 testes, 591 passaram, 0 falharam** (564 preexistentes + 27 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum uso
de `random`, nenhuma escrita em disco além dos artefatos de build padrão.

### Decisões técnicas tomadas

1. **`AgentRetryPolicy` não inclui `schemaVersion`.** A tarefa pede um contrato "com somente
   `maxAttempts`"; adicionar qualquer outro campo, mesmo um já convencional no repositório,
   ampliaria o escopo exato definido.
2. **`shouldRetryAgentAttempt` revalida `policy` via `parseAgentRetryPolicy` antes de comparar.**
   Decisão original desta entrega deixava de revalidar `policy.maxAttempts`, seguindo por
   analogia a convenção de `evaluateRisk` (`src/risk/risk-manager.ts`). O revisor (André, em
   `#45`) apontou que essa convenção não se aplica aqui: o tipo `AgentRetryPolicy` não impede um
   chamador de passar em runtime um objeto forjado (`{ maxAttempts: 100 } as AgentRetryPolicy`,
   `Infinity` etc.), o que permitiria mais de três tentativas e contrariaria diretamente a regra
   obrigatória "entradas inválidas devem gerar `ContractValidationError`". Corrigido em
   2026-09-20: ver "Correção pós-revisão" abaixo.
3. **`completedAttempts` é revalidado a cada chamada de `shouldRetryAgentAttempt`**, mesmo
   sendo tipado como `number`, porque é um contador por chamada que um orquestrador futuro
   pode calcular e passar diretamente, sem que exista (nem seja pedido) um parser dedicado
   para ele — a única forma de cumprir "entradas inválidas devem falhar com
   `ContractValidationError`" para esse valor é validá-lo no próprio ponto de uso.
4. **Nenhuma classe de erro nova.** Toda rejeição usa `ContractValidationError`/
   `rejectContract`, reexportado do mesmo `src/domain/errors.ts` já usado por
   `src/agent/agent-adapter.ts` e `src/agent/capture-agent-response.ts`.
5. **`requireObject` duplicado localmente em miniatura**, no mesmo padrão já documentado em
   `src/agent/agent-adapter.ts` e `src/agent/capture-agent-response.ts`: o helper equivalente em
   `src/domain/contracts.ts` é privado ao módulo, e a tarefa não autoriza alterar suas
   exportações.

### Limitações conhecidas

- Não existe execução de retry: nenhuma função deste módulo chama `AgentAdapter`, cria uma
  nova tentativa ou decide o que fazer com uma resposta — apenas se mais uma tentativa é
  permitida pela política, exatamente como o escopo exato exige.
- Não há relação com tempo: nenhum atraso, backoff ou janela de tempo entre tentativas é
  modelado; a política conta tentativas, não tempo decorrido.
- (Corrigido em 2026-09-20 — ver abaixo.) `shouldRetryAgentAttempt` não validava `policy`; um
  chamador que construísse manualmente um `AgentRetryPolicy` fora de `parseAgentRetryPolicy`
  obtinha uma decisão calculada sobre esse valor não validado.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as cinco decisões acima têm alternativa única e
mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: define política de retry controlado`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-024 — Correção pós-revisão: fail-closed em `shouldRetryAgentAttempt`

- **Contexto:** revisão de `andreholmo` na PR `#45` (2026-09-20T02:14:38Z), solicitação de
  André em `#45` via `@claude`.
- **Data:** 2026-09-20

### Falha reportada

`shouldRetryAgentAttempt` validava apenas `completedAttempts` e confiava que `policy` já havia
sido parseada por `parseAgentRetryPolicy`. Em runtime, nada impede um chamador de passar
`{ maxAttempts: 100 } as AgentRetryPolicy` (ou `Infinity`) diretamente à função — o tipo
estático não é verificado em tempo de execução — e a função retornava `true` além do limite de
três tentativas, contrariando a regra obrigatória de fail-closed.

### Correção aplicada

`shouldRetryAgentAttempt` agora chama `parseAgentRetryPolicy(policy)` internamente antes de
comparar `completedAttempts` contra `maxAttempts`, revalidando a política a cada chamada, não
apenas confiando no tipo estático do parâmetro. Uma política forjada ou inválida passada
diretamente a essa função agora falha com `ContractValidationError`, no mesmo padrão já
aplicado a `completedAttempts`. Nenhuma outra função, arquivo ou escopo foi alterado.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/agent/retry-policy.ts` | `shouldRetryAgentAttempt` revalida `policy` via `parseAgentRetryPolicy` |
| `tests/retry-policy.test.ts` | 6 novos testes de política forjada/inválida |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

### Testes adicionados

Política forjada com `maxAttempts` acima do limite (100), permitindo verificar que não passa a
liberar tentativas extras; `maxAttempts` zero; `maxAttempts` fracionário (1.5); `maxAttempts`
não numérico (string); `maxAttempts` infinito; e `policy` não-objeto (`null`, string) passada
diretamente — todos rejeitados com `ContractValidationError`.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (inclui `npm run build`) | **597 testes, 597 passaram, 0 falharam** (591 anteriores + 6 novos) |

### Decisões técnicas tomadas

1. **Revalidação via `parseAgentRetryPolicy`, não uma checagem ad-hoc.** Reutiliza o mesmo
   parser já testado e fail-closed, em vez de duplicar a lógica de limites em
   `shouldRetryAgentAttempt`, evitando duas fontes de verdade para o que é uma política válida.
2. **Decisão nº 2 do relato original de TASK-024 revertida.** A analogia com `evaluateRisk`
   (`src/risk/risk-manager.ts`) não se sustentava aqui: lá a política chega por um único ponto
   de entrada controlado; `shouldRetryAgentAttempt` é uma função pública exportada que qualquer
   chamador pode invocar diretamente com um valor construído à mão.
3. **Escopo mantido em `src/agent/retry-policy.ts` e seus testes.** Nenhuma alteração em
   `AgentAdapter`, Risk Manager, broker, ledger ou qualquer arquivo fora do listado no escopo
   exato de TASK-024.

### Decisões pendentes para André / revisor

Nenhuma.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `fix: revalida política em shouldRetryAgentAttempt`
- **Hash:** informado a André na resposta após o push.

A aprovação desta correção cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

## TASK-025 — Consolidação determinística do relatório multiagente offline (M3/M6)

- **ID da tarefa:** TASK-025
- **Milestone:** M3/M6 — relatório multiagente offline
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-20

### Resumo da entrega

Menor composição pura, determinística e fail-closed que reúne, para N agentes, os resultados
paper já calculados pelas primitivas existentes num relatório multiagente comparável e legível
por máquina, sem chamar agente, modelo, mercado, broker, rede, wallet, blockchain, testnet,
corretora ou dinheiro real.

```text
(EquitySeriesSummary + RealizedPerformanceSummary + ExecutionCostSummary + StrategyBenchmarkReport)
por agente → MultiAgentPerformanceReport
```

`src/metrics/build-multi-agent-performance-report.ts` define `buildMultiAgentPerformanceReport`,
que reutiliza integralmente os quatro resumos já produzidos por
`summarizeEquitySeries`/`summarizeRealizedPerformance`/`summarizeExecutionCosts`/
`buildStrategyBenchmarkReport` — nenhuma fórmula de P&L, drawdown, custo, win rate ou benchmark é
reimplementada ou recalculada aqui.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/coordination/CHATGPT_REVIEW_TASK_024.md`,
`docs/coordination/CLAUDE_REPORT.md`, `config/agents.json`, `src/config/load-agents.ts`,
`src/metrics/summarize-equity-series.ts`, `src/metrics/summarize-realized-performance.ts`,
`src/metrics/summarize-execution-costs.ts`, `src/benchmark/build-strategy-benchmark-report.ts` e
`TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/metrics/build-multi-agent-performance-report.ts` | criado — `buildMultiAgentPerformanceReport`, `MultiAgentPerformanceEntry`, `MultiAgentPerformanceRow`, `MultiAgentPerformanceReport` |
| `tests/build-multi-agent-performance-report.test.ts` | criado |
| `README.md` | atualizado (seção "Relatório multiagente offline") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero
dependências de runtime.

### Design de `buildMultiAgentPerformanceReport`

A quantidade de agentes é configuração, nunca código (D-006): a função aceita qualquer lista não
vazia de `MultiAgentPerformanceEntry` — nada no módulo conhece ou assume seis agentes. Como os
quatro resumos de cada entrada, e as comparações aninhadas dentro de `StrategyBenchmarkReport`
(`vsCash`, `vsBuyAndHold`), são apenas tipos estruturais em tempo de compilação, nada impede um
chamador de construir um com um campo forjado — a mesma situação já documentada em todo módulo de
`src/metrics/` e `src/benchmark/`. A função revalida fail-closed, antes de devolver qualquer
relatório:

- lista de entradas não vazia;
- `agentId` não vazio e idêntico nos quatro resumos de cada entrada (`equity`, `realized`,
  `costs`, `benchmark`), incluindo os campos `agentId` das comparações `vsCash`/`vsBuyAndHold`
  aninhadas dentro de `benchmark`;
- a mesma janela de experimento (`startedAt`, `endedAt`, `pointCount`) entre os quatro resumos de
  uma entrada, entre as comparações aninhadas e o resumo de patrimônio, e entre todos os agentes
  da lista inteira;
- `agentId` sem duplicata entre entradas;
- a fração de win rate coerente — `winRateDenominator` deve ser igual a
  `realized.closedTradeCount`, e `winRateNumerator` não pode exceder `winRateDenominator`;
- todo valor monetário consumido (patrimônio inicial/final, magnitude de P&L, drawdown máximo,
  fees, impacto de execução e os valores monetários das duas comparações) como `bigint` dentro de
  `[0, MAX_MICROS]`.

Cada linha devolvida contém somente o que a tarefa pede: identificação do agente e janela do
experimento, patrimônio inicial e final, direção e magnitude exatas do P&L, drawdown máximo,
contagem de trades fechados, fração exata de win rate, fees e impacto de execução, e a comparação
da estratégia contra o benchmark cash e contra o benchmark buy-and-hold (`vsCash`/`vsBuyAndHold`,
carregados verbatim de `StrategyBenchmarkReport`). O terceiro membro do relatório triangular,
`buyAndHoldVsCash` — uma comparação entre os dois benchmarks, não uma comparação da estratégia —
foi deliberadamente deixado fora da linha, porque a tarefa lista o conteúdo da linha como
"contendo somente" os itens acima.

A ordem de `entries` é sempre preservada em `rows`; a função nunca ordena, pontua ou recomenda um
agente. O relatório devolvido, a coleção `rows` e cada linha são congelados; nenhuma entrada nem
seus resumos aninhados são mutados.

### Testes cobertos em `tests/build-multi-agent-performance-report.test.ts`

Composição correta para uma lista configurável de três agentes, com verificação campo a campo de
que cada linha carrega verbatim os valores dos quatro resumos da entrada correspondente;
preservação de ordem sem ranking, mesmo quando um agente posterior claramente supera um agente
anterior, e ausência de qualquer campo de rank/vencedor no relatório ou nas linhas; rejeição de
lista vazia, `agentId` duplicado, `agentId` desalinhado em `realized`/`costs`/`benchmark`, janela
divergente entre o resumo de patrimônio e o `benchmark` da própria entrada (`endedAt` e
`pointCount`), janelas incompatíveis entre dois agentes distintos, fração de win rate incoerente
(`winRateDenominator` divergente de `closedTradeCount`, `winRateNumerator` acima do denominador),
valor monetário não-`bigint` e valor monetário negativo; imutabilidade do relatório, da coleção de
linhas e de cada linha; ausência de mutação de qualquer entrada recebida; determinismo para o
mesmo input canônico; ausência de relógio, timer, aleatoriedade, rede e I/O, com um teste que
substitui `Date.now`, `Math.random`, `setTimeout` e `fetch` por funções que lançam erro se
chamadas.

### Teste demonstrativo com os seis agentes de `config/agents.json`

Um teste dedicado carrega `config/agents.json` via `loadAgentsConfig`/`enabledAgents`, confirma os
seis `agentId` e os US$100 fictícios de orçamento inicial de cada perfil, e constrói, para cada
agente, um `EquitySeriesSummary`/`RealizedPerformanceSummary`/`ExecutionCostSummary` literais e um
`StrategyBenchmarkReport` real (via `buildCashBenchmark`/`buildBuyAndHoldBenchmark`/
`buildStrategyBenchmarkReport`, reaproveitados sem alteração) com números inteiramente fictícios e
distintos entre agentes: patrimônio final, direção e magnitude de P&L, drawdown máximo, contagem
de trades, win rate, fees, impacto de execução e o resultado de cada comparação variam por agente.
O teste serializa o relatório resultante como uma tabela determinística — cada `Micros` convertido
para uma string decimal de seis casas antes de `JSON.stringify`, o que evita o `TypeError` que
`JSON.stringify` lançaria sobre um `bigint` — e imprime essa tabela com `console.log`, tornando os
primeiros números fictícios do projeto visíveis no log da CI. Um conjunto de asserções fixa os
valores exatos de linhas selecionadas (incluindo um agente `TIED` contra cash, um `LOSS` contra
ambos os benchmarks, e um `OUTPERFORMED` contra os dois), para que qualquer regressão futura nesses
números fictícios quebre o teste, não apenas o log.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **616 testes, 616 passaram, 0 falharam** (597 preexistentes + 19 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum uso de
`random`. O teste demonstrativo lê `config/agents.json` do disco local via `loadAgentsConfig`
(I/O de arquivo local já usado por `tests/load-agents.test.ts`), nunca rede.

### Decisões técnicas tomadas

1. **`buyAndHoldVsCash` não entra na linha do relatório.** `TASK.md` define o conteúdo da linha
   como "contendo somente" uma lista fechada de itens, e "comparação da estratégia contra cash e
   buy-and-hold" descreve duas comparações da estratégia (`vsCash`, `vsBuyAndHold`), não a
   comparação entre os dois benchmarks entre si. Incluir `buyAndHoldVsCash` teria ampliado o
   conteúdo da linha além do que a tarefa fecha explicitamente.
2. **`pointCount` tratado como parte da "janela do experimento".** A tarefa pede "identificação do
   agente e janela do experimento" na linha e, separadamente, "mesma janela `startedAt`/`endedAt`
   e mesmo `pointCount` para todos os agentes" nas regras — tratei os três campos como uma unidade
   só, pelo mesmo motivo que `StrategyBenchmarkReport` e todo comparador em `src/benchmark/` já
   tratam `pointCount` como parte da identificação do experimento, ao lado de `startedAt`/`endedAt`.
3. **Revalidação fail-closed de `vsCash`/`vsBuyAndHold` (campos aninhados dentro de `benchmark`),
   não apenas dos quatro resumos de topo.** A regra obrigatória "revalidar fail-closed os campos
   consumidos, inclusive... valores monetários" se aplica a todo valor que a linha carrega,
   incluindo os valores monetários e a identificação de experimento dentro das duas comparações —
   deixá-los sem revalidação teria sido uma lacuna, já que `StrategyBenchmarkReport` é só um tipo
   estrutural, exatamente como os testes forjados de `build-strategy-benchmark-report.test.ts` já
   demonstram para o módulo anterior.
4. **`EquitySeriesSummary`/`RealizedPerformanceSummary`/`ExecutionCostSummary` do teste
   demonstrativo são objetos literais, não derivados de um replay real de fills.** O escopo exato
   desta tarefa é a composição do relatório, não a geração de um replay completo — que
   `TASK.md` explicitamente lista como fora de escopo ("não criar ciclo de replay completo"). O
   mesmo padrão de resumo literal já é usado por `strategySummary()` em
   `tests/build-strategy-benchmark-report.test.ts`. O `StrategyBenchmarkReport` de cada agente, em
   contraste, é construído com as funções reais (`buildCashBenchmark`, `buildBuyAndHoldBenchmark`,
   `buildStrategyBenchmarkReport`), para que as comparações exibidas na tabela demonstrativa sejam
   genuinamente calculadas, não inventadas à mão.
5. **Nenhuma classe de erro nova.** Toda rejeição usa `rejectContract`/`ContractValidationError`,
   reexportado do mesmo `src/domain/errors.ts` já usado por todo módulo de `src/metrics/` e
   `src/benchmark/`.
6. **`isCanonicalTimestamp` duplicado localmente**, no mesmo padrão já registrado em
   `src/metrics/value-wallet-at.ts`, `src/metrics/summarize-equity-series.ts` e
   `src/metrics/summarize-closed-round-trip.ts` — o escopo exato desta tarefa é criar um único
   arquivo novo em `src/metrics/`, não alterar as exportações de `src/domain/contracts.ts`.

### Limitações conhecidas

- Não existe ciclo de replay, estratégia, decisão BUY/SELL/HOLD, chamada de agente, ranking ou
  seleção automática de agente — exatamente como a tarefa exclui.
- O relatório não persiste nada em arquivo, CSV, JSONL ou banco; vive apenas em memória, como toda
  primitiva de M3 anterior.
- A tabela impressa pelo teste demonstrativo é uma serialização de conveniência para tornar os
  números visíveis no log da CI, não um formato de exportação suportado pelo módulo — o módulo
  devolve apenas a estrutura tipada `MultiAgentPerformanceReport`.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as seis decisões acima têm alternativa única e
mais simples descartada por motivo explícito, especialmente a decisão nº 1 (exclusão de
`buyAndHoldVsCash` da linha), que fica registrada para confirmação explícita do arquiteto.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: consolida relatório multiagente offline`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.

### Correção — revisão do PR #47 (inconsistências internas fail-closed)

A revisão de André no PR #47 apontou que a composição ainda aceitava inconsistências internas
nos campos que publica, contrariando a exigência fail-closed da tarefa. Cinco classes de forja
eram aceitas silenciosamente:

1. `equity` com `pnlDirection`/`pnlMagnitudeMicros` que não correspondiam ao sinal/diferença
   exata entre `startingEquityMicros` e `endingEquityMicros`;
2. `realized.winCount` divergente de `winRateNumerator`, ou
   `winCount + lossCount + breakEvenCount` divergente de `closedTradeCount` — `winCount`,
   `lossCount` e `breakEvenCount` nem sequer eram lidos antes;
3. `benchmark.vsCash.strategyEndingEquityMicros` e
   `benchmark.vsBuyAndHold.strategyEndingEquityMicros` aceitos sem comparação com
   `equity.endingEquityMicros` — cada comparação podia descrever um patrimônio final diferente
   do que a própria linha publica;
4. `result` e `differenceMagnitudeMicros` de `vsCash`/`vsBuyAndHold` aceitos sem recomputar o
   sinal/diferença esperados a partir dos dois patrimônios efetivamente comparados;
5. `assertNonNegativeInteger` usava `Number.isInteger`, que aceita valores acima de
   `Number.MAX_SAFE_INTEGER` (ainda inteiros em ponto flutuante, mas não mais exatos).

**Correção em `src/metrics/build-multi-agent-performance-report.ts`:** cada uma das cinco
classes agora é revalidada fail-closed em `buildRow`, sempre calculando apenas o valor esperado
para comparação — nunca substituindo o valor que a linha publica — e rejeitando com
`ContractValidationError` na primeira divergência, reutilizando `subtractChecked` de
`src/money/fixed-point.ts` para toda diferença exata, a mesma função já usada por
`summarizeEquitySeries`, `compareToCashBenchmark` e `compareStrategyToBuyAndHold` para as
mesmas contas. `assertNonNegativeInteger` passa a usar `Number.isSafeInteger`. Nenhuma fórmula
de P&L, win rate ou benchmark é recalculada para o valor final devolvido — apenas para a
checagem de coerência, exatamente como o revisor pediu.

Doze testes forjados novos em `tests/build-multi-agent-performance-report.test.ts`, um ou dois
por classe: `pnlDirection` forjada com magnitude correta e vice-versa (patrimônio 100 → 90,
`LOSS 10` esperado); `winCount` divergente de `winRateNumerator`; `lossCount` forjado quebrando
a soma contra `closedTradeCount`; `closedTradeCount` e `winCount` acima de
`Number.MAX_SAFE_INTEGER`; `vsCash.strategyEndingEquityMicros` e
`vsBuyAndHold.strategyEndingEquityMicros` divergentes de `equity.endingEquityMicros`;
`vsCash.result`/`vsCash.differenceMagnitudeMicros` e
`vsBuyAndHold.result`/`vsBuyAndHold.differenceMagnitudeMicros` forjados incompatíveis com os
dois patrimônios de cada comparação.

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **628 testes, 628 passaram, 0 falharam** (616 preexistentes + 12 novos) |

Suíte offline e determinística, sem alteração de escopo: nenhum ranking, rede ou execução
financeira foi adicionado; nenhuma dependência nova.

- **Commit:** `fix: revalida coerencia interna fail-closed no relatorio multiagente`
- **Hash:** informado a André na resposta após o push.

CI do SHA anterior estava em `action_required`; a aprovação cabe ao ChatGPT/GPT-5.6 Sol depois
desta correção.

## TASK-026 — Executa tentativa única de agente stub offline (M4)

- **ID da tarefa:** TASK-026
- **Milestone:** M4 — tentativa única de agente stub
- **Issue:** #48
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-20

### Resumo da entrega

Menor composição determinística e fail-closed do pipeline de agente:
`AgentRequest → StubAgentAdapter → captura auditável → AgentProposal validada`, inteiramente em
memória e offline. `runSingleAgentAttempt` chama o `AgentAdapter` recebido exatamente uma vez,
preserva a resposta bruta byte a byte com `captureAgentResponse` e valida a proposta tipada com
`parseAgentProposal`, exigindo alinhamento exato de identidade (`agentId`, `cycleId`) e
proveniência (`promptVersion`, `model`). Reutiliza integralmente `parseAgentRequest`
(`src/agent/agent-adapter.ts`), `captureAgentResponse` (`src/agent/capture-agent-response.ts`) e
`parseAgentProposal` (`src/domain/contracts.ts`); nenhuma fórmula de validação foi duplicada além
da revalidação mínima de metadados já convencionada no repositório.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/DECISIONS.md`,
`docs/ARCHITECTURE.md`, `TASK.md`, `docs/coordination/CHATGPT_REVIEW_TASK_025.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/agent/agent-adapter.ts`,
`src/agent/stub-agent-adapter.ts`, `src/agent/capture-agent-response.ts`,
`src/agent/retry-policy.ts` e `src/domain/contracts.ts`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/agent/run-single-agent-attempt.ts` | criado — `runSingleAgentAttempt`, `RunSingleAgentAttemptRequest`, `SingleAgentAttemptResult` |
| `tests/run-single-agent-attempt.test.ts` | criado |
| `README.md` | atualizado (seção "Tentativa única de agente stub", lista de módulos, resumo de milestones) |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero
dependências de runtime.

### Design de `runSingleAgentAttempt`

Recebe `{ adapter, request, responseId, promptVersion, model }` e executa, sem desvio possível:

1. revalida `request` com `parseAgentRequest` e `responseId`/`promptVersion`/`model` com um
   validador local de texto limitado (mesmo padrão de `capture-agent-response.ts`, reutilizando
   `MAX_RESPONSE_ID_LENGTH`/`MAX_PROMPT_VERSION_LENGTH`/`MAX_MODEL_LENGTH` já exportados de lá) —
   tudo **antes** de tocar o adapter, para que uma tentativa nunca seja gasta com metadados
   inválidos;
2. chama `adapter.call(request)` exatamente uma vez;
3. exige que o retorno seja `string`, ou falha fechado sem nunca inspecionar seu conteúdo;
4. captura essa string verbatim com `captureAgentResponse`, sem alterá-la, normalizá-la ou
   corrigi-la;
5. interpreta a string como JSON (`JSON.parse`) e valida o resultado com `parseAgentProposal`;
6. exige `proposal.agentId === request.agentId` e `proposal.cycleId === request.cycleId`;
7. exige `proposal.promptVersion === promptVersion` e `proposal.model === model`, os valores
   recebidos por esta tentativa, não os que a proposta alega por si só;
8. devolve `Object.freeze({ capture, proposal })` — nenhum outro campo.

Todo erro usa `ContractValidationError`/`rejectContract`, nomeando apenas o contrato, o campo e o
requisito violado. Em particular, a falha de `JSON.parse` é capturada e relançada com uma
mensagem estática (`"must be valid JSON"`), descartando deliberadamente a mensagem original do
motor JS — que em alguns runtimes ecoa um trecho do texto de entrada — para que nenhuma rejeição
possa vazar conteúdo bruto do agente.

### Testes cobertos em `tests/run-single-agent-attempt.test.ts`

Caminho feliz com `StubAgentAdapter`; adapter chamado exatamente uma vez tanto no sucesso quanto
numa rejeição posterior, e zero vezes quando os metadados já são inválidos; rota de uso único do
`StubAgentAdapter` não responde a uma segunda tentativa; preservação byte a byte da resposta bruta
(incluindo espaçamento e conteúdo unicode); rejeição de resposta não string (objeto, `undefined`,
`null`, número); rejeição de JSON inválido e de proposta estruturalmente inválida; rejeição de
divergência em `agentId`, `cycleId`, `promptVersion` e `model` entre solicitação/metadados e
proposta; ausência de conteúdo arbitrário do agente (incluindo um "segredo" simulado) em três
classes de mensagem de erro; congelamento do resultado, da captura e da proposta; ausência de
mutação da `AgentRequest` e do objeto de entrada; determinismo do resultado completo para o mesmo
input canônico; ausência de leitura de relógio; ausência de geração implícita de `responseId`;
validação fail-closed de metadados (solicitação inválida, `promptVersion` em branco, `model`
vazio, `responseId` não string) sempre sem chamar o adapter.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **657 testes, 657 passaram, 0 falharam** (628 preexistentes + 29 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio (o único teste
que usa `setTimeout` faz isso para provar que o tempo decorrido não altera o resultado, não para
esperar por I/O), nenhum uso de `random`.

### Decisões técnicas tomadas

1. **`runSingleAgentAttempt` é `async`, mas `AgentAdapter.call` continua síncrono.** A tarefa pede
   explicitamente "uma função assíncrona"; `adapter.call` já devolve `unknown` de forma síncrona
   (`src/agent/agent-adapter.ts`) e esta tarefa não autoriza alterar essa interface. A função
   `async` apenas envolve essa chamada síncrona — sem `await`, temporizador, fila de microtask
   adicional ou qualquer efeito colateral novo — deixando o seam pronto para um adapter real que
   um dia precise ser assíncrono, sem forçar essa mudança nesta tarefa.
2. **`requireBoundedText` duplicado localmente**, em vez de importado de
   `capture-agent-response.ts`, cujo helper equivalente é privado e cujas exportações esta tarefa
   não autoriza alterar. Reaproveita, porém, as constantes `MAX_RESPONSE_ID_LENGTH`,
   `MAX_PROMPT_VERSION_LENGTH` e `MAX_MODEL_LENGTH` já exportadas de lá, para que o limite nunca
   divirja entre a validação antecipada (antes da chamada) e a validação repetida dentro de
   `captureAgentResponse`.
3. **Falha de `JSON.parse` é relançada com mensagem estática, descartando a mensagem original.**
   A tarefa exige que nenhuma mensagem de erro exponha a resposta bruta; alguns motores JS incluem
   um fragmento do texto de entrada na mensagem de `SyntaxError` do `JSON.parse`, então propagar
   essa mensagem seria um vazamento indireto do conteúdo do agente.
4. ~~Nenhuma validação estrutural do próprio `adapter`.~~ **Revisto na correção pós-revisão
   abaixo**: o ChatGPT/GPT-5.6 Sol apontou que uma exceção lançada por `adapter.call` não estava
   protegida e podia propagar conteúdo arbitrário (potencialmente segredo) intacto. A decisão
   original — nenhuma checagem além do tipo estático — foi substituída por validação fail-closed
   mínima de forma (`adapter` deve ser um objeto com função `call`) mais uma guarda em torno da
   única chamada que sanitiza qualquer exceção. Ver seção "Correção pós-revisão" no fim desta
   entrada.
5. **`request`, `responseId`, `promptVersion` e `model` são revalidados aqui mesmo já tipados no
   parâmetro**, seguindo o precedente explícito de `captureAgentResponse`, que documenta
   revalidar `request` "regardless of whether it was already parsed" — um chamador pode montar
   esses valores manualmente, e a tarefa exige validação fail-closed antes da chamada, não apenas
   confiança no tipo declarado.
6. **Nenhuma classe de erro nova.** Toda rejeição usa `rejectContract`/`ContractValidationError`,
   reexportado do mesmo `src/domain/errors.ts` já usado por `agent-adapter.ts`,
   `capture-agent-response.ts` e `retry-policy.ts`.

### Limitações conhecidas

- Não há retry: uma rejeição em qualquer passo encerra a tentativa. Decidir e executar uma nova
  tentativa cabe ao chamador, junto de `src/agent/retry-policy.ts` — fora do escopo exato desta
  tarefa.
- Não há coordenador multiagente, consenso, estratégia, ciclo de replay, provider de mercado,
  ordem, fill, Risk Manager, PaperBroker, ledger ou persistência — exatamente como a tarefa
  exclui.
- `responseId` continua sendo responsabilidade do chamador; esta função não gera identificador,
  timestamp ou qualquer valor implícito.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as seis decisões acima têm alternativa única e
mais simples descartada por motivo explícito, especialmente a decisão nº 1 (`async` envolvendo uma
chamada síncrona), que fica registrada para confirmação explícita do arquiteto.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: executa tentativa unica de agente stub`
- **Hash:** informado a André na resposta após o push.

### Correção pós-revisão (bloqueio no SHA `e48cccfb63531b682de323ee3c52425dd4f9749e`)

- **Data:** 2026-09-20
- **Solicitado por:** André (revisão de código no PR #49), repassando o achado do ChatGPT/GPT-5.6
  Sol.

O achado: `adapter.call(request)` era executado sem proteção. Se um adapter lançasse uma exceção
cuja mensagem contivesse resposta bruta, token, segredo ou outro conteúdo arbitrário, essa exceção
se propagava intacta para fora de `runSingleAgentAttempt` — violando a exigência da tarefa de que
nenhum erro exponha dados arbitrários do agente ou segredos, e deixando a função dependente do
formato de erro de implementações futuras do adapter.

Correção em `src/agent/run-single-agent-attempt.ts`:

1. **`requireAdapter`** valida fail-closed, antes de qualquer chamada, que `adapter` é um objeto
   que expõe uma função `call` — sem invocá-lo e sem inspecionar seu retorno. Um `adapter` que não
   satisfaça essa forma mínima (`null`, não-objeto, objeto sem `call`, `call` não-função) é
   rejeitado com `ContractValidationError` no contrato `RunSingleAgentAttempt`, campo `adapter`,
   antes de `parseAgentRequest` sequer ser chamado.
2. A única chamada `adapter.call(request)` passou a ficar dentro de um `try/catch` que envolve
   **somente** essa chamada. Qualquer exceção lançada — `Error` ou não — é descartada por
   completo (mensagem, `cause`, stack e qualquer outra propriedade) e substituída por
   `rejectContract("AgentAdapterCall", "rawResponse", "adapter.call must not throw")`, uma
   mensagem estática que não depende em nada do valor lançado.
3. Nenhum retry foi introduzido: o `catch` só relança fechado e retorna; não há segunda tentativa,
   laço, delay ou fallback. A garantia "chama o adapter exatamente uma vez" continua valendo tanto
   no caminho de sucesso quanto no de exceção.

Testes adicionados em `tests/run-single-agent-attempt.test.ts`:

- `runSingleAgentAttempt validates the adapter fail-closed before calling it` — `adapter` nulo,
  objeto sem `call`, `call` que não é função, e um `adapter` que é uma string simulando um
  segredo (`"SECRET_TOKEN_NOT_AN_ADAPTER"`), provando que essa string nunca aparece na mensagem
  de erro.
- `runSingleAgentAttempt sanitizes exceptions thrown by adapter.call` — um adapter cujo `call`
  lança `new Error("SECRET_TOKEN_ABC123")` e outro que lança um valor não-`Error` (`throw
  "another-arbitrary-secret-value"`); em ambos os casos o teste prova que o segredo não aparece em
  `error.message` **e** que `adapter.call` foi executado exatamente uma vez (`callCount === 1`,
  via um novo `ThrowingAdapter` de teste que conta chamadas). Um terceiro teste confirma
  explicitamente a ausência de retry após a exceção.

Comandos executados após a correção: `npm run typecheck` (sem erros) e `npm test`, que reconstrói
(`npm run build`) e roda toda a suíte — **664 testes, 664 passaram, 0 falharam** (657 anteriores +
7 novos). Nenhuma rede, relógio, aleatoriedade ou I/O foi introduzida; escopo não foi ampliado além
do achado apontado na revisão.

Nenhum bloqueio remanescente é conhecido para este achado. A aprovação desta tarefa cabe ao
ChatGPT/GPT-5.6 Sol, após revisão do novo diff. Não aprovo nem mesclo o próprio trabalho.

## TASK-027 — resultado auditável de captura de agente (M4)

- **ID da tarefa:** TASK-027
- **Milestone:** M4 — resultado auditável de tentativa
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-20

### Resumo da entrega

Menor avaliação pura do M4: `evaluateAgentResponseCapture` transforma uma `AgentResponseCapture`
já capturada em um resultado auditável — `ACCEPTED(AgentProposal)` ou `REJECTED(código seguro)` —
preservando a captura original mesmo quando o conteúdo do agente é inválido, para que uma
rejeição nunca desapareça da trilha de auditoria. Não implementa retry, backoff, timeout ou HOLD
final; prepara apenas o terreno para essas fatias futuras. Reutiliza integralmente
`captureAgentResponse` (`src/agent/capture-agent-response.ts`) para a revalidação estrutural
fail-closed e `parseAgentProposal` (`src/domain/contracts.ts`) para a validação de conteúdo;
nenhuma regra de validação foi duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/coordination/CHATGPT_REVIEW_TASK_026.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/agent/capture-agent-response.ts`,
`src/agent/run-single-agent-attempt.ts`, `src/agent/retry-policy.ts`, `src/domain/contracts.ts` e
`TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/agent/evaluate-agent-response-capture.ts` | criado — `evaluateAgentResponseCapture`, `AgentResponseEvaluation`, `AcceptedAgentResponseEvaluation`, `RejectedAgentResponseEvaluation`, `AgentResponseRejectionCode`, `AGENT_RESPONSE_REJECTION_CODES` |
| `src/agent/run-single-agent-attempt.ts` | refatorado — reutiliza `evaluateAgentResponseCapture`, preservando o contrato público |
| `tests/evaluate-agent-response-capture.test.ts` | criado |
| `README.md` | atualizado (nova seção "Avaliação auditável de captura de agente"; seção "Tentativa única de agente stub" ajustada ao refactor) |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero
dependências de runtime.

### Design de `evaluateAgentResponseCapture`

Recebe `value: unknown` — nunca confia que o chamador já passou uma `AgentResponseCapture`
válida — e segue uma sequência sem desvio possível:

1. **revalidação estrutural fail-closed**, delegada inteiramente a `captureAgentResponse(value)`:
   uma captura forjada ou estruturalmente inválida (tipo errado, campo ausente, `request` aninhado
   inválido, limites de tamanho violados) lança `ContractValidationError` aqui, antes de qualquer
   avaliação de conteúdo. `rawResponse` não é alterado por essa revalidação — apenas verificado
   quanto a tipo, não-vazio e limite de tamanho, exatamente como `captureAgentResponse` já fazia;
2. `rawResponse` é interpretado como JSON dentro de um `try/catch` local — falha de parse produz
   `REJECTED` com `INVALID_JSON`, nunca uma exceção;
3. o valor decodificado é validado com `parseAgentProposal`; qualquer `ContractValidationError`
   lançada por ele é convertida em `REJECTED` com `INVALID_PROPOSAL` — genérico, sem carregar o
   campo/requisito específico que `parseAgentProposal` teria relatado, para não vazar estrutura
   detalhada da proposta rejeitada através de um "código seguro". Uma exceção de qualquer outro
   tipo (que não deveria ocorrer, dado que `parseAgentProposal` só lança
   `ContractValidationError`) não é engolida: propaga para o chamador;
4. alinhamento de identidade e proveniência, verificado nessa ordem fixa e parando no primeiro
   desvio: `proposal.agentId` contra `capture.request.agentId` (`AGENT_ID_MISMATCH`),
   `proposal.cycleId` contra `capture.request.cycleId` (`CYCLE_ID_MISMATCH`),
   `proposal.promptVersion` contra `capture.promptVersion` (`PROMPT_VERSION_MISMATCH`),
   `proposal.model` contra `capture.model` (`MODEL_MISMATCH`);
5. sem nenhuma divergência, devolve `{ status: "ACCEPTED", capture, proposal }`, congelado.

Em todo caminho — `ACCEPTED` ou `REJECTED` — o campo `capture` do resultado é exatamente a cópia
revalidada e congelada produzida no passo 1, nunca o objeto de entrada por referência; como
strings são imutáveis, isso já garante preservação byte a byte de `rawResponse` sem qualquer
cópia manual adicional.

### Códigos de rejeição fechados

`AGENT_RESPONSE_REJECTION_CODES` é uma tupla `as const` com exatamente os seis códigos exigidos
pela tarefa: `INVALID_JSON`, `INVALID_PROPOSAL`, `AGENT_ID_MISMATCH`, `CYCLE_ID_MISMATCH`,
`PROMPT_VERSION_MISMATCH`, `MODEL_MISMATCH`. Nenhum deles carrega mensagem, stack, `cause`, valor
recebido ou qualquer conteúdo arbitrário do agente — são literais de string fixos, então um
código é sempre seguro para logar ou exibir, exatamente como a tarefa exige.

### Refactor de `runSingleAgentAttempt`

`src/agent/run-single-agent-attempt.ts` manteve sua assinatura, seu comportamento observável e
sua sequência de validações prévias (`adapter`, `request`, `responseId`, `promptVersion`,
`model`, chamada única ao adapter com exceção sanitizada, checagem de que a resposta é uma
`string`). A partir daí, em vez de capturar, interpretar JSON, validar a proposta e checar
alinhamento inline, ele monta `{ request, responseId, rawResponse, promptVersion, model }` e
delega tudo isso a `evaluateAgentResponseCapture`. Um resultado `REJECTED` é convertido, por um
novo helper local `rejectForCode`, exatamente na mesma `ContractValidationError` — mesmo
contrato, campo e requisito — que a versão anterior já lançava para cada uma das seis falhas;
um resultado `ACCEPTED` devolve `{ capture: evaluation.capture, proposal: evaluation.proposal }`,
congelado, como antes. Nenhum teste pré-existente em `tests/run-single-agent-attempt.test.ts` foi
alterado — os testes já cobriam exatamente o contrato público que a tarefa exige preservar
("chamada única, comportamento atual e erros sanitizados"), e todos continuam passando sem
modificação, o que é a própria prova de que o refactor é internamente transparente.

### Testes cobertos em `tests/evaluate-agent-response-capture.test.ts`

`ACCEPTED` para proposta válida e alinhada; cada um dos seis códigos `REJECTED` isoladamente, mais
um teste de tabela que percorre os seis cenários e confirma que o código devolvido pertence a
`AGENT_RESPONSE_REJECTION_CODES`; preservação byte a byte de `rawResponse` em `ACCEPTED` (incluindo
formatação/indentação) e em `REJECTED` (incluindo texto malformado com caractere de controle) e de
conteúdo unicode; ausência de segredo/token/valor arbitrário no código de um `REJECTED` (resposta
malformada contendo um "token" e proposta com um `agentId` forjado) e na mensagem de erro de uma
captura forjada (`ContractValidationError` para uma string qualquer no lugar da captura); captura
forjada ou estruturalmente inválida falhando fechado antes de qualquer avaliação de conteúdo —
valor não-objeto, `rawResponse` ausente, `request` aninhado inválido, `promptVersion` em branco,
`responseId` não-string; congelamento do resultado, de `capture` e — quando `ACCEPTED` — de
`proposal`, incluindo tentativa de reatribuição lançando `TypeError`; ausência de mutação do
objeto de entrada e da instância de `AgentRequest` passada como `request`; determinismo campo a
campo para o mesmo input canônico, tanto em `ACCEPTED` quanto em `REJECTED`; prova offline de
ausência de relógio (resultado idêntico independentemente do instante de chamada) e de que a
função é síncrona (não devolve uma `Promise`).

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **691 testes, 691 passaram, 0 falharam** (664 preexistentes + 27 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum uso de
`random`, nenhum I/O.

### Decisões técnicas tomadas

1. **`evaluateAgentResponseCapture` recebe `value: unknown`, não um `AgentResponseCapture` já
   tipado.** A tarefa exige revalidação fail-closed da estrutura completa antes de avaliar
   conteúdo — um parâmetro tipado não impede um chamador de passar em runtime um objeto forjado
   ou um `AgentResponseCapture` obtido de fora deste módulo. Aceitar `unknown` e revalidar com
   `captureAgentResponse` torna essa garantia estrutural, não apenas nominal — o mesmo padrão já
   usado por `shouldRetryAgentAttempt`, que revalida `policy` mesmo tipado.
2. **A revalidação estrutural do passo 1 é delegada inteiramente a `captureAgentResponse`, sem
   nenhuma checagem duplicada local.** `captureAgentResponse` já é exatamente "a estrutura
   completa de `AgentResponseCapture`, sem alterar `rawResponse`"; duplicar essas checagens aqui
   violaria a instrução explícita da tarefa de reutilizar avaliação em vez de reimplementar
   validação já existente.
3. **`INVALID_PROPOSAL` é um código genérico, sem propagar o campo/requisito que
   `parseAgentProposal` teria relatado.** A tarefa fecha a lista de códigos em seis nomes fixos e
   exige que "nenhuma informação arbitrária apareça em erros ou códigos" — carregar o campo
   específico da proposta que falhou seria vazar estrutura de conteúdo do agente através de um
   canal que a tarefa define como seguro por ser fechado.
4. **`runSingleAgentAttempt` converte cada código `REJECTED` de volta no mesmo par
   contrato/campo/requisito que já lançava antes do refactor**, via um `switch` exaustivo
   (`rejectForCode`) sobre os seis literais de `AgentResponseRejectionCode`. O refactor é
   observável apenas como uma reorganização interna: nenhum teste pré-existente precisou mudar, e
   o contrato público documentado pela tarefa permanece válido byte a byte nas mensagens de erro.
5. **A checagem `typeof rawResponse !== "string"` permaneceu em `runSingleAgentAttempt`**, em vez
   de ser removida e delegada só a `captureAgentResponse` dentro da avaliação, preservando
   exatamente o contrato/campo relatado nesse caso (`RawAgentResponse`/`rawResponse`) — o refactor
   mais conservador possível, "apenas no necessário para reutilizar essa avaliação".
6. **Nenhuma classe de erro nova.** Toda revalidação estrutural usa
   `ContractValidationError`/`rejectContract`; os seis códigos de rejeição de conteúdo são
   literais de string simples, não uma nova hierarquia de exceção, porque a tarefa pede uma união
   discriminada de dados, não um novo tipo de erro lançável.

### Limitações conhecidas

- Não implementa retry, backoff, timeout, coordenador multiagente ou HOLD final — essas
  permanecem fatias futuras de M4, explicitamente fora do escopo exato desta tarefa.
- Não persiste nada em arquivo, fila ou log externo: o resultado da avaliação vive apenas em
  memória, como todas as milestones anteriores.
- `evaluateAgentResponseCapture` avalia uma única captura por chamada; não há composição de
  múltiplas tentativas nem agregação — isso é trabalho de uma fatia de coordenação futura.

### Decisões pendentes para André / revisor

Nenhuma decisão técnica ambígua ficou pendente; as seis decisões acima têm alternativa única e
mais simples descartada por motivo explícito.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: avalia captura de agente com resultado auditavel`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit. Não aprovo nem
mesclo o próprio trabalho.

## TASK-028 — Decisão pura de progresso de tentativas auditáveis (M4)

- **ID da tarefa:** TASK-028
- **Milestone:** M4 — decisão pura de progresso de tentativas
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo da entrega

Menor máquina de estados pura do M4: `decideAgentAttemptProgress` recebe uma
`AgentRetryPolicy` e o histórico `readonly` de resultados de
`evaluateAgentResponseCapture` de um agente/ciclo/prompt/modelo, e decide qual dos três
estados fechados vale a seguir — `ATTEMPT_AVAILABLE`, `ACCEPTED` ou `ATTEMPTS_EXHAUSTED` —
sem jamais chamar um `AgentAdapter`, executar uma tentativa, fazer retry, produzir `HOLD`,
persistir ou acionar qualquer integração. Reutiliza integralmente `parseAgentRetryPolicy`
(`src/agent/retry-policy.ts`) e `evaluateAgentResponseCapture`
(`src/agent/evaluate-agent-response-capture.ts`); nenhuma regra de validação de política ou
de captura foi duplicada.

Leitura obrigatória cumprida: `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/coordination/CHATGPT_REVIEW_TASK_027.md`,
`docs/coordination/CLAUDE_REPORT.md`, `src/agent/evaluate-agent-response-capture.ts`,
`src/agent/retry-policy.ts`, `src/agent/capture-agent-response.ts`, `src/domain/contracts.ts`
e `TASK.md`.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| `src/agent/decide-agent-attempt-progress.ts` | criado — `decideAgentAttemptProgress`, `AgentAttemptProgress`, `AttemptAvailableProgress`, `AcceptedAttemptProgress`, `AttemptsExhaustedProgress` |
| `tests/decide-agent-attempt-progress.test.ts` | criado |
| `README.md` | atualizado (seção "Decisão pura de progresso de tentativas auditáveis") |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado. Nenhuma dependência foi adicionada — o projeto continua com zero
dependências de runtime.

### Design de `decideAgentAttemptProgress`

Não confia em `results` como já validado, mesmo que o parâmetro seja tipado
`readonly AgentResponseEvaluation[]` — o mesmo princípio que `shouldRetryAgentAttempt` já
aplica a `policy` tipada. Sequência, sem desvio possível:

1. `policy` é revalidada fail-closed via `parseAgentRetryPolicy`;
2. `results` precisa ser um array; cada entrada é **recomputada do zero** — nunca confiada —
   extraindo apenas sua `capture` aninhada e entregando-a de novo a
   `evaluateAgentResponseCapture`. Isso descarta por completo qualquer `status`, `proposal`
   ou `code` que a entrada alegasse: uma entrada forjada que afirma `ACCEPTED` sobre uma
   captura que na verdade falha é recomputada como `REJECTED`, e vice-versa. Uma captura
   estruturalmente inválida (campo ausente, tipo errado, objeto forjado) lança
   `ContractValidationError` nesse ponto, antes de qualquer outra regra rodar;
3. lista com mais entradas que `policy.maxAttempts` falha fechado;
4. qualquer entrada recomputada como `ACCEPTED` que não seja a última falha fechado —
   cobre tanto "mais uma tentativa depois de aceita" quanto "duas aceitações", já que a
   segunda nunca pode ser a única na posição final se a primeira também é `ACCEPTED` e não é
   a última;
5. proveniência: todas as capturas recomputadas precisam compartilhar exatamente
   `agentId`, `cycleId` (ambos de `capture.request`), `promptVersion` e `model` da primeira
   — qualquer divergência falha fechado;
6. resultado: se a última entrada é `ACCEPTED`, devolve `{ status: "ACCEPTED", result, completedAttempts }`
   com `result` sendo a avaliação aceita completa (captura e proposta validadas, preservadas
   apenas neste ramo); caso contrário, todas as entradas são `REJECTED` — se
   `results.length === policy.maxAttempts`, devolve `ATTEMPTS_EXHAUSTED` com todos os códigos
   na ordem em que ocorreram; senão devolve `ATTEMPT_AVAILABLE` com o código da rejeição mais
   recente, quando houver alguma.

Uma lista vazia é o caso base: nenhuma captura para recomputar, nenhuma proveniência para
comparar, `completedAttempts: 0`, sempre `ATTEMPT_AVAILABLE`.

### Por que nenhuma resposta bruta escapa de um estado não aceito

`ATTEMPT_AVAILABLE` e `ATTEMPTS_EXHAUSTED` só carregam contagens e
`AgentResponseRejectionCode` — a mesma união fechada de seis literais de string que
`evaluateAgentResponseCapture` já garante nunca carregar mensagem, stack, `cause`, token ou
qualquer conteúdo do agente. Nenhum dos dois estados referencia `capture` ou `proposal`.
Somente `ACCEPTED.result` preserva a captura auditável — exatamente o que a tarefa autoriza
("o resultado aceito pode preservar sua captura auditável apenas no payload `ACCEPTED`").
Todo erro lançado usa `ContractValidationError`/`rejectContract`, que nomeia apenas
contrato/campo/requisito, nunca o valor recebido.

### Testes cobertos em `tests/decide-agent-attempt-progress.test.ts`

Lista vazia devolvendo `ATTEMPT_AVAILABLE` com `completedAttempts: 0` para toda política
válida (1 a 3); rejeições abaixo do limite com contagem e último código corretos; rejeições
exatamente no limite devolvendo `ATTEMPTS_EXHAUSTED` com todos os códigos na ordem certa,
para toda política válida; rejeições acima do limite falhando fechado; aceitação na primeira
tentativa, após rejeições e no último slot permitido (não confundida com esgotamento);
tentativa após `ACCEPTED` falhando fechado nos três arranjos (rejeição depois, segunda
aceitação depois, aceitação entre duas rejeições); política inválida — forjada acima do
limite, zero, fracionária, não-objeto — falhando fechado; `results` não-array, entrada que
não é objeto, entrada sem `capture` e captura aninhada estruturalmente inválida (sem
`rawResponse`) falhando fechado; um `status`/`code` forjado sendo ignorado e recomputado
corretamente em ambas as direções (forjar `ACCEPTED` sobre captura que rejeita vira
`ATTEMPTS_EXHAUSTED`; forjar `REJECTED` sobre captura que aceita vira `ACCEPTED`);
proveniência divergente em `agentId`, `cycleId`, `promptVersion` e `model`, cada uma falhando
fechado; ausência de segredo embutido numa resposta bruta rejeitada em `ATTEMPT_AVAILABLE` e
em `ATTEMPTS_EXHAUSTED`, e na mensagem de erro de uma divergência de proveniência;
preservação da captura/proposta somente em `ACCEPTED`; congelamento do resultado e do array
`rejectionCodes`, com tentativa de reatribuição lançando `TypeError`; ausência de mutação da
política e da lista de resultados recebidas; determinismo campo a campo para o mesmo input
canônico em `ATTEMPT_AVAILABLE` e `ACCEPTED`; prova offline de ausência de relógio,
`Math.random`, `setTimeout` e `fetch`, de que a função é síncrona, e de que nenhuma chamada a
adaptador é sequer possível (a função não recebe um).

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm run build` | sem erros |
| `npm test` | **729 testes, 729 passaram, 0 falharam** (691 preexistentes + 38 novos) |

Suíte offline e determinística: nenhum acesso de rede, nenhuma leitura de relógio, nenhum uso
de `random`, nenhum I/O.

### Decisões técnicas tomadas

1. **Cada entrada de `results` é recomputada do zero a partir de sua `capture` aninhada, em
   vez de ter seu `status`/`proposal`/`code` validados e então aceitos.** A tarefa exige
   "revalida... e reavalia/valida cada captura; não confia em objetos estruturalmente
   forjados". Recomputar via `evaluateAgentResponseCapture(entry.capture)` é a leitura mais
   literal de "reavalia": qualquer discriminante que a entrada alegasse é descartado e
   substituído pelo resultado verdadeiro, o que neutraliza uma forgery em vez de apenas
   detectá-la quando ela é estruturalmente válida mas semanticamente mentirosa (dois testes
   cobrem essa neutralização nos dois sentidos).
2. **Uma captura estruturalmente inválida ainda lança `ContractValidationError`, nunca vira
   uma variante de dado.** Isso vem de graça de `evaluateAgentResponseCapture`, que já separa
   "captura forjada" (lança) de "conteúdo do agente inválido" (devolve `REJECTED`) — este
   módulo não precisou duplicar essa distinção.
3. **A regra "nenhuma entrada após `ACCEPTED`" é verificada por posição (`index !==
   results.length - 1`), não por contagem de quantos `ACCEPTED` existem.** Isso cobre o caso
   de duas aceitações (a primeira nunca pode estar na posição final se a lista tem mais de
   uma entrada) sem precisar de uma regra separada para "não mais que um `ACCEPTED`".
4. **`lastRejectionCode` é um campo opcional, omitido (não `undefined`) quando não há
   nenhuma rejeição ainda.** O `tsconfig.json` do projeto liga
   `exactOptionalPropertyTypes`; a chave é adicionada só condicionalmente via spread, para que
   `"lastRejectionCode" in progress` seja `false` na lista vazia, em vez de `true` com valor
   `undefined`.
5. **`ACCEPTED.result` é a `AcceptedAgentResponseEvaluation` inteira (capture + proposal)**,
   não um subconjunto de campos escolhidos a dedo. A tarefa pede "o resultado aceito
   validado"; reaproveitar o tipo que `evaluateAgentResponseCapture` já exporta evita
   inventar uma quarta forma para o mesmo dado.
6. **Nenhuma classe de erro nova.** Toda falha fechada usa `ContractValidationError`/
   `rejectContract`, com dois nomes de contrato locais (`AgentAttemptResults`,
   `AgentAttemptProvenance`) só para identificar qual regra disparou — nunca um código ou
   union de erro novo, porque a tarefa define uma união discriminada de *dados* de sucesso,
   não uma nova hierarquia de exceção.

### Limitações conhecidas

- Não implementa execução de tentativa, loop de retry, backoff, timeout, `HOLD` final,
  coordenador multiagente, persistência ou logs externos — todos explicitamente fora do
  escopo exato desta tarefa e adiados para fatias futuras de M4.
- `decideAgentAttemptProgress` decide um único agente/ciclo/prompt/modelo por chamada; não há
  agregação entre agentes ou entre ciclos — isso permanece trabalho de uma composição futura.
- A proveniência exigida (`agentId`, `cycleId`, `promptVersion`, `model`) não inclui
  `snapshotId`: a tarefa não pede essa dimensão, e `AgentRequest.snapshotId` pode
  legitimamente mudar entre tentativas de retry do mesmo ciclo (uma nova tentativa pode ler
  um snapshot mais recente). Se o arquiteto pretendia incluir `snapshotId` na proveniência
  exigida, é uma adição contida a `requireSharedProvenance`.

### Decisões pendentes para André / revisor

1. **`snapshotId` fora da proveniência exigida** — decisão técnica implícita acima; a leitura
   mais literal do escopo exato da tarefa ("mesmo `agentId`, `cycleId`, `promptVersion` e
   `model`") não o inclui, mas fica registrado para confirmação.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: decide progresso de tentativas de agente`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit. Não aprovo nem
mesclo o próprio trabalho.

## TASK-028 — Correção do ciclo 1 de revisão (mudanças solicitadas por André)

- **ID da tarefa:** TASK-028
- **Motivo:** revisão de André no PR #53 sobre o SHA `500017df03e200edc5e7eb0492574f7d9c713f1f`
  pediu `CHANGES_REQUESTED` (ciclo 1 de no máximo 3).
- **Status reportado:** correção executada, aguardando revisão do ChatGPT/GPT-5.6 Sol e nova
  revisão de André (não aprovada por mim)
- **Data:** 2026-09-21

### Bloqueio apontado

`reevaluateResult` recomputava a avaliação de cada entrada a partir de sua `capture` aninhada,
mas descartava silenciosamente o `status`, `code` e `proposal` que a entrada original
declarava, confiando só no resultado recomputado. Uma entrada forjada/inconsistente — por
exemplo, declarada `REJECTED` cuja captura na verdade produz uma proposta válida — era então
"corrigida" silenciosamente para `ACCEPTED`, em vez de falhar fechado. Os dois testes
existentes ("recomputes a forged ACCEPTED/REJECTED status...") comprovavam esse comportamento
como intencional, o que violava o critério de aceite "entrada forjada, inconsistente ...
falha fechada" e enfraquecia a trilha auditável.

### Correção aplicada

`src/agent/decide-agent-attempt-progress.ts`:

- `reevaluateResult` continua recomputando a avaliação verdadeira a partir da `capture`
  aninhada via `evaluateAgentResponseCapture`, mas agora chama a nova função
  `requireDeclaredResultMatchesRecomputed(source, recomputed)` antes de devolver o resultado;
- essa função exige, fail-closed, que `source.status` seja idêntico ao `recomputed.status`;
  para `REJECTED`, exige o mesmo `code` e ausência de campo `proposal`; para `ACCEPTED`, exige
  ausência de campo `code` e que `source.proposal` seja estruturalmente igual, campo a campo
  (`proposalMatchesRecomputed`), ao `proposal` recomputado — incluindo `evidenceIds` em ordem;
- qualquer divergência de discriminante, código, proposta ou forma lança
  `ContractValidationError` via `rejectContract`, que nomeia só contrato/campo/requisito,
  nunca o valor declarado nem o recomputado — nenhum vazamento;
- nenhuma classe de erro nova, nenhuma mudança de assinatura pública, nenhuma dependência
  nova.

`tests/decide-agent-attempt-progress.test.ts`:

- os dois testes que antes comprovavam a aceitação de discriminantes forjados foram
  **substituídos** por testes que comprovam falha fechada nos mesmos dois cenários (entrada
  `ACCEPTED` cuja captura rejeita; entrada `REJECTED` cuja captura aceita);
- adicionados: código de rejeição adulterado; payload `proposal` incompatível presente numa
  entrada `REJECTED`; campo `proposal` adulterado numa entrada `ACCEPTED`; payload `code`
  incompatível presente numa entrada `ACCEPTED`; e um teste específico de ausência de
  vazamento, confirmando que um valor adulterado inserido em `proposal.reason` não aparece na
  mensagem do `ContractValidationError` lançado.

Nenhum outro arquivo de produção foi alterado. Escopo estritamente offline preservado: nenhuma
dependência, rede, timer, relógio ou aleatoriedade foi introduzida.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **734 testes, 734 passaram, 0 falharam** (729 preexistentes − 2 substituídos + 7 novos) |

Confirmação específica: os 7 testes novos/substituídos de
`decideAgentAttemptProgress: forged or structurally invalid results fail closed` passam
(`fails closed on an entry declared ACCEPTED...`, `...declared REJECTED...`, `...tampered
rejection code`, `...incompatible proposal payload`, `...tampered proposal field`,
`...incompatible rejection code payload`, `does not leak the tampered proposal's content...`).

### Limitações conhecidas

As mesmas já registradas na entrega original da TASK-028 permanecem válidas; nenhuma nova
limitação foi introduzida por esta correção.

### Decisões pendentes para André / revisor

Nenhuma nova. A pendência sobre `snapshotId` fora da proveniência exigida, registrada na
entrega original, continua em aberto para confirmação.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `fix: falha fechada em avaliacao forjada de tentativa de agente`
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI.

## TASK-028 — Correção do ciclo 2 de revisão (mudanças solicitadas por André)

- **ID da tarefa:** TASK-028
- **Motivo:** revisão de André no PR #53 sobre o SHA `ca81f6230d0c4af3ed42f8dc50683488d38f0897`
  pediu `CHANGES_REQUESTED` (ciclo 2 de no máximo 3).
- **Status reportado:** correção executada, aguardando revisão do ChatGPT/GPT-5.6 Sol e nova
  revisão de André (não aprovada por mim)
- **Data:** 2026-09-21

### Bloqueio apontado

A correção do ciclo 1 exigia discriminante, código e proposta consistentes, mas a checagem
ainda não era fechada quanto à forma:

1. `if (source.proposal !== undefined)` em `REJECTED` aceitava uma propriedade `proposal`
   presente com valor `undefined` — presença detectada pelo valor, não pela propriedade;
2. `if (source.code !== undefined)` em `ACCEPTED` tinha o mesmo problema para `code`;
3. `proposalMatchesRecomputed` comparava os campos conhecidos mas não validava o conjunto de
   chaves do objeto declarado, então uma proposta forjada como `{ ...proposal, injected: "..." }`
   ainda passava na comparação campo a campo.

### Correção aplicada

`src/agent/decide-agent-attempt-progress.ts`:

- nova função `requireExactOwnKeys(value, expectedKeys, contract, field)`, que compara
  `Object.keys(value)` contra um conjunto de chaves esperado exato — sem chave faltando, sem
  chave extra, incluindo uma chave presente só com valor `undefined`;
- `requireDeclaredResultMatchesRecomputed` agora chama `requireExactOwnKeys` com
  `REJECTED_RESULT_KEYS = ["status", "capture", "code"]` para entradas `REJECTED` e
  `ACCEPTED_RESULT_KEYS = ["status", "capture", "proposal"]` para `ACCEPTED`, antes de validar
  `code`/`proposal` por valor — isso substitui as checagens antigas por valor (`!== undefined`)
  e fecha os dois bypasses de presença;
- `proposalMatchesRecomputed` agora valida primeiro que `Object.keys(declared)` é exatamente
  `ACCEPTED_PROPOSAL_KEYS` (os 12 campos de `AgentProposal`, sem mais nem menos) antes de
  comparar campo a campo — uma propriedade injetada na proposta declarada agora falha fechado;
- nenhuma classe de erro nova, nenhuma mudança de assinatura pública, nenhuma dependência nova;
  erros continuam sanitizados via `rejectContract` (só contrato/campo/requisito).

`tests/decide-agent-attempt-progress.test.ts`:

- adicionados 5 testes de regressão: `proposal: undefined` presente numa entrada `REJECTED`;
  `code: undefined` presente numa entrada `ACCEPTED`; propriedade extra injetada numa entrada
  `REJECTED`; propriedade extra injetada numa entrada `ACCEPTED`; propriedade extra injetada na
  `proposal` de uma entrada `ACCEPTED`.

Nenhum outro arquivo de produção foi alterado. Escopo estritamente offline preservado: nenhuma
dependência, rede, timer, relógio ou aleatoriedade foi introduzida.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **739 testes, 739 passaram, 0 falharam** (734 anteriores + 5 novos) |

### Limitações conhecidas

As mesmas já registradas na entrega original da TASK-028 permanecem válidas; nenhuma nova
limitação foi introduzida por esta correção.

### Decisões pendentes para André / revisor

Nenhuma nova. A pendência sobre `snapshotId` fora da proveniência exigida, registrada na
entrega original, continua em aberto para confirmação.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `fix: valida forma fechada de resultado e proposta declarados`
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI.

## TASK-029 — executa tentativa auditável de agente

- **ID da tarefa:** TASK-029
- **Status reportado:** entrega executada, aguardando revisão do ChatGPT/GPT-5.6 Sol e de André
  (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

Criado `src/agent/run-auditable-agent-attempt.ts`, definindo `runAuditableAgentAttempt`: a
menor composição que chama `AgentAdapter.call` exatamente uma vez e devolve diretamente a
união imutável `AgentResponseEvaluation` (`ACCEPTED(AgentProposal) | REJECTED(código seguro)`),
em vez de lançar exceção para uma resposta inválida. A sequência é fail-closed em cada passo:

1. valida o próprio objeto de entrada, `adapter`, `request` (`parseAgentRequest`), `responseId`,
   `promptVersion` e `model` antes de tocar o adapter;
2. chama `adapter.call(request)` exatamente uma vez; qualquer exceção lançada vira uma
   `ContractValidationError` com mensagem fixa e sanitizada, sem `message`, `stack`, `cause` ou
   conteúdo original;
3. exige que o retorno bruto seja `string` — outro tipo falha fechado antes de criar captura;
4. entrega a resposta bruta, sem normalização, a `evaluateAgentResponseCapture`, que preserva a
   captura tanto em `ACCEPTED` quanto em `REJECTED`.

`src/agent/run-single-agent-attempt.ts` foi refatorado para delegar inteiramente a
`runAuditableAgentAttempt` — nenhuma segunda implementação da validação ou da chamada ao
adapter permanece nesse arquivo. `runSingleAgentAttempt` mantém seu contrato público idêntico:
`ACCEPTED` continua devolvendo `{ capture, proposal }`; `REJECTED` continua sendo convertido na
mesma `ContractValidationError` sanitizada já existente para cada um dos seis códigos, via a
função `rejectForCode` preservada sem alteração de comportamento. Nenhuma chamada adicional ao
adaptador é introduzida.

Como a validação de metadados (`adapter`, `responseId`, `promptVersion`, `model`) agora vive em
`runAuditableAgentAttempt`, o nome de contrato usado nessas mensagens sanitizadas passou de
`RunSingleAgentAttempt` para `RunAuditableAgentAttempt`. Nenhum teste (novo ou pré-existente)
depende do texto literal dessas mensagens — apenas de `instanceof ContractValidationError` e da
ausência de conteúdo sensível — então o comportamento público observável de
`runSingleAgentAttempt` permanece o mesmo.

### Arquivos alterados

- `src/agent/run-auditable-agent-attempt.ts` (novo)
- `src/agent/run-single-agent-attempt.ts` (refatorado para delegar)
- `tests/run-auditable-agent-attempt.test.ts` (novo)
- `README.md` (nova seção "Tentativa auditável de agente"; substitui a seção anterior
  "Tentativa única de agente stub")
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes obrigatórios cobertos

- `ACCEPTED` chama o adaptador exatamente uma vez e preserva captura/proposta;
- os seis códigos `REJECTED` (`INVALID_JSON`, `INVALID_PROPOSAL`, `AGENT_ID_MISMATCH`,
  `CYCLE_ID_MISMATCH`, `PROMPT_VERSION_MISMATCH`, `MODEL_MISMATCH`) são devolvidos como dado,
  com captura bruta byte a byte;
- resposta não-string (`object`, `undefined`, `null`, número) e exceção do adaptador (com
  `Error` e com valor não-`Error`) falham fechado, sem segunda chamada;
- mensagem, stack, cause, token, segredo ou valor arbitrário lançado pelo adaptador não aparecem
  no erro;
- objeto de entrada forjado (`null`, array), adaptador forjado (`null`, sem `call`, `call` não
  função, valor não-objeto), `AgentRequest` inválido, `promptVersion`/`model`/`responseId`
  inválidos falham antes da chamada ao adaptador;
- `runSingleAgentAttempt` mantém todos os 36 testes pré-existentes (`tests/run-single-agent-attempt.test.ts`,
  inalterado) após a refatoração;
- resultados congelados (`ACCEPTED` e `REJECTED`), ausência de mutação do `AgentRequest` e do
  objeto de entrada, e determinismo campo a campo para o mesmo adaptador stub;
- prova de ausência de retry (`StubAgentAdapter` de rota única não responde uma segunda vez), de
  leitura de relógio (resultado idêntico independentemente do tempo decorrido) e de geração
  implícita de `responseId`; nenhuma dependência de rede, SDK, ambiente ou persistência é usada
  em nenhum dos dois módulos.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **771 testes, 771 passaram, 0 falharam** (739 anteriores + 32 novos, ambiente local Node.js 22) |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR.

### Limitações conhecidas

- A execução local só cobriu Node.js 22 (versão disponível no ambiente); Node.js 20 será
  verificado pela matriz de CI no PR.
- A pendência sobre `snapshotId` fora da proveniência exigida, registrada em entregas
  anteriores, continua em aberto para confirmação por André/ChatGPT.

### Decisões pendentes para André / revisor

Nenhuma nova.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: executa tentativa auditavel de agente`
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI.

## TASK-029 — correção 1/3 (revisão `REQUEST_CHANGES` no SHA `260f1c005dfa5d2b2f1b8105eb81f48325d74939`)

- **Status reportado:** correção executada, aguardando revisão do ChatGPT/GPT-5.6 Sol e de André
  (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

A revisão de André apontou dois problemas na entrega original de TASK-029, ambos corrigidos sem
ampliar o escopo:

1. **Mensagens públicas de `runSingleAgentAttempt` deixaram de ser idênticas às anteriores.**
   Após a refatoração, a validação de `adapter`, `responseId`, `promptVersion` e `model` passou a
   lançar `ContractValidationError` com o nome de contrato `RunAuditableAgentAttempt`, em vez do
   histórico `RunSingleAgentAttempt` — uma mudança real de mensagem pública, mesmo sem nenhum
   teste existente depender do texto literal. Corrigido extraindo a sequência inteira de
   validação e chamada única para `runAuditableAgentAttemptAs(contract, value)`
   (`src/agent/run-auditable-agent-attempt.ts`), parametrizada pelo nome do contrato usado em
   cada mensagem sanitizada. `runAuditableAgentAttempt` passou a ser essa função chamada com o
   próprio nome de contrato do módulo; `runSingleAgentAttempt` (`src/agent/run-single-agent-attempt.ts`)
   passou a chamá-la com `RunSingleAgentAttempt`, restaurando byte a byte as mensagens que sempre
   lançou. Continua existindo uma única implementação da validação e da chamada ao adapter — nenhuma
   duplicação.
2. **`requireAdapter` podia expor o valor lançado por um `call` forjado.** A leitura de
   `value.call` acontecia fora de qualquer guarda; um adaptador com um getter (ou um `Proxy` com
   trap de `get`) que lança ao ser lido fazia esse valor — mensagem, stack, `cause`, segredo —
   escapar sem sanitização, antes mesmo de qualquer chamada ao adapter. Corrigido com
   `readAdapterCall`, que lê `call` dentro de um `try/catch` e trata qualquer exceção como
   "propriedade ausente", falhando fechado com a mesma `ContractValidationError` sanitizada de
   sempre — sem jamais invocar `call` nem repassar o valor lançado.

Nenhuma chamada adicional ao adapter foi introduzida; a sequência permanece validação
fail-closed → uma única `adapter.call` → avaliação.

### Arquivos alterados

- `src/agent/run-auditable-agent-attempt.ts` (contrato parametrizado; `requireAdapter` protegida
  contra getter/proxy que lança; nova função exportada `runAuditableAgentAttemptAs`)
- `src/agent/run-single-agent-attempt.ts` (delega a `runAuditableAgentAttemptAs` com seu próprio
  nome de contrato)
- `tests/run-auditable-agent-attempt.test.ts` (testes de contrato parametrizado e de getter/proxy
  malicioso)
- `tests/run-single-agent-attempt.test.ts` (testes de regressão comparando as mensagens públicas
  anteriores byte a byte, e de getter/proxy malicioso)
- `README.md` (documenta `runAuditableAgentAttemptAs` e a proteção de `requireAdapter`)
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes obrigatórios cobertos

- `runAuditableAgentAttemptAs` usa o nome de contrato do chamador em toda validação anterior à
  chamada do adapter (objeto de entrada, adaptador, `responseId`/`promptVersion`/`model`), e
  `runAuditableAgentAttempt` continua usando o seu próprio;
- `runSingleAgentAttempt` mantém, byte a byte, as mensagens (`error.message`) e o nome de
  contrato (`error.contract`) originais para adaptador inválido (incluindo valor não-objeto sem
  vazar o valor), `responseId` não-string, `promptVersion` em branco, `model` vazio e
  `AgentRequest` inválido;
- adaptador forjado com getter de `call` que lança um segredo, e com `Proxy` cujo trap de `get`
  lança um segredo: em ambos os casos a rejeição é sanitizada, a propriedade é lida exatamente
  uma vez e nenhuma chamada ao adapter ocorre — testado tanto em
  `runAuditableAgentAttempt` quanto em `runSingleAgentAttempt`;
- suíte completa permanece verde: `npm run typecheck` sem erros; `npm test` **785 testes, 785
  passaram, 0 falharam** (771 anteriores + 14 novos), ambiente local Node.js 22.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **785 testes, 785 passaram, 0 falharam** |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR.

### Limitações conhecidas

Mesmas da entrega original de TASK-029; nenhuma nova introduzida por esta correção.

### Decisões pendentes para André / revisor

Nenhuma nova.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** ajuste solicitado via comentário do PR #55 (correção 1/3 da revisão
  `REQUEST_CHANGES`), sem alterar `TASK.md` nem o status de TASK-029.
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI.

## TASK-030 — executa tentativas auditáveis limitadas

- **Status reportado:** entrega executada, aguardando revisão do ChatGPT/GPT-5.6 Sol e de André
  (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

Criado `src/agent/run-bounded-agent-attempts.ts`, definindo `runBoundedAgentAttempts`: a menor
composição offline que encadeia `runAuditableAgentAttempt` (`./run-auditable-agent-attempt.ts`) e
`decideAgentAttemptProgress` (`./decide-agent-attempt-progress.ts`) para executar, no máximo,
`policy.maxAttempts` tentativas sequenciais de um mesmo agente/ciclo:

```text
AgentRetryPolicy + ids explícitos
→ runAuditableAgentAttempt (uma chamada por tentativa)
→ ACCEPTED | próxima tentativa | ATTEMPTS_EXHAUSTED
```

A função recebe explicitamente `adapter`, `request`, `policy`, `responseIds` (lista ordenada
fornecida pelo chamador, uma por tentativa permitida), `promptVersion` e `model`. Antes de
qualquer chamada ao adapter, valida fail-closed o próprio objeto de entrada, o adaptador (com a
mesma proteção contra getter/`Proxy` malicioso em `call` já usada em
`run-auditable-agent-attempt.ts`), `request`, `policy`, `promptVersion`, `model` e a lista inteira
de `responseIds` — exigindo exatamente `policy.maxAttempts` entradas, todas válidas e distintas,
na ordem fornecida, sem gerar, normalizar ou deduzir nenhum id. Na execução, chama
`runAuditableAgentAttempt` exatamente uma vez por tentativa e usa `decideAgentAttemptProgress`
após cada avaliação para decidir entre continuar, aceitar ou encerrar; uma nova tentativa só
acontece depois de uma avaliação `REJECTED`, e a sequência para imediatamente no primeiro
`ACCEPTED` ou quando as tentativas se esgotam. Se `runAuditableAgentAttempt` lançar — falha
anterior à existência de qualquer captura —, o erro sanitizado se propaga imediatamente e nenhuma
nova tentativa é feita. O resultado devolvido é imutável e fechado: `ACCEPTED` carrega todas as
avaliações realizadas mais a avaliação aceita; `ATTEMPTS_EXHAUSTED` carrega todas as avaliações
realizadas (todas `REJECTED`) mais os códigos fechados na mesma ordem.

Nenhum contrato público de `runAuditableAgentAttempt`, `runSingleAgentAttempt`,
`decideAgentAttemptProgress` ou `AgentRetryPolicy` foi alterado. `StubAgentAdapter` não foi
ampliado; os testes usam um adaptador sequencial local e determinístico
(`SequentialAdapter`), definido apenas em `tests/run-bounded-agent-attempts.test.ts`.

### Arquivos alterados

- `src/agent/run-bounded-agent-attempts.ts` (novo — `runBoundedAgentAttempts` e seus tipos)
- `tests/run-bounded-agent-attempts.test.ts` (novo — suíte completa)
- `README.md` (nova entrada na lista de arquivos e seção "Tentativas auditáveis limitadas em
  sequência")
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes obrigatórios cobertos

- aceita na primeira tentativa e não consome as demais respostas/ids (uma única chamada);
- rejeita uma vez e aceita na segunda, com exatamente duas chamadas;
- esgota políticas de 1, 2 e 3 tentativas sem exceder o limite, em cada caso;
- preserva avaliações, capturas brutas, `responseId`, ordem e códigos alinhados entre si;
- nunca tenta novamente após exceção do adaptador (mensagem sanitizada, sem vazar segredo) ou
  resposta não-string, em ambos os casos com exatamente uma chamada;
- toda a entrada — incluindo todos os `responseIds` — é validada antes da primeira chamada
  (`responseId` inválido no fim da lista falha sem nenhuma chamada; objeto de entrada `null`/array
  também falha);
- `responseIds` ausentes/extras/duplicados/inválidos (branco, vazio, não-string, caractere de
  controle)/forjados (não-array, array-like) falham fechado, sempre sem chamar o adapter;
- política forjada (fora de `[1,3]`, `null`), `AgentRequest` inválido, adaptador `null`/sem
  `call`/com getter ou `Proxy` malicioso em `call` (sem vazar segredo, lido uma única vez),
  `promptVersion`/`model` inválidos: todos falham fechado sem chamar o adapter;
- resultado, lista de avaliações e lista de `rejectionCodes` são congelados (`Object.isFrozen`)
  tanto em `ACCEPTED` quanto em `ATTEMPTS_EXHAUSTED`; `responseIds` e `AgentRequest` de entrada
  não são mutados;
- mesmo adaptador sequencial determinístico e mesma entrada produzem resultado campo a campo
  idêntico (comparação via `JSON.stringify`/`JSON.parse`), inclusive quando há um atraso real
  entre as duas execuções;
- nenhuma chamada após `ACCEPTED` e nenhuma quarta chamada sob qualquer entrada testada;
- ausência de timer, delay, backoff, timeout, relógio, aleatoriedade, HTTP, SDK, variável de
  ambiente, persistência e I/O — nenhum destes é importado ou usado no módulo;
- toda a suíte anterior continua verde.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **818 testes, 818 passaram, 0 falharam** (785 anteriores + 33 novos), ambiente local Node.js 22 |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR.

### Limitações conhecidas

Nenhuma além das já documentadas nas entregas anteriores de `src/agent`. Esta tarefa não
introduz `StubAgentAdapter` estendido, coordenador multiagente, HOLD final, persistência,
logs externos, provider de mercado, integração Astra real, ordem, fill, Risk Manager,
PaperBroker, ledger, banco, dashboard, cloud, HTTP, SDK externo, fila, timer, relógio,
aleatoriedade, variável de ambiente, token, segredo, credencial, wallet, blockchain, testnet,
corretora ou dinheiro real — nada disso estava no escopo de TASK-030.

### Decisões pendentes para André / revisor

Nenhuma nova.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: executa tentativas auditaveis limitadas`
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI.

## TASK-031 — finaliza tentativas com hold seguro

- **Status reportado:** entrega executada, aguardando revisão do ChatGPT/GPT-5.6 Sol e de André
  (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

Criado `src/agent/finalize-bounded-agent-attempts.ts`, definindo `finalizeBoundedAgentAttempts`: a
menor transformação pura e offline que converte o `BoundedAgentAttemptsResult` já produzido por
`runBoundedAgentAttempts` (`./run-bounded-agent-attempts.ts`) no resultado final seguro de um
agente para um ciclo:

```text
ACCEPTED           → ACCEPTED (proposta aceita preservada, sem alteração)
ATTEMPTS_EXHAUSTED → HOLD (razão fechada: ATTEMPTS_EXHAUSTED)
```

Esta função apenas representa uma decisão já tomada pelo laço de retry; não chama
`AgentAdapter`, `RiskManager` ou `Broker`, não executa retry, não toca carteira/ledger e não tem
relógio, aleatoriedade, rede, SDK, variável de ambiente ou persistência de qualquer tipo. `HOLD` é
o substituto seguro e auditável explícito para "nenhuma proposta pôde ser confiada" — nunca
fabrica `AgentProposal`, preço, posição, confiança ou evidência.

`value` nunca é confiado apenas por seu tipo declarado: todo campo lido é revalidado fail-closed
em runtime, inclusive uma união inteiramente forjada. Cada avaliação é recomputada do zero a
partir da sua própria `capture`, via `evaluateAgentResponseCapture`
(`./evaluate-agent-response-capture.ts`), e o `status`/`code`/`proposal` declarados — e, em
`ACCEPTED`, o `result` de nível superior — precisam bater exatamente com essa recomputação, sem
propriedade extra ou faltante (inclusive uma presente apenas com valor `undefined`). Uma união
`ATTEMPTS_EXHAUSTED` declarada não pode conter uma avaliação `ACCEPTED`; uma união `ACCEPTED`
declarada não pode conter uma avaliação `ACCEPTED` em posição diferente da última, e seu `result`
precisa bater exatamente com essa última avaliação. `evaluations` precisa ter entre uma e
`MAX_AGENT_RETRY_ATTEMPTS` entradas — nunca vazia, nunca acima do que a política jamais
permitiria.

Toda a revalidação roda dentro de uma única fronteira fail-closed: qualquer exceção lançada ao
ler ou recomputar um valor forjado — inclusive uma lançada por uma trap de `Proxy` ou getter
lançador aninhado em qualquer profundidade, já sendo um `ContractValidationError` ou não — é
convertida, na borda deste módulo, num `ContractValidationError` sanitizado, sem payload,
mensagem, stack ou causa da exceção original. Isso fecha inclusive o vetor em que
`captureAgentResponse` (`./capture-agent-response.ts`) lê `request`/`responseId`/`rawResponse`/
`promptVersion`/`model` por acesso direto de propriedade (sem `readProperty`): um `capture`
forjado, agora aceito de uma fonte externa e potencialmente adversária, poderia antes lançar um
segredo bruto por essa via.

Reutiliza `evaluateAgentResponseCapture` para a recomputação e `MIN_AGENT_RETRY_ATTEMPTS`/
`MAX_AGENT_RETRY_ATTEMPTS` (`./retry-policy.ts`) para o limite de entradas, em vez de duplicar a
lógica de nenhum dos dois módulos. Nenhum contrato público de `runBoundedAgentAttempts`,
`evaluateAgentResponseCapture` ou `AgentRetryPolicy` foi alterado. `StubAgentAdapter` não foi
tocado.

### Arquivos alterados

- `src/agent/finalize-bounded-agent-attempts.ts` (novo — `finalizeBoundedAgentAttempts` e seus
  tipos)
- `tests/finalize-bounded-agent-attempts.test.ts` (novo — suíte completa)
- `README.md` (nova entrada na lista de arquivos e atualização da frase de M4)
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes obrigatórios cobertos

- converte `ACCEPTED` preservando proposta, captura, histórico e ordem, na primeira tentativa e
  após rejeições;
- converte `ATTEMPTS_EXHAUSTED` em `HOLD` com razão fechada `ATTEMPTS_EXHAUSTED` e códigos
  alinhados, para 1, 2 e 3 rejeições;
- nunca fabrica `AgentProposal`, preço, posição, confiança ou evidência no ramo `HOLD` (o tipo
  `FinalizedHoldAgentAttempts` não tem `result`, e suas avaliações nunca têm `proposal`);
- resultado e listas retornadas são congelados (`Object.isFrozen`) em ambos os ramos;
- entrada não é mutada em nenhum dos dois ramos;
- rejeita união adulterada: status inválido, entrada `null`/array, resultado aceito divergente
  (capture diferente ou proposta alterada), avaliação `ACCEPTED` dentro do ramo
  `ATTEMPTS_EXHAUSTED`, código divergente (no `rejectionCodes` de nível superior ou numa entrada
  individual), lista de avaliações vazia ou acima do limite de três (em ambos os ramos), avaliação
  `ACCEPTED` fora da última posição, e `result` que não corresponde à última avaliação
  efetivamente aceita;
- rejeita propriedade extra e faltante no objeto de nível superior e em cada entrada de
  avaliação, inclusive quando presente com valor `undefined`, e propriedade extra numa proposta;
- getters e `Proxy` forjados no `status`, em `evaluations` (incluindo um `Proxy` sobre um array
  real), em `result`, na `capture` de uma entrada e num campo interno de uma `capture` (`responseId`)
  falham com `ContractValidationError` sanitizado, sem vazar o segredo lançado;
- mesma entrada válida produz resultado campo a campo idêntico, em `ACCEPTED` e em `HOLD`;
- nenhuma chamada a adapter, retry, timer, relógio, aleatoriedade, HTTP, SDK, ambiente,
  persistência ou I/O — verificado inclusive substituindo `Date.now`, `Math.random`,
  `setTimeout` e `fetch` por versões que lançam;
- toda a suíte anterior continua verde.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **864 testes, 864 passaram, 0 falharam** (823 anteriores + 41 novos), ambiente local Node.js |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR.

### Limitações conhecidas

Nenhuma além das já documentadas nas entregas anteriores de `src/agent`. Esta tarefa não executa
tentativa, não cria coordenador multiagente, Risk Manager, `PaperBroker`, fill, carteira, ledger,
persistência, logs externos, provider de mercado, integração Astra real, timeout, backoff ou
agendamento — nada disso estava no escopo de TASK-031. A conversão de qualquer exceção
não-`ContractValidationError` (por exemplo, uma vinda de um getter/`Proxy` forjado em qualquer
profundidade dentro de `value`) num `ContractValidationError` genérico, na borda de
`finalizeBoundedAgentAttempts`, é intencional e documentada no cabeçalho do módulo: garante que
nenhum segredo escape, ao custo de uma mensagem de erro menos específica nesses casos forjados —
nunca nos casos de estrutura genuinamente inválida, que continuam recebendo mensagens específicas
por campo.

### Decisões pendentes para André / revisor

Nenhuma nova.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: finaliza tentativas com hold seguro`
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI.

## TASK-030 — correção 1/3 da revisão `REQUEST_CHANGES` (PR #57, SHA `55b55bd`)

- **Status reportado:** correção executada, aguardando nova revisão do ChatGPT/GPT-5.6 Sol e de
  André (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

Corrigidos os dois bloqueios apontados na revisão `REQUEST_CHANGES` de André no PR #57 sobre o
SHA `55b55bd987eb4bc16dbc39b7a7f495d9838c0bf2`, sem ampliar o escopo de TASK-030 e sem alterar
nenhuma mensagem pública já existente:

1. **Entradas forjadas (`Proxy`/getters) agora falham fechado sem vazar segredo, em
   `src/agent/run-bounded-agent-attempts.ts`.** Toda leitura de propriedade do objeto de entrada
   caller-supplied (`adapter`, `request`, `policy`, `responseIds`, `promptVersion`, `model`) passa
   por `readProperty`, que trata qualquer exceção de um getter/trap `Proxy` exatamente como
   propriedade ausente (`undefined`), nunca relançando o valor original. `requireResponseIds` foi
   reescrita para não usar mais `for...of` (que invocaria `Symbol.iterator`, outro vetor de fuga em
   um `Proxy` forjado): agora lê `length` e cada índice individualmente via `readProperty`, de modo
   que um `Proxy` sobre um array real — que passa em `Array.isArray` mas pode lançar em `length`,
   num elemento ou no iterador — também falha fechado com o mesmo `ContractValidationError`
   sanitizado que uma entrada ausente/ inválida já produzia, sem nenhuma chamada ao adapter.
2. **Duplicação material removida.** `requireInputObject`, `requireBoundedText`, `requireAdapter` e
   a leitura protegida de `call` (antes `readAdapterCall`, agora generalizada em `readProperty`)
   passaram a viver em um único módulo interno,
   `src/agent/internal/attempt-input-validation.ts` (não exportado fora de `src/agent`, sem
   contrato público próprio), importado tanto por `run-auditable-agent-attempt.ts` quanto por
   `run-bounded-agent-attempts.ts`. As mensagens de erro de cada contrato (`RunAuditableAgentAttempt`,
   `RunBoundedAgentAttempts`, `RunSingleAgentAttempt` via `runAuditableAgentAttemptAs`) permanecem
   byte a byte as mesmas; `runAuditableAgentAttempt` continua sendo a única fronteira de chamada e
   avaliação do adapter.

### Arquivos alterados

- `src/agent/internal/attempt-input-validation.ts` (novo — `readProperty`, `requireInputObject`,
  `requireBoundedText`, `requireAdapter` compartilhados)
- `src/agent/run-auditable-agent-attempt.ts` (passa a importar os helpers compartilhados; nenhuma
  mudança de comportamento ou de mensagem)
- `src/agent/run-bounded-agent-attempts.ts` (importa os helpers compartilhados; leituras de
  `source.*` e de `responseIds` protegidas contra getter/`Proxy` forjado)
- `tests/run-bounded-agent-attempts.test.ts` (dois novos testes de regressão)
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes de regressão adicionados

- getter forjado no campo `policy` do próprio objeto de entrada: lança um segredo ao ser lido: a
  chamada falha com `ContractValidationError` sanitizado (mensagem não contém o segredo), o getter
  é lido exatamente uma vez e o adapter nunca é chamado;
- `Proxy` sobre um array real de `responseIds` cujo trap `get` lança um segredo para qualquer
  propriedade lida (`length`, índice ou `Symbol.iterator`): a chamada falha com
  `ContractValidationError` sanitizado e o adapter nunca é chamado.

Ambos reproduzem exatamente os dois cenários apontados na revisão de André.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **820 testes, 820 passaram, 0 falharam**, ambiente local Node.js 22 |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR.

### Limitações conhecidas

Nenhuma além das já documentadas na entrega original de TASK-030. Esta correção não altera o
contrato público de `runAuditableAgentAttempt`, `runSingleAgentAttempt`,
`decideAgentAttemptProgress` ou `AgentRetryPolicy`, não amplia `StubAgentAdapter` e não introduz
rede, persistência, credencial ou rota financeira.

### Decisões pendentes para André / revisor

Nenhuma nova.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** conforme instrução do comentário `@claude` no PR #57.
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI.

## TASK-030 — correção 2/3 da revisão `REQUEST_CHANGES` (PR #57, SHA `2788699`)

- **Status reportado:** correção executada, aguardando nova revisão do ChatGPT/GPT-5.6 Sol e de
  André (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

Corrigida a rota equivalente de fail-closed apontada na revisão `REQUEST_CHANGES` de André no PR
#57 sobre o SHA `27886994c1e2678e59f2b4fa8faaa4e801a5d6cb`, sem ampliar o escopo de TASK-030 e sem
alterar nenhuma mensagem pública já existente:

1. **`request` e `policy` forjados agora falham fechado também nas próprias leituras internas.**
   `runBoundedAgentAttempts` já protegia a leitura de `source.request`/`source.policy` no objeto de
   entrada externo com `readProperty`, mas entregava o valor lido diretamente a `parseAgentRequest`
   e `parseAgentRetryPolicy`, que liam `schemaVersion`/`agentId`/`cycleId`/`snapshotId` e
   `maxAttempts` por acesso direto de propriedade. Um `Proxy`/getter forjado dentro de `request` ou
   `policy` conseguia lançar um segredo que escapava bruto antes de qualquer chamada ao adapter.
   `parseAgentRequest` (`src/agent/agent-adapter.ts`) e `parseAgentRetryPolicy`
   (`src/agent/retry-policy.ts`) agora leem cada um desses campos por `readProperty`
   (`src/agent/internal/attempt-input-validation.ts`, já compartilhado pelas duas fronteiras de
   tentativa), então uma exceção do getter é tratada exatamente como campo ausente — a mesma
   mensagem `ContractValidationError` que já existia para um campo ausente/ inválido, nunca o
   segredo lançado.
2. **`runAuditableAgentAttemptAs` agora protege as leituras do seu próprio objeto público.** As
   leituras de `source.adapter`, `source.request`, `source.responseId`, `source.promptVersion` e
   `source.model` passaram de acesso direto para `readProperty`, fechando o mesmo vetor de fuga
   quando `runAuditableAgentAttempt`/`runSingleAgentAttempt` é chamado diretamente com um objeto de
   entrada forjado, e não só através de `runBoundedAgentAttempts`.

Nenhuma mensagem de erro pública mudou: um campo ausente ou forjado continua produzindo
exatamente o `ContractValidationError` que o campo ausente já produzia antes desta correção.

### Arquivos alterados

- `src/agent/agent-adapter.ts` (`parseAgentRequest` lê `schemaVersion`/`agentId`/`cycleId`/
  `snapshotId` via `readProperty` compartilhado)
- `src/agent/retry-policy.ts` (`parseAgentRetryPolicy` lê `maxAttempts` via `readProperty`
  compartilhado)
- `src/agent/run-auditable-agent-attempt.ts` (`runAuditableAgentAttemptAs` lê `adapter`, `request`,
  `responseId`, `promptVersion` e `model` via `readProperty`)
- `src/agent/internal/attempt-input-validation.ts` (docstring atualizada: `readProperty` agora
  também é usado por `agent-adapter.ts` e `retry-policy.ts`; nenhuma mudança de comportamento)
- `tests/run-bounded-agent-attempts.test.ts` (dois novos testes de regressão)
- `tests/run-auditable-agent-attempt.test.ts` (um novo teste de regressão)
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes de regressão adicionados

- getter forjado em `request.agentId`, lançando um segredo: `runBoundedAgentAttempts` falha com
  `ContractValidationError` sanitizado, o getter é lido exatamente uma vez e o adapter nunca é
  chamado;
- getter forjado em `policy.maxAttempts`, lançando um segredo: `runBoundedAgentAttempts` falha com
  `ContractValidationError` sanitizado, o getter é lido exatamente uma vez e o adapter nunca é
  chamado;
- getter forjado em `responseId`, campo do objeto de entrada público de `runAuditableAgentAttempt`,
  lançando um segredo: a chamada falha com `ContractValidationError` sanitizado, o getter é lido
  exatamente uma vez e o adapter nunca é chamado.

Os três reproduzem exatamente os três cenários apontados na revisão de André.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **823 testes, 823 passaram, 0 falharam**, ambiente local Node.js |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR.

### Limitações conhecidas

Nenhuma além das já documentadas na entrega original de TASK-030 e na correção 1/3. Esta correção
não altera o contrato público de `runAuditableAgentAttempt`, `runSingleAgentAttempt`,
`decideAgentAttemptProgress`, `AgentRetryPolicy` ou `parseAgentRequest`/`parseAgentRetryPolicy`, não
amplia `StubAgentAdapter` e não introduz rede, persistência, credencial ou rota financeira. A
sugestão adicional da revisão ("considere ainda `Array.isArray` sobre proxy revogado") não foi
implementada nesta correção: o comentário de acionamento de André listou explicitamente apenas os
três itens acima e pediu para não ampliar o escopo.

### Decisões pendentes para André / revisor

Nenhuma nova, exceto confirmar se a consideração sobre `Array.isArray`/proxy revogado (mencionada
na revisão, mas não incluída no pedido de correção) deve virar uma futura tarefa própria.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** conforme instrução do comentário `@claude` no PR #57.
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI.

## TASK-031 — correção 1/3 da revisão `REQUEST_CHANGES` (PR #59, SHA `08072b9`)

- **Status reportado:** correção executada, aguardando nova revisão do ChatGPT/GPT-5.6 Sol e de
  André (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

Corrigidos os três bloqueios apontados na revisão `REQUEST_CHANGES` de André no PR #59 sobre o
SHA `08072b946b72078b89ef2d0679f083134fb991e3`, em `src/agent/finalize-bounded-agent-attempts.ts`,
sem ampliar o escopo de TASK-031 e sem alterar nenhuma mensagem pública já existente:

1. **`ContractValidationError` lançado por um `Proxy`/getter hostil não é mais confiado cegamente.**
   `requireExactOwnKeys` chamava `Object.keys(value)` diretamente e `proposalMatches` chamava
   `Object.keys(declared)`/`evidenceIds.every(...)` diretamente — nenhuma dessas três leituras
   passava por `readProperty`/`readSafe`. Um `Proxy` cuja trap `ownKeys` (ou cujo trap `get`
   acessado durante o `.every`) lançasse deliberadamente `new ContractValidationError(...)` com um
   segredo escapava sem sanitização: a fronteira externa reconhece `instanceof
   ContractValidationError` e relança a mensagem original, confiando na classe da exceção mesmo
   quando ela se origina de dado hostil. As três leituras agora passam por operações protegidas
   (`safeOwnKeys`/`hasExactOwnKeys`, que nunca relançam o que a trap lançar, convertendo qualquer
   exceção — inclusive um `ContractValidationError` forjado — no mesmo `ContractValidationError`
   fixo e seguro que a estrutura genuinamente incompatível já produzia) e `evidenceIdsMatch`, que lê
   cada índice via `readSafe`.
2. **`requireExactOwnKeys` agora usa `Reflect.ownKeys` em vez de `Object.keys`.** `Object.keys`
   ignora propriedades próprias não enumeráveis e símbolos, então uma entrada podia carregar uma
   propriedade extra oculta dessa forma e ainda ser aceita como união exatamente fechada.
   `safeOwnKeys`/`hasExactOwnKeys` (compartilhado agora por `requireExactOwnKeys` e por
   `proposalMatches`) usam `Reflect.ownKeys`, que enumera toda chave própria — enumerável ou não,
   string ou `Symbol` — e rejeitam qualquer extra desse tipo tanto no objeto de nível superior/
   entrada de avaliação quanto na proposta declarada.
3. **`proposalMatches` não usa mais `evidenceIds.every` para comparar `evidenceIds`.** Um array
   esparso com o mesmo `length` do esperado passava porque `.every` pula posições vazias
   silenciosamente, tratando a ausência de um id exigido como aprovação vácua. A nova função
   `evidenceIdsMatch` compara por índice via `readSafe`, onde um buraco (ou uma leitura que lança)
   é tratado exatamente como `undefined`, que nunca é igual a um id de evidência real.

Como efeito colateral direto dessas três correções, `proposalMatches` também passou a ler todos os
demais campos do `proposal` declarado (`schemaVersion`, `proposalId`, `action`, etc.) via
`readSafe` em vez de acesso direto de propriedade, fechando o último ponto deste módulo em que um
getter/`Proxy` hostil dentro do `proposal` declarado poderia lançar sem sanitização.

### Arquivos alterados

- `src/agent/finalize-bounded-agent-attempts.ts` (`safeOwnKeys`, `hasExactOwnKeys`,
  `evidenceIdsMatch` novos; `requireExactOwnKeys` e `proposalMatches` reescritos sobre eles)
- `tests/finalize-bounded-agent-attempts.test.ts` (sete novos testes de regressão)
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes de regressão adicionados

- `Proxy` hostil cuja trap `ownKeys` no objeto de nível superior lança um `ContractValidationError`
  contendo um segredo: a chamada falha com um `ContractValidationError` sanitizado (mensagem sem o
  segredo);
- o mesmo ataque, agora na trap `ownKeys` de um `proposal` declarado dentro do resultado aceito;
- `Proxy` hostil sobre `evidenceIds` cuja trap `get` lança um `ContractValidationError` contendo um
  segredo para qualquer índice: mesma sanitização;
- união de nível superior com propriedade extra não enumerável: rejeitada;
- união de nível superior com propriedade extra por `Symbol`: rejeitada;
- `proposal` declarado com propriedade extra não enumerável: rejeitado;
- `evidenceIds` esparso (mesmo `length` do esperado, mas com buraco no lugar de um id exigido):
  rejeitado.

Os três primeiros reproduzem exatamente o cenário do bloqueio 1 (incluindo a variante em que o
próprio `ContractValidationError` é a arma); os dois seguintes reproduzem o bloqueio 2; o último
reproduz o bloqueio 3. Cada um falha na versão anterior do código e passa após a correção.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **871 testes, 871 passaram, 0 falharam** (864 anteriores + 7 novos), ambiente local Node.js |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR.

### Limitações conhecidas

Nenhuma além das já documentadas na entrega original de TASK-031. Esta correção não altera o
contrato público de `finalizeBoundedAgentAttempts`, `runBoundedAgentAttempts` ou
`evaluateAgentResponseCapture`, não amplia `StubAgentAdapter` e não introduz rede, persistência,
credencial ou rota financeira. Nenhuma mensagem de erro pública mudou para estruturas
genuinamente inválidas (não forjadas via `Proxy`/getter): elas continuam recebendo as mesmas
mensagens específicas por campo de antes desta correção.

### Decisões pendentes para André / revisor

Nenhuma nova.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** conforme instrução do comentário `@claude` no PR #59.
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI.

## TASK-031 — correção 2/3 da revisão `REQUEST_CHANGES` (PR #59, SHA `5f917e6`)

- **Status reportado:** correção executada, aguardando nova revisão do ChatGPT/GPT-5.6 Sol e de
  André (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

Corrigido o bloqueio 2/3 apontado por André na revisão `REQUEST_CHANGES` do PR #59 sobre o SHA
`5f917e6175791e8aa6f577e523c765ad4e5a54f9`, em `src/agent/finalize-bounded-agent-attempts.ts`,
sem ampliar o escopo de TASK-031, sem alterar `captureAgentResponse` e sem alterar nenhuma
mensagem pública já existente para estruturas genuinamente inválidas (não forjadas).

**A rota profunda de vazamento:** `recomputeDeclaredEvaluation` entregava a `capture` declarada
diretamente a `evaluateAgentResponseCapture`, que a repassa a `captureAgentResponse`
(`src/agent/capture-agent-response.ts`). Esse módulo lê `source.request`, `source.responseId`,
`source.rawResponse`, `source.promptVersion` e `source.model` por acesso direto de propriedade —
por design, já que sua própria fronteira confia no chamador imediato. Como o chamador de
`finalizeBoundedAgentAttempts` não é confiável, uma `capture` declarada com um getter/`Proxy`
lançando deliberadamente `new ContractValidationError(...)` com um segredo em qualquer um desses
cinco campos chegava ao `catch` externo de `finalizeBoundedAgentAttempts`, era reconhecida por
`instanceof ContractValidationError` e era relançada sem sanitização — vazando o segredo pela
borda pública da função.

**Correção:** nova função `sanitizeCaptureCandidate`, chamada em `recomputeDeclaredEvaluation`
antes de `evaluateAgentResponseCapture`. Para um `value` que seja objeto (não array, não nulo),
ela lê cada um dos cinco campos de nível superior (`request`, `responseId`, `rawResponse`,
`promptVersion`, `model`) através de `readSafe` — que já existia neste módulo e nunca relança o
que uma leitura lançar — e monta um objeto simples novo, totalmente controlado por este módulo,
com esses cinco valores. Uma leitura que lance qualquer coisa (incluindo um
`ContractValidationError` forjado com segredo) vira `undefined` nesse objeto simples, que
`captureAgentResponse` já rejeita do mesmo jeito que rejeitaria o campo genuinamente ausente — com
a mesma mensagem específica de sempre, sem nada do valor original lançado. Um `value` que não seja
objeto (ou que seja array) passa inalterado, preservando exatamente a checagem "deve ser um objeto
JSON" que `captureAgentResponse` já fazia. Os campos próprios de `request` não precisam de proteção
adicional aqui: `parseAgentRequest` já lê cada um deles via `readProperty`
(`src/agent/agent-adapter.ts`), que tem a mesma garantia de não relançar.

### Arquivos alterados

- `src/agent/finalize-bounded-agent-attempts.ts` (`sanitizeCaptureCandidate` novo;
  `recomputeDeclaredEvaluation` passa a sanitizar a `capture` declarada antes de recomputar)
- `tests/finalize-bounded-agent-attempts.test.ts` (dois novos testes de regressão)
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes de regressão adicionados

- getter profundo em `capture.responseId` lançando `ContractValidationError` contendo um segredo:
  sanitizado (mensagem final sem o segredo);
- getter profundo em `capture.request` lançando `ContractValidationError` contendo um segredo:
  sanitizado.

Ambos falham na versão anterior do código (SHA `5f917e6`) — verifiquei revertendo localmente só a
lógica de `sanitizeCaptureCandidate` para um passthrough antes de rodar a suíte, confirmando que os
dois novos testes falham exatamente como o bloqueio 2/3 descreve, e voltam a passar com a correção
restaurada — e passam após a correção.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **873 testes, 873 passaram, 0 falharam** (871 anteriores + 2 novos), ambiente local Node.js |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR.

### Limitações conhecidas

Nenhuma além das já documentadas nas entregas anteriores de TASK-031. Esta correção não altera o
contrato público de `finalizeBoundedAgentAttempts`, `evaluateAgentResponseCapture` ou
`captureAgentResponse` (não modificado, conforme pedido pela própria revisão), não amplia
`StubAgentAdapter` e não introduz rede, persistência, credencial ou rota financeira.

### Decisões pendentes para André / revisor

Nenhuma nova.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** conforme instrução do comentário `@claude` no PR #59.
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI.

## TASK-032 — compõe ciclo offline finalizado de agente

- **Status reportado:** entrega executada, aguardando revisão do ChatGPT/GPT-5.6 Sol e de André
  (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

Criado `src/agent/run-finalized-agent-cycle.ts`, definindo `runFinalizedAgentCycle`: a menor
composição assíncrona e offline que fecha o ciclo de exatamente um agente encadeando as duas
primitivas já existentes e revisadas em TASK-030/TASK-031:

```text
RunBoundedAgentAttemptsRequest
→ runBoundedAgentAttempts (uma chamada)
→ finalizeBoundedAgentAttempts (uma chamada)
→ ACCEPTED | HOLD
```

A função recebe exatamente o mesmo contrato de entrada de `runBoundedAgentAttempts`
(`RunBoundedAgentAttemptsRequest`, reexportado sem alteração), chama `runBoundedAgentAttempts`
exatamente uma vez, entrega o `BoundedAgentAttemptsResult` retornado diretamente a
`finalizeBoundedAgentAttempts` — sem remodelar, copiar, reinterpretar ou enriquecer nenhum campo
— exatamente uma vez, e devolve a união `FinalizedBoundedAgentAttemptsResult` resultante sem
alteração. `ACCEPTED` é preservado integralmente; `ATTEMPTS_EXHAUSTED` só vira `HOLD` através do
finalizador já existente. Nenhuma validação, captura, decisão de progresso, retry ou lógica de
finalização foi duplicada — cada responsabilidade continua vivendo em exatamente um módulo
(`run-auditable-agent-attempt.ts`, `decide-agent-attempt-progress.ts`,
`run-bounded-agent-attempts.ts` e `finalize-bounded-agent-attempts.ts`).

Se `runBoundedAgentAttempts` lançar — uma falha anterior a qualquer captura válida —, o erro já
sanitizado por esse módulo se propaga imediatamente e `finalizeBoundedAgentAttempts` nunca chega
a ser chamado; nenhuma tentativa adicional é feita. A própria composição não introduz nenhum
`try`/`catch`, então nenhuma mensagem, stack ou payload é reembalado ou alterado nesse caminho.
`runFinalizedAgentCycle` não gera id, timestamp, mensagem, proposta ou qualquer outro dado
implícito, e não altera o contrato público de nenhum dos dois módulos que compõe.

Não cria coordenador multiagente, agregação, votação, handoff, Risk Manager, `PaperBroker`, fill,
carteira, ledger, persistência, provider de mercado, integração Astra real, timeout, backoff ou
agendamento. Não usa HTTP, SDK externo, fila, timer, relógio, aleatoriedade, variável de
ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora ou dinheiro real.
`StubAgentAdapter` não foi tocado; os testes usam apenas adapters stub locais e determinísticos
definidos no próprio arquivo de teste (`SequentialAdapter`, `ThrowingAdapter`), no mesmo padrão já
usado por `tests/run-bounded-agent-attempts.test.ts`.

### Arquivos alterados

- `src/agent/run-finalized-agent-cycle.ts` (novo — `runFinalizedAgentCycle` e reexportação dos
  tipos `RunBoundedAgentAttemptsRequest`/`FinalizedBoundedAgentAttemptsResult`)
- `tests/run-finalized-agent-cycle.test.ts` (novo — suíte completa)
- `README.md` (nova entrada na lista de arquivos, atualização da frase de M4 e nova seção "Ciclo
  offline finalizado de um agente")
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes obrigatórios cobertos

- rejeição seguida de aceitação devolve `ACCEPTED`, preservando capturas, proposta, ordem e ids;
- esgotamento com 1, 2 e 3 tentativas devolve `HOLD` com razão `ATTEMPTS_EXHAUSTED` e códigos
  fechados na ordem;
- o adapter é chamado exatamente o número necessário de vezes e nunca após aceitação (mesmo com
  ids/respostas extras disponíveis) ou após uma falha lançada;
- cada `responseId` explícito é usado uma vez e na ordem fornecida, refletido em
  `evaluation.capture.responseId` de cada tentativa;
- entrada `null`/array, `responseIds` insuficientes, `responseIds` duplicados, adapter `null` e um
  `Proxy` forjado sobre `responseIds` falham antes da primeira chamada ao adapter;
- uma exceção lançada pelo adapter, e uma resposta bruta que não é `string`, permanecem
  sanitizadas (sem vazar segredo) e não iniciam nova tentativa — exatamente uma chamada ao
  adapter em ambos os casos;
- resultado e suas listas (`evaluations`/`rejectionCodes`) permanecem congelados em `ACCEPTED` e
  em `HOLD`;
- `responseIds` e o `AgentRequest` de entrada não são mutados;
- mesmos dados determinísticos produzem resultado campo a campo idêntico, em `ACCEPTED` e em
  `HOLD`, inclusive com tempo decorrido real entre chamadas (`setTimeout` apenas para medir, nunca
  consultado pela função);
- nenhuma duplicação de proposta, captura, validação, retry ou finalização: verificado comparando
  o resultado de `runFinalizedAgentCycle` byte a byte com o resultado de chamar
  `runBoundedAgentAttempts` seguido de `finalizeBoundedAgentAttempts` manualmente, para `ACCEPTED`
  e para `HOLD`;
- nenhuma chamada a timer, relógio, aleatoriedade, HTTP, SDK, ambiente, persistência, Risk
  Manager, broker ou I/O — a própria composição não contém nenhuma dessas chamadas, apenas dois
  `await`/chamadas diretas;
- toda a suíte anterior (873 testes antes desta tarefa, incluindo TASK-030/TASK-031) continua
  verde.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **897 testes, 897 passaram, 0 falharam** (873 anteriores + 24 novos), ambiente local Node.js |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR.

### Limitações conhecidas

Nenhuma além das já documentadas nas entregas anteriores de `src/agent`. Esta tarefa não executa
tentativa própria, não cria coordenador multiagente, Risk Manager, `PaperBroker`, fill, carteira,
ledger, persistência, logs externos, provider de mercado, integração Astra real, timeout, backoff
ou agendamento — nada disso estava no escopo de TASK-032. `runFinalizedAgentCycle` não adiciona
nenhuma fronteira de sanitização própria: a sanitização de exceções continua sendo
responsabilidade exclusiva de `runBoundedAgentAttempts` (para falhas antes de qualquer captura) e
de `finalizeBoundedAgentAttempts` (para uma união forjada), como já documentado nos relatórios de
TASK-030 e TASK-031.

Este sandbox de execução não teve acesso de rede para `git fetch origin main`; a sincronização foi
verificada confirmando que a branch de trabalho já estava nivelada com o `main` local fornecido no
checkout inicial (mesmo hash de commit em ambos), sem alterações remotas pendentes a incorporar.

### Decisões pendentes para André / revisor

Nenhuma nova.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: compõe ciclo offline finalizado de agente`
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI. O status desta tarefa em `TASK.md` não foi alterado por mim.

## TASK-033 — executa lote offline de ciclos finalizados

- **Status reportado:** entrega executada, aguardando revisão do ChatGPT/GPT-5.6 Sol e de André
  (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

Criado `src/agent/run-finalized-agent-cycles.ts`, definindo `runFinalizedAgentCycles`: a menor
composição assíncrona e offline que executa, em ordem, um lote não vazio de ciclos individuais
já finalizados por `runFinalizedAgentCycle` (TASK-032), isolando a falha de um item num código
fechado sem impedir os demais:

```text
readonly FinalizedAgentCycleBatchItem[]
→ runFinalizedAgentCycle (uma vez por item, em ordem)
→ COMPLETED | FAILED por item
→ readonly FinalizedAgentCycleBatchResult[]
```

Cada item do lote é `{ itemId, request }`: `itemId` é uma string explícita, não vazia,
limitada e única dentro do lote — nunca gerada ou normalizada — e `request` é exatamente o
contrato existente de `runFinalizedAgentCycle` (`RunBoundedAgentAttemptsRequest`, reexportado
sem alteração). Um resultado `COMPLETED` preserva `itemId` e o `FinalizedBoundedAgentAttemptsResult`
retornado por `runFinalizedAgentCycle` sem remodelá-lo. Um resultado `FAILED` preserva somente
`itemId` e o código fechado `AGENT_CYCLE_FAILED` — nunca mensagem, stack, payload ou objeto de
erro. `FinalizedAgentCycleBatchResults` é sempre uma lista congelada, na mesma ordem e com o
mesmo tamanho do lote de entrada.

A estrutura inteira do lote é validada de forma fail-closed antes de qualquer chamada a
adapter: `value` deve ser um array real, não vazio e denso (`length` mais cada índice
correspondem exatamente às próprias chaves próprias do array, via `Reflect.ownKeys` — um buraco,
ou uma propriedade extra, não enumerável ou `Symbol` no próprio array, falha aqui); cada item
deve ser um objeto com exatamente `itemId` e `request`, sem propriedade extra, não enumerável ou
`Symbol`; e cada `itemId` deve ser único, verificado na ordem recebida. `request` não é
revalidado neste módulo — essa responsabilidade continua exclusiva de `runFinalizedAgentCycle` e
de tudo que ele chama (`runBoundedAgentAttempts`, `finalizeBoundedAgentAttempts` e o que está
abaixo deles), para não duplicar validação de request, retry ou finalização.

Toda leitura do lote não confiável — `length`, cada índice, as chaves de cada item e o próprio
`itemId` — passa por `readProperty` e por uma verificação local de chaves exatas baseada em
`Reflect.ownKeys` (mesmo padrão já usado em `finalize-bounded-agent-attempts.ts`), então um
getter ou `Proxy` hostil, inclusive um que lança um `ContractValidationError` forjado carregando
um segredo, nunca escapa: é tratado exatamente como valor ausente antes mesmo de chegar a
qualquer `catch`. A validação inteira ainda está envolvida por um `try/catch` de defesa em
profundidade que converte qualquer exceção que não seja um `ContractValidationError` genuíno
numa mensagem constante e sem segredo.

Depois da validação estrutural, os itens são executados sequencialmente, na ordem recebida —
nunca em paralelo —, chamando `runFinalizedAgentCycle` exatamente uma vez por item. Uma
rejeição de qualquer item — já sanitizada por `runFinalizedAgentCycle` e por tudo abaixo dele —
nunca é inspecionada, interpolada ou propagada: vira exatamente `{ itemId, status: "FAILED",
code: "AGENT_CYCLE_FAILED" }`, e o lote continua para o próximo item. Uma falha nunca vira
`COMPLETED`, `ACCEPTED` ou `HOLD`.

Não cria agregação, votação, consenso, handoff, seleção de proposta, contexto compartilhado,
concorrência/paralelismo, Risk Manager, `PaperBroker`, fill, carteira, ledger, persistência,
provider de mercado, integração Astra real, timeout, backoff ou agendamento. Não usa HTTP, SDK
externo, fila, timer, relógio, aleatoriedade, variável de ambiente, token, segredo, credencial,
wallet, blockchain, testnet, corretora ou dinheiro real. `StubAgentAdapter` não foi tocado; os
testes usam apenas adapters stub locais e determinísticos definidos no próprio arquivo de teste
(`SequentialAdapter`, `ThrowingAdapter` e um `TrackingAdapter` local para verificar ordem de
chamadas), no mesmo padrão já usado por `tests/run-finalized-agent-cycle.test.ts`.

### Arquivos alterados

- `src/agent/run-finalized-agent-cycles.ts` (novo — `runFinalizedAgentCycles` e os tipos
  `FinalizedAgentCycleBatchItem`/`FinalizedAgentCycleBatchItems`/`FinalizedAgentCycleBatchResult`/
  `FinalizedAgentCycleBatchResults`)
- `tests/run-finalized-agent-cycles.test.ts` (novo — suíte completa)
- `README.md` (nova entrada na lista de arquivos, atualização da frase de M4 e nova seção "Lote
  offline de ciclos finalizados")
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes obrigatórios cobertos

- lote com um item aceito devolve um `COMPLETED/ACCEPTED`;
- lote com um item esgotado devolve um `COMPLETED/HOLD`;
- lote com três itens preserva ordem, `itemId` e resultados individuais;
- cada ciclo e cada adapter são chamados exatamente uma vez, sequencialmente e na ordem
  recebida, sem duplicação;
- uma falha (erro lançado pelo adapter, e uma `request` hostil cuja leitura de propriedade
  lança) num item produz `FAILED/AGENT_CYCLE_FAILED` e os itens seguintes ainda executam;
- nenhuma mensagem, stack, segredo ou payload do erro aparece no resultado (verificado via
  `JSON.stringify` do resultado inteiro);
- entrada `null`, array vazio, array esparso, item inválido (não objeto), `itemId` duplicado e
  `itemId` vazio/em branco falham antes da primeira chamada a adapter;
- propriedades extras — enumeráveis, não enumeráveis e `Symbol` — em um item e no próprio array
  do lote falham fechadas antes da primeira chamada a adapter;
- getters e `Proxy` que lançam em `length`, num índice, nas chaves (`Reflect.ownKeys`) e no
  próprio `itemId` — inclusive lançando um `ContractValidationError` forjado com um segredo
  embutido — não vazam o segredo e falham fechados;
- resultados, a lista de resultados e cada item ficam congelados (`Object.isFrozen`);
- o lote de entrada e seus itens não são mutados;
- mesmos stubs e dados determinísticos produzem uma lista de resultados campo a campo idêntica,
  inclusive com tempo decorrido real entre chamadas (`setTimeout` apenas para medir, nunca
  consultado pela função);
- nenhuma chamada a timer, relógio, aleatoriedade, HTTP, SDK, ambiente, persistência, Risk
  Manager, broker ou I/O — a própria composição não contém nenhuma dessas chamadas;
- toda a suíte anterior (897 testes antes desta tarefa) continua verde.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **922 testes, 922 passaram, 0 falharam** (897 anteriores + 25 novos), ambiente local Node.js |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR.

### Limitações conhecidas

Nenhuma além das já documentadas nas entregas anteriores de `src/agent`. Esta tarefa não cria
agregação, votação, consenso, handoff, seleção de proposta, contexto compartilhado,
concorrência/paralelismo, Risk Manager, `PaperBroker`, fill, carteira, ledger, persistência,
provider de mercado, integração Astra real, timeout, backoff ou agendamento — nada disso estava
no escopo de TASK-033. `runFinalizedAgentCycles` não adiciona nenhuma fronteira de sanitização
própria para o conteúdo de cada `request`: a validação e a sanitização de cada ciclo individual
continuam sendo responsabilidade exclusiva de `runFinalizedAgentCycle` e de tudo que ele chama,
como já documentado no relatório de TASK-032. A execução é estritamente sequencial (nunca
concorrente), conforme exigido pelo escopo exato da tarefa.

Este sandbox de execução não teve acesso de rede para `git fetch origin main`; a sincronização
foi verificada confirmando que a branch de trabalho já estava nivelada com o `main` local
fornecido no checkout inicial (mesmo hash de commit em ambos, `f11c92a`), sem alterações remotas
pendentes a incorporar.

### Decisões pendentes para André / revisor

Nenhuma nova.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: executa lote offline de ciclos finalizados`
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI. O status desta tarefa em `TASK.md` não foi alterado por mim.

## TASK-033 — correção 1/3 da revisão `CHANGES_REQUESTED` (PR #63, SHA `2b1257c1bf33bc1671880f9ed96c78933c2e5c9d`)

- **Status reportado:** correção executada, aguardando revisão do ChatGPT/GPT-5.6 Sol e de André
  (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

A revisão de André apontou um risco de exaustão de memória/CPU em `requireBatchItems`
(`src/agent/run-finalized-agent-cycles.ts`) antes da rejeição fail-closed: a checagem de
"array denso sem propriedades extras" construía `expectedKeys` com
`Array.from({ length }, (_unused, index) => String(index))`, alocando e iterando uma lista
proporcional ao `length` declarado pela entrada não confiável — lido de `value.length` — antes
de examinar as chaves reais do array via `Reflect.ownKeys`. Um array real esparso com `.length`
grande (dentro do limite de `2^32 - 1` de um array real) ou um `Proxy` de array cujo trap `get`
reporte um `length` grande faziam essa alocação ocorrer mesmo quando o array possuía, na
prática, poucas chaves próprias — um vetor de negação de serviço.

Corrigido substituindo `Array.from({ length }, ...)` + `hasExactOwnKeys` por uma nova função
dedicada, `hasExactDenseArrayKeys(value, length)`:

1. lê `Reflect.ownKeys(value)` uma única vez (via `safeOwnKeys`, já existente, que trata
   qualquer exceção do trap `ownKeys` — incluindo um `ContractValidationError` forjado
   carregando segredo — exatamente como lista vazia, sem nunca relançar);
2. rejeita imediatamente quando a cardinalidade dessa lista não é `length + 1` — sem alocar
   nem iterar nada proporcional ao `length` declarado, apenas ao número real de chaves
   próprias que o alvo relatou;
3. somente depois de confirmada a cardinalidade — quando `length` já está limitado pelo número
   real de chaves — percorre essa mesma lista (agora de tamanho `length + 1`) verificando que
   cada chave que não é `"length"` é o índice canônico de um inteiro em `[0, length)`
   (`isCanonicalArrayIndex`, nova função auxiliar) e acumulando os índices vistos em um
   `Set`. Como chaves próprias são sempre distintas, `length` índices canônicos distintos em
   `[0, length)` só podem ser exatamente `0..length-1` — não é necessária uma segunda lista de
   índices esperados para provar isso.

Nenhum limite de segurança fixo foi introduzido: a validação continua aceitando qualquer
`length` seguro (`Number.isSafeInteger`) cuja cardinalidade real de chaves bata exatamente, e
rejeita fechado qualquer coisa fora disso — sem depender de um teto arbitrário que pudesse ser
confundido com a quantidade funcional de agentes do lote. `hasExactOwnKeys` (conjunto fixo de
duas chaves, `itemId`/`request`) permanece intocada e é usada apenas na validação por item, onde
nunca houve alocação proporcional a uma entrada não confiável.

### Arquivos alterados

- `src/agent/run-finalized-agent-cycles.ts` (`hasExactDenseArrayKeys` e `isCanonicalArrayIndex`
  substituem a construção de `expectedKeys` proporcional a `length`; `requireBatchItems` passa a
  chamar `hasExactDenseArrayKeys`)
- `tests/run-finalized-agent-cycles.test.ts` (três novos testes de regressão)
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes obrigatórios cobertos

- lote com um array real esparso cujo `.length` é ajustado para `4_000_000_000` (dentro do
  limite de um array real) mas cujas chaves próprias reais continuam sendo apenas `"0"` e
  `"length"`: rejeitado antes de qualquer chamada a adapter, e em menos de 500ms — prova de que
  a rejeição não escala com o `length` declarado;
- lote com um `Proxy` de array cujo trap `get` reporta `length: 4_000_000_000` (sem lançar) mas
  cujas chaves próprias reais (via `Reflect.ownKeys` no alvo real) continuam pequenas: mesma
  rejeição, mesmo adapter nunca chamado, mesmo limite de tempo;
- `Reflect.ownKeys` no próprio array do lote (não apenas em um item) lançando um
  `ContractValidationError` forjado carregando segredo: rejeição sanitizada, sem o segredo na
  mensagem — cobertura nova para o caminho que este `hasExactDenseArrayKeys` agora percorre;
- toda a suíte de testes obrigatória de TASK-033 listada no relatório original continua
  passando sem alteração de comportamento (mesmos `COMPLETED`/`FAILED`, ordem, `itemId`,
  congelamento, ausência de mutação, ausência de vazamento de segredo);
- suíte completa permanece verde: `npm run typecheck` sem erros; `npm test` **925 testes, 925
  passaram, 0 falharam** (922 anteriores + 3 novos), ambiente local Node.js 22.23.2.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **925 testes, 925 passaram, 0 falharam** |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR (estava `action_required` no
momento da revisão).

### Limitações conhecidas

Mesmas da entrega original de TASK-033; nenhuma nova introduzida por esta correção. Como antes,
este sandbox de execução não teve acesso de rede para `git fetch origin main`; a branch de
trabalho já estava sincronizada com o `main` local fornecido no checkout inicial, sem alterações
remotas pendentes a incorporar.

### Decisões pendentes para André / revisor

Nenhuma nova.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** ajuste solicitado via comentário do PR #63 (correção 1/3 da revisão
  `CHANGES_REQUESTED`), sem alterar `TASK.md` nem o status de TASK-033.
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI.

## TASK-034 — resume lote offline de ciclos finalizados

- **Status reportado:** entrega executada, aguardando revisão do ChatGPT/GPT-5.6 Sol e de André
  (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

Criado `src/agent/summarize-finalized-agent-cycles.ts`, definindo `summarizeFinalizedAgentCycles`:
a menor transformação pura, síncrona e offline que resume o resultado já finalizado de um lote
não vazio (`FinalizedAgentCycleBatchResults`, produzido por `runFinalizedAgentCycles`, TASK-033)
em contagens e listas ordenadas de `itemId`:

```text
FinalizedAgentCycleBatchResults
→ summarizeFinalizedAgentCycles
→ total + ACCEPTED + HOLD + FAILED
```

`FinalizedAgentCyclesSummary` é uma interface fechada e o valor retornado é sempre congelado,
com exatamente `total`, `acceptedCount`, `holdCount`, `failedCount`, `acceptedItemIds`,
`holdItemIds` e `failedItemIds` — cada lista de `itemId` também congelada e preservando a ordem
original do lote. O resumo serve só para observabilidade e auditoria: não classifica agentes,
não compara desempenho, não vota, não escolhe proposta e não altera nenhum resultado.

A estrutura pública inteira é revalidada de forma fail-closed em runtime, antes de qualquer
classificação, sem confiar no tipo declarado em TypeScript: o lote deve ser um array real, não
vazio e denso (mesma verificação de cardinalidade de `Reflect.ownKeys` contra `length + 1` já
usada e corrigida em TASK-033, sem alocação ou iteração proporcional a um `length` declarado não
confiável); cada item deve ter exatamente `itemId`/`status`/`result` quando `status` é
`COMPLETED`, ou exatamente `itemId`/`status`/`code` quando `status` é `FAILED` — nenhuma
propriedade extra, não enumerável ou `Symbol` em nenhum dos dois casos, e `code` deve ser
exatamente o valor fechado `AGENT_CYCLE_FAILED`; cada `itemId` deve ser uma string não vazia,
limitada e única dentro do lote inteiro, verificada na ordem recebida.

O `result` de um item `COMPLETED` é lido só o suficiente para distinguir `ACCEPTED` de `HOLD` e
confirmar que carrega exatamente o conjunto fechado de propriedades que esse resultado permite
(`status`/`evaluations`/`result` para `ACCEPTED`; `status`/`reason`/`evaluations`/`rejectionCodes`
para `HOLD`) — nunca recalculado a partir da captura, nunca comparado campo a campo com uma
reconstrução, e nenhum dos seus valores (evaluations, proposta, rejectionCodes) é copiado para o
resumo. Isso é deliberado: assim como `runFinalizedAgentCycles` deixa `request` sem validação
profunda no seu próprio limite porque essa responsabilidade já pertence a
`runFinalizedAgentCycle`, este módulo deixa o conteúdo interno de `result` sem revalidação
profunda porque essa responsabilidade já pertence a `finalizeBoundedAgentAttempts` — recalculá-lo
aqui duplicaria exatamente a validação que a tarefa proíbe.

Toda leitura do lote não confiável — `length`, cada índice, as chaves de cada item, do próprio
`itemId`, do `status`, do `code` e do `result` aninhado — passa por `readProperty` e por uma
verificação local de chaves exatas baseada em `Reflect.ownKeys` (mesmo padrão já usado em
`run-finalized-agent-cycles.ts` e `finalize-bounded-agent-attempts.ts`, duplicado localmente
neste módulo seguindo o mesmo precedente de não compartilhamento dessas primitivas privadas entre
módulos de `src/agent`), então um getter ou `Proxy` hostil, inclusive um que lança um
`ContractValidationError` forjado carregando um segredo, nunca escapa: é tratado exatamente como
valor ausente antes mesmo de chegar a qualquer `catch`. A validação inteira ainda está envolvida
por um `try/catch` de defesa em profundidade que converte qualquer exceção que não seja um
`ContractValidationError` genuíno numa mensagem constante e sem segredo.

Não cria ranking, pontuação, comparação de desempenho, agregação de propostas, votação, consenso,
handoff, seleção de vencedor, retry, Risk Manager, `PaperBroker`, fill, carteira, ledger,
persistência, provider de mercado ou integração Astra real. Não chama adapter, retry, finalizador,
timer, relógio, aleatoriedade, HTTP, SDK, variável de ambiente, token, segredo, credencial,
wallet, blockchain, testnet ou corretora.

### Arquivos alterados

- `src/agent/summarize-finalized-agent-cycles.ts` (novo — `summarizeFinalizedAgentCycles` e o
  tipo `FinalizedAgentCyclesSummary`)
- `tests/summarize-finalized-agent-cycles.test.ts` (novo — suíte completa, 36 testes)
- `README.md` (nova entrada na lista de arquivos, atualização da frase de M4 e nova seção
  "Resumo offline de lote finalizado")
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes obrigatórios cobertos

- lote misto real (construído de ponta a ponta via `runFinalizedAgentCycles`) com `ACCEPTED`,
  `HOLD` e `FAILED` produz contagens exatas;
- as três listas de `itemId` preservam a ordem original do lote;
- cada item aparece em exatamente uma lista e `acceptedCount + holdCount + failedCount` é sempre
  igual a `total`;
- lotes contendo somente uma das três categorias (`ACCEPTED`, `HOLD` ou `FAILED`) funcionam;
- `itemId` duplicado, `status`/`código` incompatível (status desconhecido, `code` diferente de
  `AGENT_CYCLE_FAILED`, `result.status` diferente de `ACCEPTED`/`HOLD`), item com união
  adulterada (`result` e `code` simultâneos), array vazio, array esparso e `itemId` vazio/em
  branco falham fechados;
- propriedades extras enumeráveis, não enumeráveis e `Symbol` — em um item, no `result` aninhado
  e no próprio array do lote — falham fechadas;
- getter/`Proxy` hostil em `length`, `Reflect.ownKeys` do lote, `itemId`, `status`, `code` e no
  `result` aninhado (incluindo `Reflect.ownKeys` do próprio `result`), inclusive lançando um
  `ContractValidationError` forjado carregando um segredo, não vazam o segredo e falham fechados;
- array real esparso e `Proxy` de array reportando `.length` de quatro bilhões são rejeitados sem
  alocação ou iteração proporcional ao comprimento declarado, em menos de 500ms;
- o resumo retornado e as três listas de `itemId` ficam congelados (`Object.isFrozen`);
- um lote de entrada simples (não congelado) não é mutado;
- mesmos dados produzem um resumo campo a campo idêntico, inclusive entre duas execuções
  independentes de `runFinalizedAgentCycles` com o mesmo lote de especificação;
- resumir um lote já finalizado nunca chama novamente o adapter de nenhum item (contagem de
  chamadas do adapter verificada antes e depois de `summarizeFinalizedAgentCycles`);
- nenhuma chamada a adapter, retry, finalizador, timer, relógio, aleatoriedade, HTTP, SDK,
  ambiente, persistência, Risk Manager, broker ou I/O — a própria transformação não contém
  nenhuma dessas chamadas nem as importa;
- toda a suíte anterior (925 testes antes desta tarefa) continua verde.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **961 testes, 961 passaram, 0 falharam** (925 anteriores + 36 novos), ambiente local Node.js |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR.

### Limitações conhecidas

Nenhuma além das já documentadas nas entregas anteriores de `src/agent`. Esta tarefa não cria
ranking, pontuação, comparação de desempenho, agregação de propostas, votação, consenso, handoff,
seleção de vencedor, retry, Risk Manager, `PaperBroker`, fill, carteira, ledger, persistência,
provider de mercado ou integração Astra real — nada disso estava no escopo de TASK-034.
`summarizeFinalizedAgentCycles` não recalcula tentativas nem resultados: o `result` de um item
`COMPLETED` é revalidado só na profundidade necessária para classificá-lo (`status` e o conjunto
fechado de chaves de primeiro nível), nunca reconstruído a partir de `evaluations`/capturas como
`finalizeBoundedAgentAttempts` já faz — duplicar essa reconstrução aqui estava explicitamente fora
do escopo da tarefa.

Este sandbox de execução não teve acesso de rede para `git fetch origin main` (o comando exigiu
aprovação indisponível neste ambiente não interativo); a sincronização foi verificada confirmando
que a branch de trabalho (`claude/issue-64-20260921-1441`) já estava com a árvore de trabalho
limpa e nivelada com `main` no checkout inicial fornecido pela automação, sem alterações remotas
pendentes a incorporar.

### Decisões pendentes para André / revisor

Nenhuma nova.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `feat: resume lote offline de ciclos finalizados`
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI. O status desta tarefa em `TASK.md` não foi alterado por mim.

## TASK-034 — correção solicitada na revisão (ciclo 1/3) do PR #65

- **Status reportado:** correção executada, aguardando nova revisão do ChatGPT/GPT-5.6 Sol e de
  André (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

André (`andreholmo`) solicitou, na revisão do PR #65 sobre o commit `f358bc3`, correção porque a
revalidação do `result` aninhado em `classifyCompletedResult` (`src/agent/summarize-finalized-agent-cycles.ts`)
verificava apenas o discriminante `status` e o conjunto fechado de chaves de primeiro nível, mas
aceitava valores incompatíveis dentro de cada braço da união — três casos citados explicitamente
na revisão eram aceitos e contados indevidamente antes desta correção:

- `HOLD` com `reason: "QUALQUER_COISA"` em vez do único valor fechado `ATTEMPTS_EXHAUSTED`;
- `HOLD` com `evaluations: null` e `rejectionCodes: null` em vez de arrays;
- `ACCEPTED` com `evaluations: null` e `result: null` em vez de array/objeto JSON.

A correção acrescenta, em `classifyCompletedResult`, checagens rasas adicionais depois da
checagem de chaves exatas já existente — sem recomputar tentativas, evaluations ou proposta, e
sem inspecionar o conteúdo interno de `evaluations`/`rejectionCodes`/`result`, exatamente como a
tarefa original exige:

- para `HOLD`: `reason` deve ser exatamente `"ATTEMPTS_EXHAUSTED"`; `evaluations` e
  `rejectionCodes` devem ser arrays (`Array.isArray`, nunca `null` ou outro tipo);
- para `ACCEPTED`: `evaluations` deve ser um array; `result` deve ser um objeto JSON não nulo e
  não array.

Duas funções auxiliares novas foram adicionadas: `safeIsArray` (envolve `Array.isArray` em
`try/catch`, porque a checagem pode lançar sobre um `Proxy` revogado — tratada exatamente como
"não é array", nunca relançada) e `isJsonObject` (objeto não nulo e não array). Ambas seguem o
mesmo padrão fail-closed de `safeOwnKeys`/`hasExactOwnKeys` já presentes no módulo. Nenhuma outra
função foi alterada; a sanitização de getters/`Proxy` via `readProperty` já existente cobre as
novas leituras sem necessidade de mudança.

### Arquivos alterados

- `src/agent/summarize-finalized-agent-cycles.ts` (`classifyCompletedResult` reforçado com
  checagens de tipo/valor para `reason`, `evaluations`, `rejectionCodes` e `result`; novas funções
  `safeIsArray` e `isJsonObject`; constante `HOLD_RESULT_REASON`; comentários atualizados)
- `tests/summarize-finalized-agent-cycles.test.ts` (5 novos testes de regressão cobrindo
  exatamente os três casos citados na revisão, mais duas variações correlatas)
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes de regressão adicionados

- rejeita item `COMPLETED/HOLD` cujo `reason` não é o valor fechado `ATTEMPTS_EXHAUSTED`;
- rejeita item `COMPLETED/HOLD` cujos `evaluations`/`rejectionCodes` são `null` em vez de arrays;
- rejeita item `COMPLETED/ACCEPTED` cujos `evaluations`/`result` são `null`;
- rejeita item `COMPLETED/ACCEPTED` cujo `result` é um array em vez de objeto JSON;
- rejeita item `COMPLETED/ACCEPTED` cujo `evaluations` é um objeto em vez de array.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **966 testes, 966 passaram, 0 falharam** (961 anteriores + 5 novos), ambiente local Node.js |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR — estava em `action_required`
no momento da revisão, conforme observado por André.

### Limitações conhecidas

Escopo permanece totalmente offline e sem recomputação: as checagens acrescentadas são
estritamente mais rasas que a revalidação de `finalizeBoundedAgentAttempts` — nunca inspecionam o
conteúdo de `evaluations`, `rejectionCodes` ou de `result`, apenas confirmam que cada campo
obrigatório tem o tipo/valor básico que seu próprio braço fechado da união exige. Nenhuma
propriedade adicional, ranking, Risk Manager, `PaperBroker`, rede, credencial ou rota financeira
real foi introduzida.

Este sandbox de execução não teve acesso de rede para `git fetch origin main` (o comando exigiu
aprovação indisponível neste ambiente não interativo); a branch de trabalho
(`claude/issue-64-20260921-1441`) já estava com a árvore de trabalho limpa no checkout inicial
fornecido pela automação, sem alterações remotas pendentes a incorporar.

### Decisões pendentes para André / revisor

Nenhuma nova.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `fix: revalida tipos dos campos do result no resumo de ciclos finalizados`
- **Hash:** `8db34537eba453951dc75ef461e4e0713d73146c`

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI. O status desta tarefa em `TASK.md` não foi alterado por mim.

## TASK-034 — correção solicitada na revisão (ciclo 2/3) do PR #65

- **Status reportado:** correção executada, aguardando nova revisão do ChatGPT/GPT-5.6 Sol e de
  André (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

André (`andreholmo`) solicitou, no ciclo 2/3 da revisão do PR #65 (após os três casos do ciclo 1/3
já corrigidos), nova correção porque `classifyCompletedResult`
(`src/agent/summarize-finalized-agent-cycles.ts`) ainda aceitava resultados que
`finalizeBoundedAgentAttempts` jamais poderia ter produzido. O próprio fixture sintético
`completedAccepted` do arquivo de testes — `{ status: "ACCEPTED", evaluations: [], result: {} }`
— era aceito e contado; da mesma forma, um `HOLD` com `evaluations`/`rejectionCodes` vazios,
esparsos ou com propriedades extras também passava, embora `finalizeBoundedAgentAttempts` sempre
produza entre 1 e 3 avaliações, cada uma com uma união interna fechada.

A correção acrescenta, ainda sem recomputar tentativas nem chamar `evaluateAgentResponseCapture`,
validação estrutural mais profunda em `classifyCompletedResult`:

- `evaluations` (em ambos os desfechos) deve ser um array denso — sem buraco nem propriedade
  extra enumerável, não enumerável ou `Symbol` — com entre 1 e `MAX_AGENT_RETRY_ATTEMPTS` (3)
  entradas, reaproveitando `MIN_AGENT_RETRY_ATTEMPTS`/`MAX_AGENT_RETRY_ATTEMPTS` de
  `retry-policy.ts`;
- cada entrada de `evaluations` deve ser um objeto JSON com exatamente o conjunto fechado de
  chaves do seu próprio `status` — `REJECTED`: `status`/`capture`/`code`, `ACCEPTED`:
  `status`/`capture`/`proposal` — com `capture` (e, quando `ACCEPTED`, `proposal`) pelo menos um
  objeto JSON, e `code` (quando `REJECTED`) um dos valores fechados de `AgentResponseRejectionCode`
  (reaproveitado de `evaluate-agent-response-capture.ts`, sem duplicar o array);
- `ACCEPTED.result` deve ter a mesma forma fechada de uma avaliação `ACCEPTED`
  (`status`/`capture`/`proposal`, com `status` exatamente `"ACCEPTED"`);
- toda entrada de `HOLD.evaluations` deve ser `REJECTED`-shaped — nenhuma entrada
  `ACCEPTED`-shaped é aceita dentro de um `HOLD`;
- `HOLD.rejectionCodes` deve ser um array denso — mesma checagem de "sem propriedade extra" — cujo
  comprimento e ordem coincidem exatamente com os `code`s próprios já declarados em cada entrada de
  `evaluations` (comparação estrutural entre os dois campos já lidos, nunca recomputada a partir de
  uma `capture`).

Isso fecha o bypass relatado sem duplicar a recomputação de `finalizeBoundedAgentAttempts`:
`capture` e `proposal` continuam sendo lidos apenas como "objeto JSON", nunca inspecionados campo a
campo, e `evaluateAgentResponseCapture` nunca é chamado por este módulo.

Como os fixtures sintéticos `completedAccepted`/`completedHold` do arquivo de testes usavam
exatamente a estrutura vazia agora rejeitada, ambos foram reescritos para uma estrutura
genuinamente possível (uma entrada de `evaluations` fechada por discriminante, com `capture`/
`proposal` sintéticos e `rejectionCodes` coerentes), conforme pedido explicitamente na revisão.

### Arquivos alterados

- `src/agent/summarize-finalized-agent-cycles.ts` (`classifyCompletedResult` reescrito para
  validar estruturalmente `evaluations`/`result`/`rejectionCodes`; novas funções
  `requireDenseArrayEntries`, `requireEvaluationEntries`, `requireEvaluationEntryShape`,
  `isKnownRejectionCode`; novas constantes `REJECTED_EVALUATION_KEYS`/`ACCEPTED_EVALUATION_KEYS`;
  reaproveita `MIN_AGENT_RETRY_ATTEMPTS`/`MAX_AGENT_RETRY_ATTEMPTS` de `retry-policy.ts` e
  `AGENT_RESPONSE_REJECTION_CODES` de `evaluate-agent-response-capture.ts`; comentário de módulo
  atualizado)
- `tests/summarize-finalized-agent-cycles.test.ts` (fixtures `completedAccepted`/`completedHold`
  reescritas para uma estrutura genuinamente possível; 14 novos testes de regressão estruturais;
  um teste existente ajustado para continuar exercitando seu cenário original com `evaluations`
  válido)
- `docs/coordination/CLAUDE_REPORT.md` (este registro)

### Testes de regressão adicionados

- rejeita `ACCEPTED` com `evaluations` vazio (o bypass relatado pelo fixture `completedAccepted`);
- rejeita `HOLD` com `evaluations`/`rejectionCodes` vazios (o bypass relatado);
- rejeita `evaluations` com mais de 3 entradas;
- rejeita `evaluations` esparso;
- rejeita `evaluations` com propriedade extra não enumerável;
- rejeita `rejectionCodes` com propriedade extra `Symbol`;
- rejeita entrada de `evaluations` com propriedade extra;
- rejeita entrada `REJECTED` com `code` fora do conjunto fechado;
- rejeita `HOLD.evaluations` contendo uma entrada `ACCEPTED`-shaped;
- rejeita `ACCEPTED.result` com a forma `REJECTED` em vez de `ACCEPTED`;
- rejeita `ACCEPTED.result` sem `proposal`;
- rejeita `rejectionCodes` cujo comprimento não bate com `evaluations`;
- rejeita `rejectionCodes` cuja ordem não bate com os `code`s declarados;
- aceita `HOLD` no limite máximo de 3 avaliações (caso positivo, garante que o limite superior não
  rejeita incorretamente).

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **980 testes, 980 passaram, 0 falharam** (966 anteriores + 14 novos), ambiente local Node.js |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR.

### Limitações conhecidas

A validação continua estritamente mais rasa que a recomputação de `finalizeBoundedAgentAttempts`:
`capture` e `proposal` nunca têm seus campos internos lidos ou comparados, e nada aqui confirma que
uma `capture` genuinamente produziu o `proposal`/`code` ao lado dela — apenas que a forma é
interna e mutuamente consistente e fechada. Isso é intencional: este módulo nunca recalcula uma
tentativa ou um resultado. Nenhuma propriedade adicional, ranking, Risk Manager, `PaperBroker`,
rede, credencial ou rota financeira real foi introduzida.

Este sandbox de execução não teve acesso de rede para `git fetch origin main` (o comando exigiu
aprovação indisponível neste ambiente não interativo); a branch de trabalho
(`claude/issue-64-20260921-1441`) já estava com a árvore de trabalho limpa no checkout inicial,
sem alterações remotas pendentes a incorporar.

### Decisões pendentes para André / revisor

Nenhuma nova.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `fix: valida estruturalmente evaluations, result e rejectionCodes no resumo de ciclos finalizados`
- **Hash:** `06596680c8c6e6ecb8a954117e1b94320f01ae6f`

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI. O status desta tarefa em `TASK.md` não foi alterado por mim.

## TASK-034 — correção solicitada na revisão (ciclo 3/3, último) do PR #65

- **Status reportado:** correção executada, aguardando nova revisão do ChatGPT/GPT-5.6 Sol e de
  André (não aprovada por mim)
- **Data:** 2026-09-21

### Resumo

André (`andreholmo`) solicitou, no ciclo 3/3 — o último permitido — da revisão do PR #65 (após os
casos dos ciclos 1/3 e 2/3 já corrigidos), a correção final porque o braço `ACCEPTED` de
`classifyCompletedResult` (`src/agent/summarize-finalized-agent-cycles.ts`) ainda aceitava estados
que `finalizeBoundedAgentAttempts` jamais poderia ter produzido:

- `evaluations` inteiramente `REJECTED` com um `result` separado de forma `ACCEPTED`;
- uma avaliação `ACCEPTED` antes da última posição, ou mais de uma avaliação `ACCEPTED`;
- `result` de forma `ACCEPTED` que não correspondia à última avaliação aceita;
- `capture`/`proposal` vazios ou adulterados, pois bastava serem objetos JSON para passar.

A correção, ainda sem recomputar tentativas nem chamar `evaluateAgentResponseCapture`,
`captureAgentResponse` ou `parseAgentProposal`, acrescenta a `classifyCompletedResult` (braço
`ACCEPTED`):

- apenas a última entrada de `evaluations` pode ser `ACCEPTED`-shaped — qualquer entrada
  `ACCEPTED`-shaped antes da última posição falha fechado, o que cobre tanto uma avaliação aceita
  antecipada quanto mais de uma avaliação aceita (duplicada);
- a última entrada deve existir e ser `ACCEPTED`-shaped — uma sequência inteiramente `REJECTED`
  falha fechado, mesmo que `result` isoladamente pareça válido;
- `result` deve ser `ACCEPTED`-shaped e idêntico, campo a campo, à `capture`/`proposal` dessa
  última entrada — comparação estrutural entre dois valores já validados por forma neste mesmo
  limite, nunca uma recomputação a partir de uma `capture`.

Três novas funções (`requireClosedRequestShape`, `requireClosedCaptureShape`,
`requireClosedProposalShape`) validam a forma pública fechada de `request`/`capture`/`proposal` —
exatamente as chaves próprias de `AgentRequest`/`AgentResponseCapture`/`AgentProposal`, com
`schemaVersion` fechado em `1`, `action` num dos valores fechados de `PROPOSAL_ACTIONS` e
`evidenceIds` um array denso de strings sem propriedade extra (enumerável, não enumerável ou
`Symbol`) — em vez do antigo `isJsonObject` isolado, fechando o bypass de `capture`/`proposal`
vazios ou adulterados. `requireEvaluationEntryShape` agora retorna esses campos já validados (em
vez de só o discriminante `"ACCEPTED" | "REJECTED"`), reaproveitados tanto pela comparação
`result`/última-avaliação em `ACCEPTED` quanto pela extração de `code` em `HOLD` (sem reler
`entry.code` cru). `rawResponse`/`request` continuam sem terem o próprio conteúdo interpretado —
apenas comparados como string/campos opacos, nunca decodificados ou reavaliados.

### Arquivos alterados

- `src/agent/summarize-finalized-agent-cycles.ts` (`classifyCompletedResult` — braço `ACCEPTED`
  reescrito para exigir só-a-última-avaliação-aceita e `result` idêntico campo a campo à última
  avaliação; `requireEvaluationEntryShape` retorna a forma validada de `capture`/`code`/`proposal`
  em vez de só o discriminante; novas funções `requireClosedRequestShape`,
  `requireClosedCaptureShape`, `requireClosedProposalShape`, `requireClosedEvidenceIds`,
  `requireNonEmptyString` e as comparações estruturais `requestFieldsEqual`, `captureFieldsEqual`,
  `evidenceIdsEqual`, `proposalFieldsEqual`, `acceptedEvaluationShapesMatch`; novas constantes
  `REQUEST_KEYS`/`CAPTURE_KEYS`/`PROPOSAL_KEYS`; reaproveita `PROPOSAL_ACTIONS` de
  `src/domain/contracts.ts`; comentários de módulo atualizados)
- `tests/summarize-finalized-agent-cycles.test.ts` (fixtures sintéticas `syntheticCapture`/
  `syntheticProposalValue`/`acceptedEvaluationEntry`/`rejectedEvaluationEntry` reescritas para uma
  estrutura `AgentRequest`/`AgentResponseCapture`/`AgentProposal` genuinamente possível,
  reaproveitando os builders `request`/`proposal` já existentes no arquivo; 12 novos testes de
  regressão)
- `docs/coordination/CLAUDE_REPORT.md` (este registro)
- `README.md` (parágrafo do resumo offline de lote finalizado atualizado para descrever as
  invariantes fechadas atuais de `evaluations`/`result`/`capture`/`proposal`)

### Testes de regressão adicionados

- rejeita `ACCEPTED` com `evaluations` inteiramente `REJECTED` e `result` separado de forma
  `ACCEPTED` (o bypass relatado no ciclo 3/3);
- rejeita `ACCEPTED` cuja única avaliação `ACCEPTED`-shaped está antes da última posição;
- rejeita `ACCEPTED` que declara duas avaliações `ACCEPTED`-shaped;
- rejeita `ACCEPTED` cujo `result` diverge da última avaliação aceita;
- aceita `ACCEPTED` cujo `result` corresponde à última avaliação aceita campo a campo (caso
  positivo);
- rejeita `ACCEPTED` cuja `capture` carrega propriedade extra;
- rejeita `ACCEPTED` cuja `capture.request` está com propriedade obrigatória ausente;
- rejeita `ACCEPTED` cuja `proposal.action` está fora do conjunto fechado;
- rejeita `ACCEPTED` cuja `proposal.evidenceIds` é esparso;
- rejeita `ACCEPTED` cuja `proposal.evidenceIds` carrega propriedade extra `Symbol`;
- rejeita `ACCEPTED` cuja `capture` está vazia;
- rejeita `ACCEPTED` cuja `proposal` está vazia.

### Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test`) | **992 testes, 992 passaram, 0 falharam** (980 anteriores + 12 novos) |

CI (`.github/workflows/ci.yml`) executa `npm ci`, `npm run typecheck` e `npm test` na matriz
Node.js 20/22; verificação final cabe à execução do workflow no PR.

### Limitações conhecidas

A validação continua estritamente mais rasa que a recomputação de `finalizeBoundedAgentAttempts`:
`rawResponse` nunca tem seu conteúdo decodificado/interpretado, e `request`/`proposal` nunca têm
suas regras de negócio (padrões de slug/identificador, limites de tamanho, a regra
`HOLD`→`positionPct === 0`) revalidadas — apenas a forma pública fechada e a igualdade campo a
campo entre dois valores já validados por forma dentro do mesmo lote. Nada aqui confirma que uma
`capture` genuinamente produziu o `proposal`/`code` ao lado dela, nem que um `rawResponse`
realmente decodifica para o `proposal` declarado. Isso é intencional: este módulo nunca recalcula
uma tentativa ou um resultado, responsabilidade que permanece de `finalizeBoundedAgentAttempts`.
Nenhuma propriedade adicional, ranking, Risk Manager, `PaperBroker`, rede, credencial ou rota
financeira real foi introduzida.

Este sandbox de execução não teve acesso de rede para `git fetch origin main` (o comando exigiu
aprovação indisponível neste ambiente não interativo); a branch de trabalho
(`claude/issue-64-20260921-1441`) já estava com a árvore de trabalho limpa no checkout inicial,
sem alterações remotas pendentes a incorporar.

### Decisões pendentes para André / revisor

Nenhuma nova. Este era o último ciclo de correção permitido pela revisão; caso ainda reste algum
problema estrutural após esta correção, a automação deve parar e escalar a André em vez de propor
uma quarta correção, conforme instruído.

### Bloqueios ou ambiguidades materiais

Nenhum bloqueio.

### Commit

- **Mensagem:** `fix: fecha invariantes estruturais restantes do braço ACCEPTED no resumo de ciclos finalizados`
- **Hash:** informado a André na resposta após o push.

Não aprovo nem mesclo o próprio trabalho. A aprovação e o merge cabem a André/ChatGPT após
revisão do diff e da CI. O status desta tarefa em `TASK.md` não foi alterado por mim.
