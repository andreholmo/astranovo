# Tarefa atual

- **ID:** TASK-001
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Tipo:** planejamento técnico
- **Escopo:** documentação, sem implementar o trader

## Objetivo

Produzir um plano técnico mínimo e executável para o MVP de paper trading descrito em `docs/PROJECT_CONTEXT.md`.

## Entregável

Criar `docs/MVP_IMPLEMENTATION_PLAN.md` contendo:

1. arquitetura mínima e fluxo ponta a ponta;
2. estrutura de diretórios proposta;
3. contratos de dados para mercado, decisão do Astra, ordem, execução simulada, posição e snapshot da carteira;
4. ordem incremental de implementação;
5. estratégia de testes;
6. riscos técnicos e hipóteses que precisam ser validadas;
7. escolhas que dependem de decisão de André;
8. definição objetiva de “MVP concluído”.

O plano deve privilegiar Python simples, execução local, arquivos locais/CSV e poucas dependências. Não propor dashboard, banco externo, filas, microsserviços, corretora real ou testnet.

## Critérios de aceite

- Nenhum código de trading implementado.
- Nenhuma dependência adicionada.
- Nenhum segredo ou credencial.
- O plano permite implementar e testar cada componente isoladamente.
- BUY, SELL e HOLD possuem contratos estruturados e validáveis.
- Risk Manager e PaperBroker permanecem determinísticos.
- Capital inicial fixado em US$100.
- Custos, slippage e falhas do modelo são tratados explicitamente.
- `docs/coordination/CLAUDE_REPORT.md` registra o trabalho realizado.

## Validação

- Conferir que os arquivos Markdown renderizam corretamente.
- Conferir que apenas documentação foi adicionada.
- Executar `git diff --check`.

## Commit

`docs: planeja MVP do Astra Paper Trader`
