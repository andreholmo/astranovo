# Plano de implementação do MVP — Astra Paper Trader

- **Tarefa:** TASK-001
- **Tipo:** planejamento técnico (nenhum código de trading implementado)
- **Escopo coberto:** fase 1 do `docs/PROJECT_CONTEXT.md` — paper trading, 100% simulado, capital fictício de US$ 100
- **Princípios:** Python simples, execução local, arquivos locais/CSV, poucas dependências, tudo auditável e reproduzível

Fora deste plano, por decisão do projeto: corretora real, testnet, dinheiro real, dashboard, aplicação web, banco de dados externo, filas, microsserviços, múltiplos agentes e custódia de chaves.

---

## 1. Arquitetura mínima e fluxo ponta a ponta

O sistema é um **processo único, síncrono, que executa ciclos discretos**. Cada ciclo é um `tick`. Não há concorrência, servidor, nem estado em memória entre execuções: o estado durável vive em arquivos.

```text
┌──────────────┐
│  Scheduler   │  loop local, intervalo fixo (ex.: 15 min) ou modo replay
└──────┬───────┘
       │ tick(t)
       ▼
┌──────────────┐   MarketSnapshot     ┌───────────────┐
│ MarketData   │─────────────────────▶│ ContextBuilder │
│ (coleta)     │                      │ (monta payload)│
└──────────────┘                      └──────┬────────┘
                                             │ DecisionRequest
                                             ▼
                                      ┌──────────────┐
                                      │ AstraClient  │  (motor de decisão)
                                      └──────┬───────┘
                                             │ resposta bruta (texto/JSON)
                                             ▼
                                      ┌───────────────┐
                                      │ DecisionParser│  valida schema; falha ⇒ HOLD
                                      └──────┬────────┘
                                             │ AstraDecision (BUY/SELL/HOLD)
                                             ▼
                                      ┌──────────────┐
                                      │ RiskManager  │  determinístico; aprova/ajusta/rejeita
                                      └──────┬───────┘
                                             │ OrderIntent (ou nenhuma)
                                             ▼
                                      ┌──────────────┐
                                      │ PaperBroker  │  determinístico; custos + slippage
                                      └──────┬───────┘
                                             │ Fill (ou rejeição)
                                             ▼
                                      ┌──────────────┐
                                      │  Portfolio   │  caixa, posições, equity
                                      └──────┬───────┘
                                             │ PortfolioSnapshot
                                             ▼
                                      ┌──────────────┐
                                      │   Journal    │  CSV append-only (todos os estágios)
                                      └──────┬───────┘
                                             │ (offline, sob demanda)
                                             ▼
                                      ┌──────────────┐
                                      │   Metrics    │  lê CSVs, calcula desempenho
                                      └──────────────┘
```

### Responsabilidade de cada componente

| Componente | Responsabilidade única | Determinístico? | Toca a rede? |
|---|---|---|---|
| `MarketData` | obter preço/candles do símbolo e devolver `MarketSnapshot` validado | não (I/O externo) | sim |
| `ContextBuilder` | transformar `MarketSnapshot` + estado da carteira em um `DecisionRequest`, sem segredos | sim | não |
| `AstraClient` | enviar o `DecisionRequest` e devolver a resposta bruta, com timeout e limite de tentativas | não | sim |
| `DecisionParser` | validar a resposta contra o contrato e devolver `AstraDecision` ou um erro classificado | sim | não |
| `RiskManager` | aplicar limites duros e converter a decisão em `OrderIntent` ou rejeitá-la | **sim** | não |
| `PaperBroker` | simular execução: preço efetivo, slippage, taxas, fill total/parcial/rejeitado | **sim** | não |
| `Portfolio` | aplicar o `Fill`, manter caixa/posições e produzir `PortfolioSnapshot` | **sim** | não |
| `Journal` | escrever cada evento em CSV append-only | sim | não |
| `Metrics` | calcular métricas a partir dos CSVs, offline | sim | não |

### Regras estruturais

1. **Fronteira de não-determinismo:** apenas `MarketData` e `AstraClient` são não-determinísticos. Tudo depois deles é função pura de `(entrada, configuração)`.
2. **Tempo injetado:** nenhum módulo determinístico lê o relógio; o `timestamp` do tick é passado como argumento.
3. **Sem aleatoriedade:** o `PaperBroker` e o `RiskManager` não usam `random`. Slippage é uma fórmula fixa, não um sorteio.
4. **Falha ⇒ HOLD:** qualquer erro entre `AstraClient` e `DecisionParser` degrada para `HOLD` registrado, nunca para uma ordem.
5. **Append-only:** o `Journal` nunca reescreve linhas; correções viram novos eventos.
6. **Reprodutibilidade:** dado o mesmo `data/runs/<run_id>/raw/`, uma reexecução em modo replay deve gerar CSVs idênticos.

---

## 2. Estrutura de diretórios proposta

```text
astranovo/
├── CLAUDE.md
├── TASK.md
├── README.md
├── .gitignore
├── config/
│   └── config.example.toml         # template versionado; sem segredos
├── src/
│   └── astra_trader/
│       ├── __init__.py
│       ├── config.py               # carrega e valida configuração
│       ├── contracts.py            # dataclasses + validadores (seção 3)
│       ├── errors.py               # códigos de erro/falha padronizados
│       ├── market_data.py          # coleta (live) e leitura de fixtures (replay)
│       ├── context_builder.py      # monta o DecisionRequest
│       ├── astra_client.py         # transporte até o motor de decisão
│       ├── decision_parser.py      # parsing + validação da resposta
│       ├── risk_manager.py         # limites duros, determinístico
│       ├── paper_broker.py         # execução simulada, determinística
│       ├── portfolio.py            # caixa, posições, equity
│       ├── journal.py              # escrita CSV append-only
│       ├── metrics.py              # métricas offline
│       └── runner.py               # orquestra um tick e o loop
├── tests/
│   ├── fixtures/
│   │   ├── market/                 # candles/preços congelados
│   │   ├── decisions/              # respostas válidas e inválidas do Astra
│   │   └── golden/                 # saídas esperadas do replay
│   ├── test_contracts.py
│   ├── test_decision_parser.py
│   ├── test_risk_manager.py
│   ├── test_paper_broker.py
│   ├── test_portfolio.py
│   ├── test_metrics.py
│   └── test_replay_end_to_end.py
├── scripts/
│   ├── run_tick.py                 # executa um único ciclo
│   ├── run_replay.py               # reexecuta um run a partir de raw/
│   └── report.py                   # imprime métricas de um run
└── data/                           # NÃO versionado (.gitignore)
    └── runs/
        └── <run_id>/
            ├── run.json            # configuração efetiva do run (sem segredos)
            ├── raw/                # respostas brutas de mercado e do Astra
            ├── market.csv
            ├── decisions.csv
            ├── orders.csv
            ├── fills.csv
            ├── portfolio.csv
            └── errors.csv
```

**Notas**

- `data/` inteiro entra no `.gitignore`. Resultados que valham a pena guardar são copiados manualmente para `docs/results/` como resumo, nunca em massa.
- Nenhum arquivo `.env` é criado. Se o `AstraClient` exigir credencial, ela vem de variável de ambiente lida só dentro de `astra_client.py`, e nunca é escrita em `run.json`, em log ou em CSV.
- `src/` em layout de pacote para que os testes importem `astra_trader` sem manipular `sys.path` de forma frágil.

---

## 3. Contratos de dados

Todos os contratos são `dataclasses` do stdlib com validador explícito (`validate()` ou `from_dict()` que levanta erro classificado). Valores monetários e quantidades usam `Decimal` para evitar erro de ponto flutuante em caixa. Todos os timestamps são **UTC, ISO-8601, com sufixo `Z`**.

### 3.1 `MarketSnapshot` — estado de mercado no tick

```python
@dataclass(frozen=True)
class MarketSnapshot:
    tick_id: str            # identificador monotônico do ciclo, ex. "2026-09-17T18:00:00Z"
    ts: str                 # instante da coleta (UTC ISO-8601)
    symbol: str             # ex. "BTC-USD"; deve estar na allowlist
    price: Decimal          # preço de referência (último negócio ou mid)
    bid: Decimal | None
    ask: Decimal | None
    volume_24h: Decimal | None
    candles: tuple[Candle, ...]   # janela recente, ordenada, ex. 50 candles de 15m
    source: str             # identificador da fonte de dados
    stale: bool             # True se o dado excede a idade máxima tolerada
```

```python
@dataclass(frozen=True)
class Candle:
    ts: str; open: Decimal; high: Decimal; low: Decimal; close: Decimal; volume: Decimal
```

**Invariantes validadas:** `price > 0`; `bid <= ask` quando ambos existem; `low <= open, close <= high` em cada candle; candles estritamente crescentes no tempo e sem buracos maiores que um intervalo; `symbol` na allowlist. Violação ⇒ tick abortado com erro `MARKET_DATA_INVALID` e **nenhuma** chamada ao Astra.

### 3.2 `DecisionRequest` — o que é enviado ao Astra

```python
@dataclass(frozen=True)
class DecisionRequest:
    tick_id: str
    symbol: str
    market: MarketSnapshot
    portfolio: PortfolioSnapshot     # caixa, posição atual, equity
    constraints: dict                # limites vigentes, em forma estruturada
    schema_version: str
```

O payload é **determinístico** (mesma entrada ⇒ mesmo texto, chaves ordenadas) e **não contém** chaves, credenciais, caminhos locais ou dados pessoais. `constraints` informa ao Astra o que o `RiskManager` vai impor (notional máximo, apenas long, sem alavancagem), para reduzir decisões inexequíveis — mas o Risk Manager continua sendo a autoridade final.

### 3.3 `AstraDecision` — a resposta do motor de decisão

Contrato único para **BUY, SELL e HOLD**, estruturado e validável:

```jsonc
{
  "schema_version": "1.0",
  "tick_id": "2026-09-17T18:00:00Z",
  "symbol": "BTC-USD",
  "action": "BUY",            // "BUY" | "SELL" | "HOLD"
  "size_pct": 0.25,           // fração do capital elegível; 0 se HOLD
  "confidence": 0.62,         // [0, 1]
  "max_slippage_bps": 20,     // tolerância declarada
  "rationale": "texto curto, <= 500 caracteres",
  "invalidation": "condição que invalida a tese, texto curto"
}
```

```python
@dataclass(frozen=True)
class AstraDecision:
    schema_version: str
    tick_id: str
    symbol: str
    action: Action              # Enum: BUY | SELL | HOLD
    size_pct: Decimal           # 0 <= size_pct <= 1
    confidence: Decimal         # 0 <= confidence <= 1
    max_slippage_bps: int       # >= 0
    rationale: str
    invalidation: str
    raw_response_ref: str       # caminho do arquivo em raw/ com a resposta original
```

**Regras de validação (todas obrigatórias):**

| Regra | Violação ⇒ |
|---|---|
| JSON íntegro e único objeto | `DECISION_UNPARSEABLE` |
| `schema_version` suportada | `DECISION_SCHEMA_VERSION` |
| `tick_id` igual ao do request | `DECISION_TICK_MISMATCH` |
| `symbol` igual ao do request e na allowlist | `DECISION_SYMBOL_INVALID` |
| `action` ∈ {BUY, SELL, HOLD} | `DECISION_ACTION_INVALID` |
| `size_pct` numérico em [0,1]; **HOLD exige `size_pct == 0`**; BUY/SELL exigem `size_pct > 0` | `DECISION_SIZE_INVALID` |
| `confidence` numérico em [0,1] | `DECISION_CONFIDENCE_INVALID` |
| `max_slippage_bps` inteiro ≥ 0 | `DECISION_SLIPPAGE_INVALID` |
| textos dentro do limite de tamanho | `DECISION_TEXT_TOO_LONG` |
| campos desconhecidos presentes | ignorados, mas registrados em `errors.csv` como `DECISION_EXTRA_FIELDS` (aviso, não bloqueio) |

Qualquer violação bloqueante ⇒ a decisão efetiva vira `HOLD` sintético (`action=HOLD`, `size_pct=0`, `confidence=0`, `rationale="fallback: <código>"`), registrado tanto em `decisions.csv` quanto em `errors.csv`.

### 3.4 `OrderIntent` — saída do Risk Manager

```python
@dataclass(frozen=True)
class OrderIntent:
    tick_id: str
    ts: str
    symbol: str
    side: Side                   # BUY | SELL
    quantity: Decimal            # > 0, em unidades do ativo
    notional: Decimal            # quantity * preço de referência
    limit_price: Decimal | None  # None = execução a mercado simulada
    reference_price: Decimal     # preço do MarketSnapshot usado no dimensionamento
    reason_codes: tuple[str, ...]  # ex. ("CLAMPED_MAX_NOTIONAL",)
    decision_ref: str            # tick_id + hash da decisão
```

Se o Risk Manager rejeitar, não há `OrderIntent`: há um `RiskRejection(tick_id, reason_code, detail)` gravado em `orders.csv` com `status=REJECTED`.

### 3.5 `Fill` — resultado da execução simulada

```python
@dataclass(frozen=True)
class Fill:
    tick_id: str
    ts: str
    symbol: str
    side: Side
    status: FillStatus           # FILLED | PARTIAL | REJECTED
    requested_quantity: Decimal
    filled_quantity: Decimal     # 0 se REJECTED
    reference_price: Decimal
    effective_price: Decimal     # após slippage
    slippage_bps: Decimal
    fee: Decimal                 # em USD, sempre >= 0
    gross_notional: Decimal      # filled_quantity * effective_price
    cash_delta: Decimal          # negativo em BUY, positivo em SELL, já líquido de fee
    reject_reason: str | None
```

### 3.6 `Position` — posição por símbolo

```python
@dataclass(frozen=True)
class Position:
    symbol: str
    quantity: Decimal            # >= 0 no MVP (apenas long, sem venda a descoberto)
    avg_entry_price: Decimal     # 0 quando quantity == 0
    realized_pnl: Decimal        # acumulado, líquido de taxas
```

`unrealized_pnl` é derivado (`quantity * (price_atual - avg_entry_price)`), nunca armazenado.

### 3.7 `PortfolioSnapshot` — estado da carteira ao fim do tick

```python
@dataclass(frozen=True)
class PortfolioSnapshot:
    tick_id: str
    ts: str
    cash: Decimal                # USD disponível
    positions: tuple[Position, ...]
    mark_prices: dict[str, Decimal]
    positions_value: Decimal     # Σ quantity * mark_price
    equity: Decimal              # cash + positions_value
    realized_pnl_total: Decimal
    unrealized_pnl_total: Decimal
    fees_paid_total: Decimal
    initial_capital: Decimal     # fixo: 100.00
    return_pct: Decimal          # (equity / initial_capital) - 1
    max_drawdown_pct: Decimal    # acumulado desde o início do run
```

**Invariantes contábeis (verificadas a cada tick, falha ⇒ aborta o run):**

- `cash >= 0` — sem alavancagem, sem margem;
- `quantity >= 0` para toda posição — sem venda a descoberto no MVP;
- `equity == cash + Σ(quantity * mark_price)` dentro da tolerância de arredondamento;
- `equity_t == equity_{t-1} + Δ marcação + realized_pnl_do_tick - fees_do_tick`.

### 3.8 Esquemas dos CSVs

Todos com cabeçalho na primeira linha, separador `,`, aspas quando necessário, codificação UTF-8, quebra `\n`.

- **`market.csv`** — `tick_id, ts, symbol, price, bid, ask, volume_24h, source, stale`
- **`decisions.csv`** — `tick_id, ts, symbol, action, size_pct, confidence, max_slippage_bps, is_fallback, fallback_code, rationale, invalidation, raw_response_ref, latency_ms`
- **`orders.csv`** — `tick_id, ts, symbol, side, status, quantity, notional, reference_price, limit_price, reason_codes, decision_ref`
- **`fills.csv`** — `tick_id, ts, symbol, side, status, requested_quantity, filled_quantity, reference_price, effective_price, slippage_bps, fee, gross_notional, cash_delta, reject_reason`
- **`portfolio.csv`** — `tick_id, ts, cash, positions_value, equity, realized_pnl_total, unrealized_pnl_total, fees_paid_total, return_pct, max_drawdown_pct`
- **`errors.csv`** — `tick_id, ts, stage, code, severity, detail, raw_ref`

`tick_id` é a chave que costura todos os arquivos: um tick produz no máximo uma linha em cada CSV (exceto `errors.csv`, que pode ter várias).

---

## 4. Ordem incremental de implementação

Cada etapa é testável isoladamente e termina em um commit próprio. Nenhuma etapa depende de uma etapa posterior.

| # | Etapa | Entrega | Como validar sem o resto do sistema |
|---|---|---|---|
| 0 | Esqueleto | pacote `src/astra_trader/`, `config.py`, `config.example.toml`, `.gitignore`, `errors.py` | carregar a configuração de exemplo e falhar corretamente em campos ausentes |
| 1 | Contratos | `contracts.py` completo com validadores | testes de tabela com entradas válidas e inválidas; nenhum I/O |
| 2 | Journal | `journal.py`, criação de `data/runs/<run_id>/`, escrita append-only | escrever eventos sintéticos e reler os CSVs |
| 3 | Market data (replay primeiro) | `market_data.py` com leitor de fixtures; só depois o coletor live | montar `MarketSnapshot` a partir de `tests/fixtures/market/` |
| 4 | PaperBroker | `paper_broker.py` com custos e slippage | dar `OrderIntent` na mão e conferir o `Fill` esperado |
| 5 | Portfolio | `portfolio.py`, capital inicial US$ 100 | aplicar sequência fixa de `Fill` e conferir caixa/equity/PnL |
| 6 | RiskManager | `risk_manager.py` com os limites da seção 6.2 | dar `AstraDecision` + `PortfolioSnapshot` e conferir aprovação/ajuste/rejeição |
| 7 | Parser de decisão | `decision_parser.py` | bateria de respostas boas e malformadas de `tests/fixtures/decisions/` |
| 8 | Context builder | `context_builder.py` | conferir payload determinístico e ausência de segredos |
| 9 | AstraClient | `astra_client.py` com timeout, retry limitado e gravação em `raw/` | stub local que devolve respostas fixas; um teste de timeout |
| 10 | Runner (um tick) | `runner.py::run_tick()`, `scripts/run_tick.py` | executar um tick inteiro em modo replay com cliente stub |
| 11 | Loop + replay | agendamento por intervalo, `scripts/run_replay.py` | replay de N ticks gerando CSVs idênticos ao golden |
| 12 | Métricas | `metrics.py`, `scripts/report.py` | calcular métricas sobre CSVs congelados |
| 13 | Coletor live | ativar a fonte real de mercado atrás da mesma interface | comparar um snapshot live com o schema e a idade máxima |

O **caminho crítico para o primeiro resultado útil** é 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 10 → 11: com o `AstraClient` ainda stubado já é possível rodar o pipeline inteiro de ponta a ponta e validar a contabilidade.

---

## 5. Estratégia de testes

Framework: `pytest`. **Nenhum teste toca a rede** — a coleta live é exercida apenas manualmente, por script, fora da suíte.

### 5.1 Camadas

1. **Testes de contrato** (`test_contracts.py`, `test_decision_parser.py`)
   Tabela de casos: cada regra da seção 3.3 tem pelo menos um caso válido e um inválido. Cobrem explicitamente: JSON truncado, JSON com texto ao redor, `action` em minúsculas, `size_pct` como string, `size_pct > 1`, `size_pct` negativo, HOLD com `size_pct > 0`, BUY com `size_pct == 0`, `confidence` fora de faixa, símbolo fora da allowlist, `tick_id` divergente, campos extras, resposta vazia.

2. **Testes determinísticos de unidade** (`test_paper_broker.py`, `test_risk_manager.py`, `test_portfolio.py`)
   Entradas fixas ⇒ saídas exatas, comparadas com `Decimal`. Todo teste do broker e do risco roda duas vezes e exige resultado idêntico (prova de determinismo).

3. **Invariantes contábeis** (`test_portfolio.py`)
   Sobre sequências longas de fills gerados por tabela (não por sorteio): `cash >= 0`; `quantity >= 0`; `equity == cash + valor das posições`; taxas sempre reduzem o equity; vender tudo zera a posição e o `avg_entry_price`.

4. **Teste de replay ponta a ponta** (`test_replay_end_to_end.py`)
   Fixture com ~50 ticks de mercado congelado + 50 respostas do Astra pré-gravadas (incluindo 5 malformadas e 2 timeouts simulados) ⇒ compara `portfolio.csv`, `fills.csv` e `errors.csv` com os arquivos golden. É o teste que protege contra regressão de comportamento.

5. **Testes de degradação** (`test_decision_parser.py`, `test_replay_end_to_end.py`)
   Cada modo de falha da seção 6.4 deve produzir `HOLD`, uma linha em `errors.csv` com o código certo e **nenhuma** linha em `fills.csv`.

### 5.2 Critérios de qualidade da suíte

- A suíte roda offline, em poucos segundos, sem estado global.
- Nenhum teste depende da data/hora atual: o tempo é sempre injetado.
- Atualizar um arquivo golden é uma mudança explícita e revisável no diff.
- Antes de qualquer commit: suíte verde + `git diff --check`.

### 5.3 O que NÃO é testado no MVP

Latência real da fonte de dados, comportamento sob rede instável, qualidade das decisões do Astra (isso é medido, não testado) e desempenho computacional.

---

## 6. Riscos técnicos, hipóteses e tratamento explícito

### 6.1 Custos e slippage (obrigatoriamente explícitos)

O `PaperBroker` aplica, nesta ordem, um modelo determinístico e configurável:

1. **Preço de referência** = `MarketSnapshot.price` (ou `ask` em BUY e `bid` em SELL, quando disponíveis — preferível, porque já embute o spread real).
2. **Slippage** = `slippage_bps_base` (config, ex.: 5 bps) somado a um termo de impacto opcional proporcional ao notional. Sempre **contra** o operador: BUY executa acima, SELL abaixo.
   `effective_price = reference_price * (1 ± slippage_bps / 10_000)`
3. **Taxa** = `gross_notional * fee_bps / 10_000` (config, ex.: 10 bps), sempre debitada do caixa, inclusive na venda.
4. **Rejeições determinísticas:** notional abaixo do mínimo (`min_notional`, ex.: US$ 5), caixa insuficiente após taxa, quantidade resultante zero após arredondamento, slippage calculado acima do `max_slippage_bps` declarado na decisão.
5. **Arredondamento:** quantidade e preço arredondados com `Decimal` e `ROUND_DOWN` — nunca a favor de criar caixa inexistente.

**Hipótese a validar:** os valores default de `fee_bps` e `slippage_bps` são chutes conservadores. Enquanto não forem calibrados contra dados reais de book, qualquer resultado positivo deve ser reportado também com custos dobrados (análise de sensibilidade).

### 6.2 Limites do Risk Manager (determinísticos, versão MVP)

Aplicados em ordem fixa; cada ajuste gera um `reason_code`:

| Limite | Comportamento |
|---|---|
| `symbol` fora da allowlist | rejeita |
| apenas long (`SELL` sem posição) | rejeita |
| `max_position_pct` do equity (ex.: 50%) | reduz o tamanho (clamp) |
| `max_order_notional` (ex.: US$ 25) | reduz o tamanho |
| `min_notional` (ex.: US$ 5) | rejeita se ficar abaixo |
| caixa insuficiente | reduz ao caixa disponível menos taxa estimada; se ficar abaixo do mínimo, rejeita |
| `max_daily_loss_pct` (ex.: 10% do equity inicial do dia) | **circuit breaker**: só HOLD até o próximo dia UTC |
| `max_consecutive_model_failures` (ex.: 5) | **circuit breaker**: encerra o run |
| dado de mercado `stale` | rejeita (não opera com preço velho) |
| `confidence` abaixo do mínimo configurado | rejeita |

Alavancagem, venda a descoberto e múltiplos símbolos simultâneos ficam desligados no MVP.

### 6.3 Riscos técnicos

| Risco | Impacto | Mitigação no MVP |
|---|---|---|
| Fonte de dados muda de formato ou cai | ticks perdidos, dado inválido | validação estrita do snapshot, campo `stale`, tick abortado sem chamar o Astra, erro registrado |
| Preço de referência não reflete execução real | resultado otimista demais | usar bid/ask quando houver; slippage sempre contra o operador; análise de sensibilidade de custos |
| Erro de ponto flutuante na contabilidade | caixa/equity errados | `Decimal` em todo valor monetário e invariantes verificadas a cada tick |
| Astra devolve JSON inválido ou alucina campos | ordem espúria | contrato estrito, fallback HOLD, circuit breaker por falhas consecutivas |
| Astra devolve decisão plausível mas inexequível | ruído | Risk Manager é a autoridade final; ajustes registrados com `reason_code` |
| Look-ahead bias no replay | métricas infladas | o `ContextBuilder` só recebe candles com `ts <= tick_ts`; teste específico para isso |
| Overfitting a uma janela curta | conclusão falsa | mínimo de ticks e período declarados antes do run; comparar sempre com buy & hold |
| Amostra pequena / sem significância | conclusão falsa | reportar o número de trades junto de qualquer métrica; não concluir com poucas dezenas de trades |
| Custo/latência das chamadas ao motor de decisão | run inviável | cadência configurável; timeout curto; `raw/` guardado para replay sem novo custo |
| Vazamento acidental de credencial | risco de segurança | credencial só via variável de ambiente, nunca em `run.json`, log, CSV ou `raw/`; `data/` no `.gitignore` |
| Perda de dados por escrita concorrente | CSV corrompido | processo único, escrita append com flush por linha, um `run_id` por execução |

### 6.4 Modos de falha do modelo e degradação

| Situação | Tratamento |
|---|---|
| Timeout ou erro de transporte | até `max_retries` tentativas (ex.: 2), com espera fixa; esgotou ⇒ `HOLD` + `MODEL_TIMEOUT` |
| Resposta vazia / não-JSON | `HOLD` + `DECISION_UNPARSEABLE` |
| Schema inválido | `HOLD` + código específico da seção 3.3 |
| `tick_id`/símbolo divergentes | `HOLD` + `DECISION_TICK_MISMATCH` / `DECISION_SYMBOL_INVALID` |
| Decisão válida mas rejeitada pelo risco | nenhuma ordem; `orders.csv` com `status=REJECTED` e o motivo |
| N falhas consecutivas | circuit breaker encerra o run com status explícito |

Toda resposta bruta, inclusive as inválidas, é gravada em `raw/` antes do parsing — é o que permite reproduzir e auditar depois.

### 6.5 Hipóteses que precisam ser validadas

1. Uma cadência de 15 minutos é suficiente para o experimento e sustentável em custo.
2. Os custos default (10 bps de taxa, 5 bps de slippage) são realistas para o par escolhido.
3. Um único símbolo é suficiente para a fase 1.
4. O motor de decisão consegue emitir JSON conforme o contrato com taxa de falha aceitável (a medir: `% de fallback HOLD`).
5. O período de execução planejado gera trades suficientes para qualquer leitura estatística mínima.
6. `MarketSnapshot.price` é uma aproximação aceitável do preço executável para tamanhos de ~US$ 25.

---

## 7. Escolhas que dependem de decisão de André

Nenhuma destas será decidida unilateralmente; o padrão proposto só é adotado se houver confirmação.

| # | Decisão | Opções | Padrão proposto |
|---|---|---|---|
| 1 | Símbolo(s) da allowlist | um par único vs. lista curta | **um único par** (ex.: BTC-USD) |
| 2 | Fonte de dados de mercado | qual provedor público, com ou sem chave | um endpoint REST público **sem autenticação**, acessado via `urllib` do stdlib |
| 3 | Cadência dos ticks | 5 / 15 / 60 minutos | **15 minutos** |
| 4 | Duração do experimento | por nº de ticks ou por data-fim | mínimo declarado antes de começar (ex.: 30 dias) |
| 5 | Como o Astra é acessado | API de modelo, processo local ou operação manual | API via `astra_client.py`, com stub local para desenvolvimento |
| 6 | Dependências permitidas | stdlib puro vs. stdlib + `requests` | **stdlib** no runtime; `pytest` apenas como dependência de desenvolvimento |
| 7 | Formato da configuração | TOML (`tomllib`, stdlib ≥ 3.11) vs. JSON | **TOML** |
| 8 | Custos assumidos | `fee_bps` e `slippage_bps` | 10 bps e 5 bps, ambos configuráveis |
| 9 | Limites de risco | `max_position_pct`, `max_order_notional`, `max_daily_loss_pct` | 50%, US$ 25, 10% |
| 10 | Venda a descoberto | permitir ou não | **não permitir** no MVP |
| 11 | Benchmark de comparação | buy & hold, caixa parado ou ambos | **buy & hold do mesmo símbolo** |
| 12 | Versão mínima do Python | 3.11+ (por `tomllib`) vs. 3.10 | **3.11+** |

---

## 8. Definição objetiva de "MVP concluído"

O MVP está concluído quando **todos** os itens abaixo forem verdadeiros:

**Funcional**

1. Um comando único executa um tick completo: coleta → contexto → decisão → validação → risco → execução simulada → carteira → CSV.
2. O loop executa ticks sem intervenção manual durante o período configurado e sobrevive a falhas de rede e a respostas inválidas, sempre degradando para `HOLD` registrado.
3. BUY, SELL e HOLD estão implementados, validados pelo contrato da seção 3.3 e exercitados pelos testes.
4. Capital inicial fixo de **US$ 100**, com contabilidade que fecha (invariantes da seção 3.7 verdadeiras em todos os ticks do run).
5. Taxas e slippage são aplicados em toda execução e aparecem em `fills.csv` e no total acumulado do `portfolio.csv`.
6. O Risk Manager bloqueia, no mínimo: símbolo fora da allowlist, caixa insuficiente, notional mínimo, tamanho máximo de posição, dado velho e perda diária máxima.

**Qualidade e rastreabilidade**

7. `market.csv`, `decisions.csv`, `orders.csv`, `fills.csv`, `portfolio.csv` e `errors.csv` são gerados e costurados por `tick_id`; toda resposta bruta está em `raw/`.
8. O modo replay reproduz um run a partir de `raw/` gerando CSVs idênticos (teste golden verde).
9. Suíte `pytest` verde, offline, cobrindo contratos, risco, broker, carteira, degradação e replay ponta a ponta.
10. `scripts/report.py` calcula, sobre um run: retorno total %, PnL realizado e não realizado, número de trades, taxa de acerto, drawdown máximo, total de taxas pagas, distribuição BUY/SELL/HOLD, `% de fallback HOLD` e a comparação com buy & hold.

**Segurança e escopo**

11. Nenhuma chave privada, seed ou credencial em qualquer parte do repositório, log, CSV ou `raw/`; `data/` ignorado pelo git.
12. Nenhuma integração com corretora real ou testnet; nenhum dashboard; nenhuma dependência de runtime além do stdlib (salvo decisão explícita do item 6 da seção 7).

**Resultado do experimento** (o que o MVP precisa permitir responder)

13. Ao final de um run do período acordado, é possível afirmar com dados: quanto o Astra rendeu sobre US$ 100 líquido de custos, quantas decisões tomou, quantas foram inválidas e como isso se compara a simplesmente comprar e segurar o ativo.

O MVP **não** promete lucro nem valida a estratégia. Ele entrega a infraestrutura mínima, determinística e auditável para medi-la.
