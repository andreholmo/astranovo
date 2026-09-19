# AstraNovo

Experimento de trading autônomo multiagente, **exclusivamente em paper trading**.

> ⚠️ **Paper-only.** Este repositório não contém wallet, chave privada, credencial,
> integração com corretora, testnet ou qualquer rota de execução financeira. Nada aqui
> movimenta dinheiro real. Sair dessa fronteira exige decisão explícita do proprietário,
> registrada em `docs/DECISIONS.md`.

## O que existe hoje

Milestones **M0 — Fundação e contratos**, **M1 — Carteira, ledger e PaperBroker**, a
primeira fatia de **M2 — Risk Manager determinístico**, a fachada determinística que
integra as duas, a liquidação contábil determinística do resultado dessa fachada no
ledger, e **M3 — valoração de patrimônio sem look-ahead, resumo determinístico da série
de patrimônio, resumo determinístico de custos de execução e o benchmark cash**.

- `src/domain/contracts.ts` — contratos centrais (`AgentConfig`, `MarketSnapshot`,
  `AgentProposal`, `OrderIntent`, `ExecutionPolicy`) com validação em runtime;
- `src/domain/errors.ts` — `ContractValidationError` e formatação segura de erro;
- `src/money/fixed-point.ts` — aritmética fixed-point em `bigint`, conversões e
  arredondamento — o único lugar onde uma divisão decide para que lado arredonda;
- `src/ledger/` — eventos imutáveis com id determinístico e ledger append-only idempotente;
- `src/portfolio/` — carteiras isoladas derivadas do ledger por replay;
- `src/broker/` — interface `Broker`, modelo de custos e `PaperBroker` determinístico;
- `src/risk/` — `RiskPolicy`, `RiskDecision` e o gate determinístico `evaluateRisk`,
  entre um `OrderIntent` validado e o `PaperBroker`;
- `src/execution/` — `executePaperOrderWithRisk`, a fachada pura que obriga a sequência
  `evaluateRisk → bloqueio OU PaperBroker.execute`, e `settlePaperExecution`, que registra
  o evento resultante no ledger e deriva a carteira;
- `src/metrics/value-wallet-at.ts` — `valueWalletAt`, a valoração determinística de
  patrimônio de uma carteira num instante, sem look-ahead;
- `src/metrics/summarize-equity-series.ts` — `summarizeEquitySeries`, o resumo
  determinístico de P&L final e drawdown absoluto de uma série de `EquityPoint`;
- `src/metrics/summarize-execution-costs.ts` — `summarizeExecutionCosts`, o resumo
  determinístico de fills, rejeições, fees e impacto de execução do ledger paper de
  um agente;
- `src/benchmark/build-cash-benchmark.ts` — `buildCashBenchmark`, o benchmark de
  controle que permanece integralmente em caixa;
- `src/config/load-agents.ts` — carregamento e validação da configuração de N agentes;
- `config/agents.json` — seis perfis de demonstração, cada um com US$100 fictícios;
- `tests/` — testes offline e determinísticos.

Ainda **não** existem: coleta de mercado, chamada de modelo, prompts, orquestrador
multiagente, perda diária/drawdown/cooldown/liquidez no Risk Manager, replay completo de
ciclos, drawdown percentual, win rate, P&L realizado por trade, benchmark buy-and-hold ou
outro benchmark além do cash, persistência em arquivo, servidor ou banco de dados. O
roadmap está em `docs/ROADMAP.md`.

## Requisitos

- Node.js 20 ou superior.

## Instalação

```bash
npm ci
```

## Build e testes

```bash
npm run typecheck   # TypeScript estrito, sem emitir
npm run build       # compila para dist/
npm test            # compila e roda a suíte com node --test
```

Os testes não acessam a rede e não dependem do relógio do sistema.

## Configuração dos agentes

A quantidade de agentes é configuração, não código. Para acrescentar um agente, basta
adicionar uma entrada em `config/agents.json`:

```json
{
  "id": "liquidity-aware",
  "name": "Liquidity Aware",
  "strategy": "liquidity-aware",
  "enabled": true,
  "initialBudgetUsd": 100,
  "mode": "optimized"
}
```

Regras aplicadas no carregamento: `id` e `strategy` são slugs minúsculos, `id` é único na
lista, `initialBudgetUsd` é finito e positivo, `mode` é `reference` ou `optimized`, e a
lista não pode ser vazia.

## Contratos e invariantes

- **`MarketSnapshot`** — `availableAt >= asOf`. Somente informação disponível até
  `availableAt` pode entrar em uma decisão; snapshots que violam isso são rejeitados na
  fronteira, não adiante no pipeline.
- **`AgentProposal`** — `HOLD` exige `positionPct = 0`; em `BUY`, `positionPct` é fração do
  caixa/equity elegível; em `SELL`, é fração da posição atual. `BUY` e `SELL` com fração
  zero são rejeitados por ambiguidade. `confidence` é informativo e nunca relaxa uma regra
  de risco.
- Timestamps são UTC ISO-8601 canônicos com milissegundos (`2026-09-17T18:00:00.000Z`).
- Os validadores não mutam a entrada: devolvem uma cópia congelada contendo apenas os
  campos declarados.
- Mensagens de erro nomeiam o campo e o requisito violado e nunca reproduzem o valor
  recebido.

## Contabilidade: representação e arredondamento

Ponto flutuante **nunca** é fonte de verdade contábil. Toda a aritmética vive em
`src/money/fixed-point.ts`; nenhum outro módulo reimplementa uma fórmula.

- **Dinheiro** são `bigint` em **micros de USD**: 1 USD = 1.000.000 micros (6 casas).
- **Quantidades de ativo** são `bigint` em **unidades atômicas**, com a escala do ativo
  (`assetScale`, casas decimais) carregada junto de toda quantidade. A fixture usa 8.
- **Preços** são micros de quote por **uma unidade inteira** do ativo, então o notional é
  `atoms * priceMicros / 10^assetScale`.
- **Fronteiras JSON** representam todo `bigint` como string decimal canônica: só dígitos,
  sem sinal, sem zeros à esquerda, sem expoente. `"100000000"` é US$100 em micros.

O arredondamento sempre favorece uma simulação conservadora — o agente simulado nunca
recebe preço melhor, custo menor ou quantidade maior do que a realidade daria:

| Grandeza calculada | Arredondamento | Por quê |
|---|---|---|
| quantidade comprável | para baixo | nunca comprar além do que o caixa cobre |
| quantidade a vender | para baixo | nunca vender além da posição |
| valor pago numa compra | para cima | nunca pagar menos que o custo real |
| valor recebido numa venda | para baixo | nunca receber mais que o resultado real |
| fees e custos | para cima | custo nunca é subestimado |
| frações como `positionPct` | trunca em 6 casas | determinístico, nunca aumenta o tamanho |

### Modelo de custos

Metade do spread é paga em cada lado, mais o slippage integral, sempre contra o operador:

```text
BUY  efetivo = ceil (referência * (20000 + spreadBps + 2*slippageBps) / 20000)
SELL efetivo = floor(referência * (20000 - spreadBps - 2*slippageBps) / 20000)
fee          = ceil (gross * feeBps / 10000)
```

Uma compra paga `gross + fee`; uma venda recebe `gross - fee`. Um SELL cujos custos
consomem o preço inteiro é rejeitado, nunca executado a zero.

### Ledger e carteiras

O ledger append-only é a fonte de verdade contábil; carteiras são estado derivado
(D-008). Cada evento tem `eventId` determinístico — hash do próprio conteúdo canônico —
e cada agente tem um ledger independente.

- mesmo `orderId` com conteúdo idêntico é **replay**: devolve o evento guardado,
  `appended: false`, e não cria um segundo evento;
- mesmo `orderId` com conteúdo diferente é **conflito** e lança erro;
- `applyAppendResult` só altera a carteira quando `appended` é `true`, então reprocessar
  uma ordem nunca move caixa duas vezes;
- caixa nunca fica negativa e posição nunca fica negativa: as duas invariantes são
  verificadas a cada evento aplicado, não presumidas;
- `replayWallet` reconstrói exatamente o mesmo caixa e as mesmas posições a partir do
  orçamento inicial e dos eventos.

Não há short selling, não há fill parcial (fill total ou rejeição) e não há transferência
entre carteiras.

## Risk Manager determinístico (primeira fatia)

`src/risk/risk-manager.ts` define `evaluateRisk`, um gate pré-trade puro entre um
`OrderIntent` já validado e o `PaperBroker`. Ele somente aprova ou rejeita: não executa o
broker, não altera portfolio/ledger, não lê o relógio e não usa IA. O `RiskDecision`
devolvido é imutável e traz `id` determinístico (hash sha256 do conteúdo canônico, mesmo
esquema de `src/ledger/events.ts`), `orderId`, `cycleId`, `agentId`, `approved`, `codes`
(motivos de rejeição, ordenados de forma estável) e `policyVersion`.

### Política (`RiskPolicy`, `src/risk/policy.ts`)

- `policyVersion` não vazia;
- `allowedAssets` — allowlist de símbolos; vazia bloqueia qualquer ordem;
- `maxOrderPositionBps` e `maxAssetExposureBps` — 0 a 10.000;
- `maxOpenPositions` — inteiro não negativo;
- `circuitBreaker` — booleano.

Política inválida falha fechado no parse (`ContractValidationError`). Perda diária,
drawdown, cooldown, liquidez e janela de trades ficam para fatias futuras de M2.

### Regras e códigos

| Código | Quando dispara |
|---|---|
| `CIRCUIT_BREAKER_ACTIVE` | `circuitBreaker` ligado; bloqueia BUY e SELL |
| `ASSET_NOT_ALLOWED` | ativo fora de `allowedAssets`; bloqueia BUY e SELL |
| `ORDER_SIZE_LIMIT_EXCEEDED` | `positionPct` da ordem, em bps, acima de `maxOrderPositionBps` |
| `ASSET_EXPOSURE_LIMIT_EXCEEDED` | só BUY; exposição projetada ao ativo acima de `maxAssetExposureBps` |
| `MAX_OPEN_POSITIONS_REACHED` | só BUY que abriria posição nova, com o limite já atingido |
| `INVALID_RISK_INPUT` | entrada ausente, incompatível, não canônica ou impossível de avaliar |

Quando mais de um código dispara, `codes` sempre os lista na mesma ordem (a da tabela
acima), nunca na ordem em que as verificações rodaram. `INVALID_RISK_INPUT` é sempre o
único código quando aparece — nenhuma outra regra pode ser avaliada com confiança se o
agente da carteira diverge do agente da ordem, se a escala de um ativo já detido diverge
da ordem, ou se o timestamp recebido não é um UTC ISO-8601 canônico. Um SELL nunca é
bloqueado por exposição ou número de posições, pois reduz risco; continua sujeito ao
circuit breaker e à allowlist. Esta fatia não redimensiona ordens: acima do limite, a
ordem inteira é rejeitada.

A exposição de um ativo é calculada apenas sobre o caixa somado à posição atual desse
mesmo ativo, avaliada ao `referencePriceMicros` da própria ordem — esta fatia não recebe
preço de outros ativos da carteira, então não estima o patrimônio total do portfolio. Essa
é uma limitação documentada, não uma métrica de exposição de portfólio.

O gate recebe a carteira de um único agente (nunca o `Portfolio` inteiro), então o
isolamento entre agentes é estrutural: não há como uma avaliação ler ou alterar a carteira
de outro agente.

## Integração determinística risco → execução paper

`src/execution/execute-paper-order-with-risk.ts` define `executePaperOrderWithRisk`, a
fachada mínima e pura que torna explícita a sequência obrigatória:

```text
OrderIntent validado → evaluateRisk → bloqueio OU PaperBroker.execute
```

Ela recebe apenas dependências e dados já validados — `OrderIntent`, a carteira do mesmo
agente, `RiskPolicy`, `ExecutionPolicy`, os instantes `evaluatedAt`/`occurredAt` e um
`Broker` — e devolve uma união discriminada, imutável e estruturada:

- **`RISK_REJECTED`** — o Risk Manager bloqueou a ordem; o broker não é chamado e nenhum
  evento de broker existe. O `RiskDecision` rejeitado já é o registro estruturado do
  bloqueio; esta fachada não inventa um evento de ledger para ele;
- **`BROKER_EXECUTED`** — o Risk Manager aprovou a ordem e o `PaperBroker` foi chamado
  exatamente uma vez com o mesmo intent, carteira, política de execução e instante
  recebidos. O `ExecutionOutcome` devolvido é exatamente o que o `PaperBroker` calculou —
  aprovação de risco **não** significa fill garantido: o `PaperBroker` ainda pode rejeitar
  por caixa insuficiente, ausência de posição, quantidade residual ou custos que consomem
  o preço/proceeds.

Uma ordem rejeitada pelo Risk Manager jamais alcança o broker: `riskDecision.approved ===
false` interrompe o fluxo antes de qualquer chamada de execução. Um broker cujo `kind` não
seja exatamente `"paper"` é rejeitado fail-closed antes de qualquer avaliação ou execução —
esta fachada não autoriza testnet, corretora ou broker ao vivo. Exceções inesperadas de
`evaluateRisk` ou do `PaperBroker` não são capturadas nem reinterpretadas; propagam como
vieram. A fachada é pura: não aplica evento ao ledger/portfolio, não redimensiona a ordem e
não muta intent, carteira ou políticas.

## Liquidação contábil da execução paper

`src/execution/settle-paper-execution.ts` define `settlePaperExecution`, a menor fatia
contábil do pipeline paper:

```text
executePaperOrderWithRisk → evento do PaperBroker → append idempotente no ledger → carteira derivada
```

Ela recebe o resultado já produzido por `executePaperOrderWithRisk`, a carteira imutável
do mesmo agente e seu `AgentLedger` — nunca chama `evaluateRisk` ou `Broker.execute` de
novo — e reaproveita integralmente `AgentLedger.append` e `applyAppendResult` para aplicar
exatamente as regras já existentes de idempotência e de invariantes de carteira:

- **`RISK_REJECTED`** — nenhum evento é criado ou anexado; a mesma carteira e o mesmo
  ledger recebidos são devolvidos por referência, sem qualquer registro contábil de uma
  rejeição de risco;
- **`BROKER_RECORDED`** — somente eventos produzidos pelo `PaperBroker` são registrados:
  exatamente `executionOutcome.event` é anexado ao ledger append-only, que continua sendo a
  fonte de verdade. A carteira devolvida é a carteira derivada desse append, com
  `appended: boolean` informando se o evento era novo;
- replay idêntico do mesmo `orderId` não duplica fill nem efeito contábil: devolve
  `appended: false`, o mesmo evento e a mesma carteira por referência;
- mesmo `orderId` com conteúdo diferente preserva o fail-closed existente do ledger e lança
  `LedgerConflictError`;
- uma rejeição produzida pelo próprio `PaperBroker` é auditada no ledger (para registrar que
  a ordem foi tentada e por que falhou), mas não altera saldo/posição: `applyAppendResult`
  nunca move caixa para um evento de rejeição, então a carteira devolvida é a mesma
  referência recebida;
- a carteira e o ledger recebidos precisam pertencer ao mesmo agente — validado
  estruturalmente antes de qualquer append; um evento que pertença a um agente diferente do
  ledger continua fail-closed via `LedgerAgentMismatchError`, sem duplicar essa checagem.

Pura e determinística: não lê o relógio, não usa aleatoriedade, não faz I/O e não muta
nenhuma entrada. Nenhuma persistência em arquivo é adicionada nesta fatia.

## Valoração de patrimônio sem look-ahead

`src/metrics/value-wallet-at.ts` define `valueWalletAt`, a menor base de métricas do
replay (M3): patrimônio é caixa mais posições marcadas a mercado, num único instante.

```text
Wallet + MarketSnapshot(s) disponíveis → EquityPoint auditável
```

Esta fatia valora apenas um instante. Ainda não calcula série temporal, P&L, drawdown, win
rate ou benchmark.

A valoração usa somente snapshots `complete === true`, cotados em `USD`, e já disponíveis
até `valuedAt` — reaproveitando `parseMarketSnapshot(snapshot, { notAfter: valuedAt })` para
essa prova de disponibilidade, sem duplicar a regra anti-look-ahead. Dados futuros,
ausentes, duplicados ou incompatíveis falham fechados:

- cada posição detida precisa ter exatamente um snapshot do mesmo ativo — zero ou mais de
  um falham fechados;
- um snapshot de um ativo que a carteira não possui é rejeitado, não ignorado;
- `snapshot.price` é convertido para micros por `microsFromUsdNumber`; uma precisão
  incompatível com seis casas decimais falha fechada em vez de arredondar;
- a soma dos valores usa limites protegidos (`addBounded`/`MAX_MICROS`); overflow falha
  fechado;
- uma carteira somente em caixa aceita lista de snapshots vazia e tem
  `equityMicros === cashMicros`.

O `EquityPoint` devolvido é imutável e traz, para cada posição, a evidência de preço usada
(`priceMicros`, `snapshotId`, `snapshotAvailableAt`), além de `positionsValueMicros`,
`equityMicros` e os `snapshotIds` efetivamente usados — todos ordenados por ativo, então a
ordem de entrada dos snapshots não altera o resultado. Nem a carteira, nem suas posições,
nem os snapshots recebidos são mutados.

## Resumo determinístico da série de patrimônio

`src/metrics/summarize-equity-series.ts` define `summarizeEquitySeries`, a segunda fatia de
M3: reduz uma série já calculada de `EquityPoint`s de um agente a um P&L final e ao maior
drawdown absoluto observado, com evidência de onde ocorreu.

```text
EquityPoint[] (canônicos, cronológicos, um agente) → EquitySeriesSummary auditável
```

Ainda não calcula replay de ciclos, drawdown percentual, win rate, fees agregadas ou
benchmarks — isso permanece fora do escopo desta fatia.

A entrada precisa já vir ordenada cronologicamente pelo chamador: timestamps não canônicos,
duplicados ou fora de ordem, ou pontos de agentes diferentes, falham fechados em vez de
serem silenciosamente reordenados ou misturados. O P&L é deliberadamente livre de dinheiro
em `number`: `pnlDirection` (`GAIN | LOSS | FLAT`) mais `pnlMagnitudeMicros`, a diferença
exata entre patrimônio final e inicial, dispensam um tipo monetário assinado.

O drawdown em cada ponto é `pico anterior ou atual − patrimônio atual`, nunca negativo;
`maxDrawdownMicros` é o maior valor observado na série, com `maxDrawdownPeakAt` e
`maxDrawdownTroughAt` como evidência dos instantes do pico e do vale. Em empate entre dois
episódios de mesma magnitude, o primeiro cronológico prevalece. Uma série de um único ponto
sempre produz P&L `FLAT` e drawdown zero. Toda comparação monetária reaproveita
`subtractChecked`/`MAX_MICROS` de `src/money/fixed-point.ts`; nenhuma fórmula é duplicada.
O `EquitySeriesSummary` devolvido é imutável; nem a lista de pontos recebida, nem seus
campos, são mutados.

## Resumo determinístico de custos de execução

`src/metrics/summarize-execution-costs.ts` define `summarizeExecutionCosts`, a terceira
fatia de M3: resume os fills e rejeições já registrados no ledger paper de um agente,
incluindo fees e o impacto de spread/slippage embutido no preço — sem reconstruir carteira
nem calcular win rate.

```text
agentId + LedgerEvent[] (qualquer ordem, possivelmente vazia) → ExecutionCostSummary auditável
```

Ainda não calcula P&L realizado por trade, win rate, drawdown percentual, benchmarks ou
replay completo — isso permanece fora do escopo desta fatia.

Fee e impacto de execução são reportados separadamente: a fee vem de `feeMicros` em cada
fill; o impacto mede quanto do spread/slippage foi embutido no preço efetivo, calculado por
fill como `BUY: effectivePriceMicros − referencePriceMicros`, `SELL: referencePriceMicros −
effectivePriceMicros`, com o custo do fill em `floor(quantityAtoms * deltaPriceMicros /
10^assetScale)`. Toda soma usa `addBounded`/`MAX_MICROS` de `src/money/fixed-point.ts` e
falha fechada em overflow; nenhuma fórmula monetária é duplicada.

Todo evento precisa pertencer ao `agentId` pedido e ter um `eventId` nunca repetido — um
agente divergente ou um `eventId` duplicado falha fechado, para impedir dupla contagem. Um
fill BUY com `effectivePriceMicros` abaixo do preço de referência, ou um fill SELL acima
dele, é direcionalmente inválido e falha fechado. A ordem de entrada dos eventos nunca
altera o resultado; uma lista vazia produz todas as contagens e totais zerados. Contagens de
rejeição usam somente os `REJECTION_CODES` estáveis de `src/ledger/events.ts`, sempre na
mesma ordem determinística. O `ExecutionCostSummary` devolvido é imutável; nem os eventos
recebidos, nem a coleção, são mutados.

## Benchmark cash (controle sem operações)

`src/benchmark/build-cash-benchmark.ts` define `buildCashBenchmark`, o primeiro benchmark
experimental de M3: uma carteira que permanece integralmente em caixa durante os mesmos
instantes de avaliação usados por uma estratégia — o controle contra o qual um sinal de
vantagem após custos precisa se provar.

```text
agentId + initialCashMicros + valuedAt[] (não vazio) → CashBenchmark auditável
```

O benchmark não executa nenhuma ordem: reutiliza integralmente `createWallet`
(`src/portfolio/portfolio.ts`), `valueWalletAt` com lista de snapshots vazia
(`src/metrics/value-wallet-at.ts`) e `summarizeEquitySeries`
(`src/metrics/summarize-equity-series.ts`) — a mesma valoração e o mesmo resumo que
qualquer estratégia usa. Nenhuma validação de timestamp, cálculo de patrimônio, P&L ou
drawdown é duplicada; até a validação do capital inicial (tipo, sinal e limite) vem de
`addBounded`/`MAX_MICROS`, acionado dentro de `valueWalletAt`, não de uma checagem própria.

Como a carteira nunca opera, cada ponto tem caixa e patrimônio exatamente iguais ao capital
inicial, posições e `snapshotIds` sempre vazios, e o resumo é sempre `FLAT` com
`pnlMagnitudeMicros` e `maxDrawdownMicros` zero — por construção, não por um caso especial
verificado à parte. Buy-and-hold e outros benchmarks ainda não existem.

## Comparação com o benchmark cash

`src/benchmark/compare-to-cash-benchmark.ts` define `compareToCashBenchmark`: mede se o
`EquitySeriesSummary` de uma estratégia terminou acima, abaixo ou empatado com um
`CashBenchmark` do mesmo experimento. Não executa nenhuma ordem e não cria ranking entre
agentes.

```text
EquitySeriesSummary da estratégia + CashBenchmark → BenchmarkComparison auditável
```

Antes de comparar, a função exige que os dois resumos descrevam o mesmo experimento — mesmo
`agentId`, `startedAt`, `endedAt`, `pointCount` e patrimônio inicial da estratégia igual ao
`initialCashMicros` do benchmark — e que todo valor monetário lido seja um `bigint` dentro do
limite de sanidade existente (`MAX_MICROS`). Como `CashBenchmark` é só um tipo estrutural em
tempo de compilação, a própria consistência interna do benchmark recebido também é verificada:
`kind` precisa ser exatamente `"CASH"`, o `agentId` aninhado em `summary` precisa coincidir com
o `agentId` do benchmark, e o `startingEquityMicros` aninhado em `summary` precisa coincidir com
`initialCashMicros`. Qualquer incompatibilidade ou valor forjado falha fechado com
`ContractValidationError`, em vez de produzir um resultado silenciosamente errado.

A direção (`OUTPERFORMED`, `UNDERPERFORMED` ou `TIED`) vem apenas da comparação dos dois
patrimônios finais; `differenceMagnitudeMicros` é a diferença absoluta exata entre eles,
calculada com `subtractChecked` de `src/money/fixed-point.ts` — nunca em ponto flutuante. O
`BenchmarkComparison` devolvido é imutável; nenhuma entrada é mutada.

## Seleção de snapshot sem look-ahead para replay

`src/replay/select-latest-available-snapshot.ts` define `selectLatestAvailableSnapshot`: a
primitiva que impede o replay de usar dados futuros ao montar o contexto de uma decisão
histórica (D-009).

```text
snapshots + asset + quote + decisionAt → MarketSnapshot disponível mais recente
```

Toda validação estrutural é reaproveitada de `parseMarketSnapshot`
(`src/domain/contracts.ts`); este módulo acrescenta apenas a regra de seleção:

- uma entrada bruta cujo `asset`/`quote` não coincidem com o par pedido é ignorada sem ser
  validada;
- toda entrada que coincide com o par pedido é validada por completo — inclusive quando
  `availableAt` é posterior a `decisionAt` — para que um snapshot malformado do par não possa
  se esconder atrás do filtro temporal;
- entre os snapshots validados do par, vence o de maior `availableAt` que seja
  `<= decisionAt`;
- ausência de snapshot elegível, ou empate entre dois snapshots elegíveis no maior
  `availableAt`, falham fechados em vez de escolher um vencedor arbitrário.

O snapshot devolvido é exatamente o objeto validado e congelado que `parseMarketSnapshot`
produz. A coleção de entrada nunca é ordenada nem mutada, e o resultado nunca depende da
ordem em que os snapshots foram fornecidos.

## Documentação

`docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`,
`docs/GPTHEIST_ANALYSIS.md`. Atribuição de terceiros em `THIRD_PARTY_NOTICES.md`.
