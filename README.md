# AstraNovo

Experimento de trading autônomo multiagente, **exclusivamente em paper trading**.

> ⚠️ **Paper-only.** Este repositório não contém wallet, chave privada, credencial,
> integração com corretora, testnet ou qualquer rota de execução financeira. Nada aqui
> movimenta dinheiro real. Sair dessa fronteira exige decisão explícita do proprietário,
> registrada em `docs/DECISIONS.md`.

## O que existe hoje

Milestones **M0 — Fundação e contratos**, **M1 — Carteira, ledger e PaperBroker** e a
primeira fatia de **M2 — Risk Manager determinístico**.

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
- `src/config/load-agents.ts` — carregamento e validação da configuração de N agentes;
- `config/agents.json` — seis perfis de demonstração, cada um com US$100 fictícios;
- `tests/` — testes offline e determinísticos.

Ainda **não** existem: coleta de mercado, chamada de modelo, prompts, orquestrador
multiagente, perda diária/drawdown/cooldown/liquidez no Risk Manager, execução automática
do broker após aprovação, métricas, persistência em arquivo, servidor ou banco de dados.
O roadmap está em `docs/ROADMAP.md`.

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

## Documentação

`docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`,
`docs/GPTHEIST_ANALYSIS.md`. Atribuição de terceiros em `THIRD_PARTY_NOTICES.md`.
