# Análise técnica do GPTHEIST

## Escopo e evidência

- Repositório: `immortalhowwl/gptheist`
- Commit auditado: `2ad2e47b798341df4584edd68a6998e8c07c0618`
- Licença: MIT
- Data: 2026-09-17

Este documento separa fatos observados no código de inferências e decisões do AstraNovo.

## Resumo executivo — fato observado

GPTHEIST não implementa dez agentes de IA autônomos. Ele implementa dez responsabilidades nomeadas como etapas determinísticas e inspecionáveis. Não há cliente de LLM, prompts, chamadas a modelos, memória de agente, votação ou consenso.

Também não existe um trader funcional: não há carteira, saldo, posições, ordens, fills, P&L, benchmark nem execução paper. O objeto chamado `paperTrade` descreve uma entrada hipotética, mas fixa `executed: false`.

O produto possui duas trilhas que não formam um loop de trading:

1. **Replay offline:** fixture JSON → regras fixas → dez handoffs → PASS/VETO → JSONL.
2. **Desk ao vivo somente leitura:** RPC da Robinhood Chain → eventos Pons → leituras on-chain → score WATCH/VETO → interface web.

O Desk não alimenta automaticamente o replay, e WATCH não é BUY.

## Arquitetura real

### Replay

```text
fixture JSON
  → validateFixture
  → runSimulation
      → regras fixas/unsafe[]
      → 10 handoffs sintetizados
      → Palermo PASS/VETO
      → Professor aprovado/rejeitado
  → writeJsonlLog
```

Toda a deliberação ocorre em `src/simulation.ts`. As etapas não são objetos executáveis independentes: `runSimulation()` calcula previamente `unsafe[]` e constrói um array de dez mensagens.

### Desk ao vivo

```text
RPC público Robinhood Chain
  → TokenLaunched/PoolGraduated logs
  → validação de provenance
  → Multicall3 no mesmo bloco de snapshot
  → estado Pons + metadata declarada
  → assessPonsLaunch
  → WATCH/VETO + 10 handoffs descritivos
  → API HTTP/UI somente leitura
```

`src/live.ts` limita a janela a 25.000 blocos, ordena lançamentos, examina no máximo 24 e calcula histórico do deployer dentro da janela. `src/market.ts` valida formatos ABI, compara o registro da fábrica com o evento e pontua par, fase, reservas, impostos e progresso da curva. Evidência ausente falha fechada.

## Agentes — fato observado

No replay, todos recebem conceitualmente a mesma fixture imutável e os handoffs anteriores segundo a documentação. No código, porém, nenhuma etapa lê programaticamente a saída textual de outra: todas as mensagens são montadas em uma única lista.

| Ordem | Nome | Função codificada | Entrada efetiva | Saída | Veto |
|---:|---|---|---|---|---|
| 1 | TOKYO | enquadrar observação | market, price | INFO | não |
| 2 | BERLIN | declarar critérios | limites fixos no código | INFO | não |
| 3 | RIO | momentum | momentum | PASS/VETO | indicativo |
| 4 | DENVER | qualidade social | score e amostra | PASS/VETO | indicativo |
| 5 | LISBON | completude | dataComplete | PASS/VETO | indicativo |
| 6 | STOCKHOLM | liquidez/slippage/tamanho | três campos da fixture | PASS/VETO | indicativo |
| 7 | NAIROBI | resumo | tamanho de `unsafe[]` | INFO | não |
| 8 | HELSINKI | auditoria | runId | INFO | não |
| 9 | PALERMO | red-team | `unsafe[]` completo | PASS/VETO | efetivo |
| 10 | PROFESSOR | decisão final | resultado agregado | PASS/VETO | não pode reverter Palermo |

“Indicativo” significa que a etapa exibe VETO, mas não interrompe a cadeia. A rejeição final deriva de `unsafe.length !== 0`; Palermo espelha essa coleção. Professor não decide de forma independente.

## Prompts, modelos e contexto — fato observado

- Não existem prompts.
- Não existe integração com Astra ou qualquer LLM.
- Não existem parâmetros de modelo, temperatura ou tokens.
- Não há retry de resposta de IA nem schema de output de IA.
- Não há memória persistente ou conversacional.
- Não há estado compartilhado mutável entre agentes.
- Não há deliberação paralela.
- Não há votação.
- Não há capacidade de modificar decisões anteriores.
- Os handoffs são registros tipados com sequência, timestamp, agente, papel, resultado e mensagem.

## Regras do replay — fato observado

A aprovação exige simultaneamente:

- dados completos;
- preço maior que zero;
- momentum >= 0,55;
- socialSignal >= 0,50;
- ao menos 100 amostras sociais;
- liquidez >= US$1 milhão;
- slippage <= 25 bps;
- posição maior que zero e <= máximo;
- nenhuma risk flag.

Os números vêm da fixture; o programa não calcula momentum, sentimento, liquidez executável ou slippage.

A fixture aceita apenas schemaVersion 1, números finitos e timestamp UTC canônico. O run ID é SHA-256 truncado de policyVersion + fixture, com `riskFlags` ordenadas. Timestamps dos handoffs são determinísticos: instante observado + índice em segundos.

## Dados ao vivo — fato observado

- Chain ID: 4663.
- Fonte: endpoints JSON-RPC públicos da Robinhood Chain.
- Contrato observado: fábrica Pons v2 fixa.
- Eventos: `TokenLaunched` e `PoolGraduated`.
- Leituras: registro da fábrica, reservas, reserva real, imposto atual e metadata do token.
- As leituras de mercado são agrupadas via Multicall3 e fixadas ao head block do snapshot, reduzindo inconsistência temporal.
- Perfil público do X pode ser consultado via FxTwitter pela UI, com handle validado, timeout e cache.
- O perfil social não participa do score `assessPonsLaunch`.
- O código declara explicitamente que slippage executável e qualidade social permanecem desconhecidas.

## Persistência e replay — fato observado

O replay lê JSON local e grava `runs/<runId>.jsonl`. São dez registros de handoff e um registro final.

A escrita:

- cria arquivo com `wx` e permissão 0600;
- rejeita run ID fora do formato;
- exige caminho dentro do diretório;
- rejeita diretório/final path por symlink;
- aceita reexecução idêntica;
- recusa sobrescrever o mesmo ID com conteúdo diferente.

Não há banco, checkpoint, event sourcing de carteira ou restauração de execução.

## Segurança e tratamento de falhas — fato observado

Pontos fortes:

- nenhuma wallet, assinatura, chave privada ou rota de ordem;
- fail-closed para evidência on-chain indisponível;
- validação estrita de ABI e provenance;
- chamadas de leitura fixadas ao bloco;
- retries RPC limitados, timeout, rate spacing e cache de falhas;
- servidor local por padrão e headers defensivos;
- sanitização de controles de terminal;
- CI com permissões `contents: read`;
- testes negativos para schema, symlink, traversal, RPC e dados malformados.

Limitações:

- `fetchedAt` e timestamps live usam relógio atual, logo o Desk não é replay determinístico;
- score WATCH é heurístico e não validado como preditor;
- endpoint social é terceiro e apenas informativo;
- não há proteção criptográfica do JSONL;
- run ID de 64 bits truncados é adequado para demo, não uma identidade universal;
- ausência de execução torna impossível medir rentabilidade.

## Dependências e testes — fato observado

Runtime: apenas `viem`. Desenvolvimento: TypeScript e tipos Node. Node >=18, módulos ES, TypeScript estrito. Testes usam `node:test`.

A CI executa Node 18 e 20, `npm ci`, testes e `npm pack --dry-run`. Há testes de simulation, CLI, live market e servidor.

## O que é implementado versus apresentado

| Alegação/ideia | Situação no código |
|---|---|
| dez agentes | dez etapas determinísticas nomeadas |
| handoff | implementado como registros ordenados |
| qualquer agente pode matar | critérios alimentam coleção global; Palermo efetiva o veto |
| paper trading | apenas proposta hipotética, `executed=false` |
| mercado ao vivo | leitura de lançamentos Pons, não feed geral de trading |
| decisão de trading | PASS/VETO e WATCH/VETO; não BUY/SELL/HOLD completo |
| social analysis | não implementada na decisão; perfil público só na UI |
| liquidez/slippage | valores de fixture no replay; slippage executável desconhecida no live |
| auditoria | JSONL imutável local implementado |
| lucro/performance | não implementado nem demonstrável pelo repositório |

## Classificação para AstraNovo — recomendação nossa

### Reutilizar conceito

- contratos e schemas em runtime;
- handoffs/evidência explícitos;
- replay determinístico;
- fail-closed;
- veto incontornável;
- logs append-only/idempotentes;
- testes adversariais;
- snapshots temporais consistentes.

### Adaptar

- Palermo → veto de IA separado do Risk Manager determinístico;
- Professor → Final Decision Agent que produz proposta, nunca ordem;
- fixture → MarketSnapshot sem look-ahead;
- run ID → identidade de ciclo com versão de prompt/modelo/código;
- score WATCH → decisões estruturadas BUY/SELL/HOLD;
- agente único por papel → perfis configuráveis e comparáveis.

### Substituir

- regras fixas fingindo agentes → adaptadores reais de modelo com schema validado;
- posição percentual hipotética → PaperBroker, ledger e carteira;
- dados Pons específicos → interface genérica de market data;
- score heurístico sem validação → experimento com benchmarks e métricas.

### Descartar no MVP

- Desk visual e assets;
- servidor HTTP;
- branding/personagens;
- deploy Railway;
- FxTwitter;
- integração específica Robinhood/Pons, salvo experimento futuro separado.

## Conclusão

GPTHEIST é uma boa referência de fronteiras, validação, veto, replay e segurança defensiva. Não é evidência de um sistema de IA lucrativo nem uma base pronta de trading. AstraNovo deve preservar seus mecanismos verificáveis e construir separadamente aquilo que falta: agentes reais, proposta estruturada, Risk Manager independente, PaperBroker, carteira, custos e avaliação experimental.
