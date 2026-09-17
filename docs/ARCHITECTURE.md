# Arquitetura mínima do Astra Paper Trader

## Objetivo

Testar, somente em paper trading, se decisões de agentes de IA apresentam sinal mensurável de vantagem após custos, comparadas a benchmarks simples.

## Princípio de autoridade

```text
MarketData → ContextBuilder → Agent(s) → ProposalValidator
→ AI Veto/Decision → Deterministic Risk Manager
→ PaperBroker → Portfolio/Ledger → Metrics
```

A IA propõe. O software valida. O Risk Manager autoriza ou bloqueia. Somente o PaperBroker altera a carteira.

## Modos experimentais previstos

- **MODE_A_REFERENCE:** pipeline sequencial inspirado nas dez responsabilidades do GPTHEIST, para comparação. Não implica copiar personagens nem fingir que regras são IAs.
- **MODE_B_OPTIMIZED:** conjunto menor de papéis especializados definido por evidência experimental.

A fundação deve permitir ambos, mas nenhum deles será completo na primeira tarefa.

## Agentes iniciais

O sistema nasce configurável para N agentes. A configuração de demonstração terá seis perfis, cada um com carteira isolada de US$100:

1. trend-following;
2. mean-reversion;
3. breakout;
4. momentum;
5. volatility-filtered;
6. conservative-baseline.

Nesta etapa, “perfil” é configuração. A especialização real por prompt entra depois dos contratos e do replay.

Para um pipeline cooperativo futuro, os papéis candidatos são Market Evidence, Technical, Liquidity, Skeptic, Position e Final Decision. Eles serão definidos após testes, não por estética.

## Componentes

| Componente | Responsabilidade | Não pode |
|---|---|---|
| MarketDataProvider | fornecer snapshots com instante de disponibilidade | expor candle futuro |
| ContextBuilder | montar contexto versionado e limitado | inventar campos ausentes |
| AgentAdapter | chamar modelo e devolver output bruto | acessar broker/carteira mutável |
| ProposalValidator | validar schema e semântica | interpretar texto ambíguo como ordem |
| DecisionCoordinator | ordenar agentes/handoffs e consolidar proposta | ignorar veto |
| RiskManager | aplicar limites determinísticos | usar LLM |
| Broker | interface de execução | conter estratégia |
| PaperBroker | simular spread, fee, slippage e fill | usar credenciais reais |
| Portfolio/Ledger | caixa, posições e fonte contábil | aceitar saldo/posição negativos |
| AuditLog | registrar evidência append-only | reescrever execução divergente |
| Metrics | P&L, equity, drawdown, trades, win rate e custos | alterar estado |
| Benchmark | cash, buy-and-hold e aleatório controlado | receber vantagem temporal |

## Contratos principais

### MarketSnapshot

Deve incluir schemaVersion, snapshotId, asOf, availableAt, source, asset, quote, preço executável/estimado, spread, candles fechados e indicadores calculados apenas com dados disponíveis até `availableAt`.

Regra anti-look-ahead: candle aberto não pode fornecer close/high/low finais. Em replay, cada feature carrega ou herda um `availableAt`.

### AgentProposal

```json
{
  "schemaVersion": 1,
  "agentId": "trend-01",
  "cycleId": "...",
  "action": "BUY",
  "asset": "BTC",
  "confidence": 0.73,
  "positionPct": 0.08,
  "reason": "resumo curto",
  "veto": false,
  "evidenceIds": ["..."],
  "promptVersion": "...",
  "model": "..."
}
```

Semântica:

- BUY: `positionPct` é percentual do caixa/equity elegível definido pela política;
- SELL: percentual da posição atual;
- HOLD: exatamente zero;
- output inválido falha fechado para HOLD/rejeição; retry é limitado e auditado;
- `confidence` nunca substitui regra de risco.

### RiskDecision

Contém proposalId, approved, action final, size permitido, códigos de regra, limites usados e policyVersion. Uma rejeição não pode ser revertida pelo coordenador.

### Fill

Contém orderId, cycleId, agentId, side, quantidade, preço de referência, spread, slippage, fee, preço final e timestamp. Apenas fills alteram a contabilidade.

## Estado e persistência

Fonte de verdade inicial:

- configuração imutável do run;
- snapshots usados;
- propostas e decisões;
- fills append-only;
- eventos de caixa;
- versões de prompt/modelo/política/commit.

Portfolio snapshots são derivados/cache. A carteira deve poder ser reconstruída pelos eventos e fills.

SQLite pode ser adotado quando o vertical slice precisar de consultas e transações; JSONL é suficiente para a fundação/replay inicial. CSV é exportação, não fonte de verdade.

## Risk Manager configurável

Controles previstos:

- máximo por posição;
- exposição total;
- caixa disponível;
- máximo de posições;
- perda diária;
- drawdown;
- trades por janela;
- cooldown;
- allowlist;
- snapshot freshness;
- spread/slippage máximo;
- liquidez mínima;
- circuit breaker.

Defaults serão conservadores e experimentais. O veto determinístico prevalece sobre qualquer veto/aprovação de IA.

## Custos e execução paper

O PaperBroker aplicará:

- fee configurável;
- metade do spread ou modelo explícito;
- slippage determinístico baseado em política/dados disponíveis;
- rejeição quando não houver evidência suficiente;
- sem short no MVP, salvo decisão futura.

Não existe preenchimento perfeito gratuito.

## Reprodutibilidade

Cada ciclo registra:

- snapshot bruto e normalizado;
- contexto exato;
- respostas brutas e validadas;
- ordem/handoffs/vetos;
- proposal e RiskDecision;
- portfolio antes/depois;
- fill/custos;
- versões de modelo, prompt, política e commit.

Mesmo input canônico e versões iguais devem produzir IDs iguais. Chamadas reais de LLM podem não ser determinísticas; por isso a resposta bruta é persistida e o replay posterior não chama o modelo.

## Falhas seguras

- dado ausente/antigo → sem trade;
- output inválido → retry limitado, depois HOLD;
- timeout do agente → registra falha e isola o agente;
- Risk Manager indisponível → bloqueia;
- persistência falha antes do fill → bloqueia;
- agente falha → demais carteiras continuam;
- duplicação de cycle/order ID → idempotência, nunca fill duplicado.

## Fronteiras futuras

`Broker` permite PaperBroker agora e adaptadores futuros. Testnet/LiveBroker não serão criados nesta fase. Se um dia existirem, credenciais ficarão em serviço de execução isolado e nunca em contexto de modelo.

## Fora do MVP inicial

Dashboard, login, web app, cloud, banco distribuído, wallet, blockchain real, testnet, live broker, otimização automática e automação ChatGPT↔Claude.
