# Revisão ChatGPT — TASK-001

- **Commit revisado:** `498d13db6b6ca44c3fd436b3f7b0dadc2d18e39f`
- **Veredito:** APROVADA COM OBSERVAÇÕES
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Data:** 2026-09-17

## Verificação do escopo

O commit alterou somente:

- `docs/MVP_IMPLEMENTATION_PLAN.md`;
- `docs/coordination/CLAUDE_REPORT.md`.

Não adicionou código, dependências, integração real, testnet, dashboard ou credenciais. A mensagem do commit corresponde à especificação.

## Avaliação técnica

O plano atende aos critérios da TASK-001:

- arquitetura local, síncrona e auditável;
- separação clara entre Astra e controles determinísticos;
- contratos estruturados para BUY, SELL e HOLD;
- capital inicial de US$ 100;
- Risk Manager e PaperBroker determinísticos;
- custos, slippage e falhas tratados explicitamente;
- persistência local e journal append-only;
- estratégia offline de testes e replay;
- definição objetiva de MVP concluído.

Pontos especialmente bons:

1. fronteira explícita de não-determinismo;
2. fallback seguro para HOLD;
3. uso de `Decimal` e invariantes contábeis;
4. prevenção de look-ahead bias;
5. comparação com benchmark;
6. análise de sensibilidade com custos dobrados;
7. nenhuma chave privada acessível ao Astra.

## Observações obrigatórias para a implementação

Estas observações não bloqueiam a aprovação do plano, mas devem ser resolvidas antes dos respectivos módulos:

1. **Semântica de `size_pct`:**
   - em BUY, deve representar percentual do caixa/equity elegível;
   - em SELL, deve representar percentual da posição atual, não do capital;
   - em HOLD, deve ser exatamente zero.
   A regra precisa constar no contrato e nos testes.

2. **Benchmark buy-and-hold:**
   - usar os mesmos US$ 100;
   - comprar no primeiro preço executável do run;
   - aplicar as mesmas taxas e slippage da estratégia;
   - manter até o último preço executável;
   - registrar claramente o instante inicial e final.

3. **Integridade do journal:**
   - cada linha deve ter versão de schema e identificador do run, ou esses dados devem ser inequivocamente recuperáveis pelo diretório e pelo `run.json`;
   - escrita deve usar flush e, quando aplicável, operação atômica para snapshots de estado.

4. **Idempotência do tick:**
   - reprocessar o mesmo `tick_id` não pode duplicar ordens ou fills;
   - o runner deve detectar tick já concluído e recusar ou retomar de forma determinística.

5. **Fonte de verdade contábil:**
   - definir se a carteira é reconstruída pelos fills append-only ou carregada de snapshot;
   - snapshots são cache/derivação; fills e configuração do run devem permitir reconstrução e auditoria.

## Decisões do proprietário ainda necessárias

Antes da primeira integração real de dados/modelo:

- ativo e par;
- fonte de dados;
- acesso ao Astra;
- cadência e duração inicial;
- custos e limites de risco;
- dependências e versão do Python.

A implementação do esqueleto e dos contratos pode começar depois que as decisões fundamentais forem registradas na próxima tarefa.
