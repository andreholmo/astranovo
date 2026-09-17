# AstraNovo

Experimento de trading autônomo multiagente, **exclusivamente em paper trading**.

> ⚠️ **Paper-only.** Este repositório não contém wallet, chave privada, credencial,
> integração com corretora, testnet ou qualquer rota de execução financeira. Nada aqui
> movimenta dinheiro real. Sair dessa fronteira exige decisão explícita do proprietário,
> registrada em `docs/DECISIONS.md`.

## O que existe hoje

Milestone **M0 — Fundação e contratos**. O repositório contém:

- `src/domain/contracts.ts` — contratos centrais (`AgentConfig`, `MarketSnapshot`,
  `AgentProposal`) com validação em runtime;
- `src/config/load-agents.ts` — carregamento e validação da configuração de N agentes;
- `config/agents.json` — seis perfis de demonstração, cada um com US$100 fictícios;
- `tests/` — testes offline e determinísticos.

Ainda **não** existem: coleta de mercado, chamada de modelo, orquestrador, Risk Manager,
PaperBroker, carteira, métricas, servidor ou banco de dados. O roadmap está em
`docs/ROADMAP.md`.

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

## Documentação

`docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`,
`docs/GPTHEIST_ANALYSIS.md`. Atribuição de terceiros em `THIRD_PARTY_NOTICES.md`.
