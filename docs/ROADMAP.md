# Roadmap experimental

## M0 — Fundação e contratos

Scaffold TypeScript, schemas runtime, configuração de N agentes, fixtures e testes. Sem LLM, mercado ao vivo ou broker.

## M1 — Ledger, carteira e PaperBroker

Carteiras isoladas, fills append-only, BUY/SELL/HOLD, fees, spread, slippage, idempotência e reconstrução contábil.

## M2 — Risk Manager

Regras configuráveis, veto determinístico, circuit breaker e testes de invariantes.

## M3 — Replay e métricas

Ciclos históricos sem look-ahead, P&L, drawdown, win rate, custos e benchmarks cash/buy-and-hold.

## M4 — Adaptador Astra stub e real

Schema de proposta, retry controlado, captura da resposta bruta, versão de prompt/modelo. Primeiro stub; integração real somente quando o acesso estiver definido.

## M5 — Dados reais em paper trading

Provider escolhido e validado, snapshots auditáveis, execução contínua por algumas semanas.

## M6 — Comparação multiagente

Seis perfis iniciais e comparação MODE_A_REFERENCE versus MODE_B_OPTIMIZED.

## Gates posteriores

Testnet, shadow mode e capital real são fases distintas, bloqueadas por decisão de André e evidência reproduzível. Nenhuma milestone avança automaticamente.
