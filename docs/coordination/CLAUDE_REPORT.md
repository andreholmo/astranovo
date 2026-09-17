# Relatório do Claude Code

## TASK-002 — Fundação tipada do AstraNovo (M0)

- **ID da tarefa:** TASK-002
- **Milestone:** M0 — Fundação e contratos
- **Status reportado:** executada, aguardando revisão do ChatGPT/GPT-5.6 Sol (não aprovada por mim)
- **Data:** 2026-09-17

## Resumo da entrega

Baseline Node.js 20+ / TypeScript estrito com configuração de N agentes, os três contratos centrais e validação em runtime. Nenhum trading, LLM, mercado ao vivo, Risk Manager ou broker foi implementado.

### Leitura obrigatória cumprida

`CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/GPTHEIST_ANALYSIS.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md` e `docs/coordination/CHATGPT_REVIEW_TASK_001.md`. O upstream `immortalhowwl/gptheist@2ad2e47b798341df4584edd68a6998e8c07c0618` foi clonado e inspecionado localmente (fora do repositório) para observar os padrões de `package.json`, `tsconfig.json`, CI e validadores em `src/simulation.ts`. O Desk, o servidor e a integração Pons não foram lidos para reuso nem copiados.

## Arquivos alterados

| Arquivo | Ação |
|---|---|
| `package.json` | criado |
| `package-lock.json` | criado |
| `tsconfig.json` | criado |
| `.gitignore` | criado |
| `src/domain/contracts.ts` | criado |
| `src/config/load-agents.ts` | criado |
| `config/agents.json` | criado |
| `tests/contracts.test.ts` | criado |
| `tests/load-agents.test.ts` | criado |
| `.github/workflows/ci.yml` | criado |
| `THIRD_PARTY_NOTICES.md` | criado |
| `README.md` | substituído (instalação, testes, aviso paper-only, contratos) |
| `docs/coordination/CLAUDE_REPORT.md` | atualizado |

`TASK.md` não foi alterado.

## Contratos implementados

Todos em `src/domain/contracts.ts`, sem I/O, sem relógio e sem aleatoriedade.

- **`AgentConfig`** — `id` (slug único), `name`, `strategy` (slug), `enabled`, `initialBudgetUsd` (finito e positivo), `mode` (`reference | optimized`).
- **`MarketSnapshot`** — `schemaVersion: 1`, `snapshotId`, `source`, `asset`, `quote`, `asOf`, `availableAt`, `price` (finito e positivo), `spreadBps` (finito e não negativo), `complete`. Invariante temporal `availableAt >= asOf` documentada no tipo e no README: somente informação disponível até `availableAt` pode entrar em uma decisão.
- **`AgentProposal`** — `schemaVersion: 1`, `proposalId`, `cycleId`, `agentId`, `action` (`BUY | SELL | HOLD`), `asset`, `confidence` ∈ [0,1], `positionPct` ∈ [0,1], `reason`, `veto`, `evidenceIds`, `promptVersion`, `model`. Semântica: `HOLD` exige `positionPct = 0`; `BUY` é fração do caixa/equity elegível; `SELL` é fração da posição atual. Texto livre nunca é interpretado.

### Rejeições implementadas e testadas

Campos ausentes; tipos errados; `NaN`/`Infinity`; strings vazias, em branco, acima do limite ou com caracteres de controle; slugs e símbolos malformados; IDs duplicados; lista de agentes vazia; timestamps não canônicos (sem milissegundos, com offset `+00:00`, minúsculas, data inexistente como `2026-02-30`); violação temporal (`availableAt < asOf`); enum desconhecido (`hybrid`, `buy`, `LONG`); `HOLD` com tamanho diferente de zero; percentuais fora de [0,1]; `evidenceIds` acima do máximo, duplicados, malformados ou não-array.

### Comportamento dos erros

`ContractValidationError` carrega `contract`, `field` e `requirement`. A mensagem nomeia o campo e o requisito violado e **nunca reproduz o valor recebido** — há teste que prova que o valor rejeitado não aparece na mensagem. `describeContractError()` devolve uma linha única, sem stack, e reporta erros inesperados de forma genérica para não vazar mensagem de origem desconhecida.

### Não-mutação

Os três parsers devolvem cópias congeladas contendo apenas os campos declarados; campos desconhecidos são descartados, não propagados. Há teste de não-mutação (`structuredClone` antes/depois) para cada contrato e para o roster.

## Configuração de agentes

`config/agents.json` traz exatamente seis agentes habilitados, todos com `initialBudgetUsd: 100`: `trend-following`, `mean-reversion`, `breakout`, `momentum`, `volatility-filtered`, `conservative-baseline`. Nenhum dos dez nomes do upstream foi usado.

`src/config/load-agents.ts` não contém limite de seis. Há teste que adiciona um sétimo agente sem tocar em código, teste com um único agente e teste com `MAX_AGENTS` agentes.

## Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` (após `rm -rf node_modules dist`) | 3 pacotes, 0 vulnerabilidades |
| `npm run typecheck` (`tsc --noEmit`, estrito) | sem erros |
| `npm test` (`tsc` + `node --test dist/tests/*.test.js`) | **74 testes, 74 passaram, 0 falharam** |
| `git diff --cached --check` | sem erros de whitespace |

Ambiente local: Node v22.17.0, npm 10.9.2. A CI roda Node 20 e 22.

A suíte é offline (nenhum acesso de rede) e determinística (nenhuma leitura de relógio; o limite temporal opcional de `parseMarketSnapshot` é injetado pelo chamador via `notAfter`). Os testes de leitura de disco criam e removem diretórios temporários em `os.tmpdir()`.

## Decisões técnicas tomadas

1. **Zero dependências de runtime.** Validadores escritos à mão, como a tarefa autoriza. `typescript` e `@types/node` são as únicas dependências de desenvolvimento.
2. **`BUY`/`SELL` com `positionPct = 0` são rejeitados.** A tarefa exige apenas `HOLD = 0`; estendi a regra porque uma ordem de tamanho zero é indistinguível de `HOLD` no efeito mas não na intenção, e D-003 manda o validador recusar ambiguidade em vez de interpretá-la. Se o revisor preferir aceitar, é uma linha e um teste.
3. **Timestamp canônico obrigatório** (`2026-09-17T18:00:00.000Z`), verificado por round-trip `new Date(epoch).toISOString() === valor`. Grafias alternativas do mesmo instante são recusadas para que dois runs nunca discordem sobre igualdade de timestamps.
4. **`notAfter` opcional em `parseMarketSnapshot`.** Permite rejeitar snapshot "do futuro" sem que o módulo leia o relógio, preservando determinismo e replay (D-009).
5. **`MAX_AGENTS = 1000`.** Limite de sanidade de recurso, não de design; documentado como tal e coberto por teste nos dois lados da fronteira.
6. **Todos os seis agentes nascem em `mode: "reference"`.** MODE_A_REFERENCE é a baseline de comparação; há teste provando que um roster misto `reference`/`optimized` é aceito, então D-007 continua aberto.
7. **`"license": "UNLICENSED"` no `package.json`.** O repositório não tem arquivo `LICENSE`; declarar MIT sem o texto seria incorreto. A licença do projeto é decisão de André.
8. **CI com `permissions: contents: read`** e actions fixadas por SHA, matriz Node 20 e 22, rodando `npm ci`, `npm run typecheck` e `npm test`.

## Atribuição upstream

`THIRD_PARTY_NOTICES.md` registra repositório, commit auditado, autor, licença MIT com texto integral, o que foi aproveitado (padrões de validação, timestamp canônico por round-trip, limites explícitos, fail-closed, `node:test`, TS estrito, CI de permissão mínima) e o que foi deliberadamente descartado (Desk, servidor, assets, personagens, Pons/Robinhood, FxTwitter, Railway). **Nenhum arquivo de código do upstream foi copiado.** Os SHAs fixados das actions de CI vieram do commit auditado e isso está declarado.

## Conformidade com as restrições

Não foram criados: decisão stub, orquestrador, Risk Manager, PaperBroker, carteira/ledger, métricas, coleta de mercado, chamada Astra/LLM, servidor, dashboard, banco, wallet, testnet, exchange ou execução real. Não existe rota de execução financeira no repositório. Não há `.env`, segredo, token ou credencial; `.gitignore` cobre `node_modules/`, `dist/`, `data/`, `runs/`, `.env` e `.env.*`.

## Limitações conhecidas

- `strategy` é apenas um slug de configuração: não existe comportamento associado a ele nesta milestone.
- `mode` é registrado, mas nenhum pipeline consome a distinção ainda.
- `MarketSnapshot` cobre um único preço de referência e um spread. Candles, indicadores e o `availableAt` por feature previstos em `docs/ARCHITECTURE.md` entram quando o replay exigir.
- `veto` é validado como booleano; a semântica de consolidação é do DecisionCoordinator (M2+).
- Não há fixtures de mercado nem teste de replay: dependem de M1/M3.
- Os testes de carga de arquivo usam o diretório temporário do sistema; são offline, mas tocam o disco.
- Houve um incidente de ferramenta durante a escrita: sequências `\uXXXX` dos padrões de caractere de controle foram gravadas como bytes de controle reais em dois arquivos. Detectado por varredura, corrigido, e os arquivos versionados foram reverificados byte a byte — nenhum byte de controle restante em nenhum arquivo do repositório.

## Decisões pendentes para André / revisor

1. **Aceitar ou não `BUY`/`SELL` com `positionPct = 0`** (decisão técnica nº 2 acima).
2. **Licença do projeto** — hoje `UNLICENSED`, sem arquivo `LICENSE`.
3. **Modo inicial dos seis agentes** — todos em `reference`; a divisão MODE_A/MODE_B para o experimento de M6 é decisão do arquiteto.
4. **Política de `positionPct` em `BUY`** — "fração do caixa/equity elegível" está documentada, mas a definição exata de *elegível* pertence ao Risk Manager (M2).
5. **Versões de Node na CI** — hoje 20 e 22.

## Bloqueios ou ambiguidades materiais

Nenhum bloqueio. A única ambiguidade material encontrada (tamanho zero em `BUY`/`SELL`) foi resolvida pelo lado restritivo, está documentada acima e é trivialmente reversível.

## Commit

- **Mensagem:** `feat: cria fundacao tipada do AstraNovo`
- **Hash:** informado a André na resposta após o push.

A aprovação desta tarefa cabe ao ChatGPT/GPT-5.6 Sol, após revisão do commit.
