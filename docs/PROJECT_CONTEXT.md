# AstraNovo — contexto do projeto

## Objetivo

Construir um experimento mensurável de trading autônomo multiagente, começando exclusivamente em simulação:

```text
dados reais → agentes/Astra → BUY/SELL/HOLD estruturado
→ Risk Manager determinístico → PaperBroker
→ carteiras fictícias → auditoria e métricas
```

A pergunta inicial é: decisões de agentes apresentam algum sinal de vantagem após custos, contra benchmarks simples? Viralidade ou alegações públicas não contam como evidência.

## Estado atual

O repositório contém documentação e coordenação. A implementação do trader ainda não começou. A referência GPTHEIST foi auditada no commit `2ad2e47b798341df4584edd68a6998e8c07c0618`; os resultados estão em `docs/GPTHEIST_ANALYSIS.md`.

## Princípio de autoridade

- IA decide/propõe.
- Software valida.
- Risk Manager determinístico autoriza ou bloqueia.
- Broker executa.
- Somente fills alteram a carteira.

A IA nunca acessa credenciais, wallet, chave privada ou execução direta.

## Multiagente

A quantidade de agentes é configurável. O primeiro conjunto demonstrativo terá seis perfis com carteiras isoladas e US$100 fictícios por agente. O proprietário poderá definir os orçamentos antes de cada experimento.

Dois modos devem permanecer possíveis:

- MODE_A_REFERENCE: pipeline comparável à estrutura do GPTHEIST;
- MODE_B_OPTIMIZED: arquitetura especializada desenvolvida por nós.

## Fase autorizada

Somente paper trading. Testnet, shadow mode e capital real exigem fases posteriores e autorização explícita.

## Fora do escopo atual

Dashboard, app, login, cloud, banco distribuído, wallet, corretora, testnet, execução blockchain, dinheiro real e automação completa ChatGPT↔Claude.

## Responsabilidades

- André: proprietário; decide mudanças grandes, custos relevantes, credenciais, corretora/blockchain e ações irreversíveis.
- ChatGPT/GPT-5.6 Sol: arquiteto, pesquisador, especificador, tech lead e revisor.
- Claude Code: implementa tarefas READY, testa, registra relatório, faz commit e push.
- Astra: futuramente produz propostas de decisão estruturadas.
- Software determinístico: validação, risco, execução paper, carteira, logs e métricas.

## Documentos de referência

1. `docs/GPTHEIST_ANALYSIS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/DECISIONS.md`
4. `docs/ROADMAP.md`
5. `TASK.md`

O plano Python anterior é histórico. As decisões atuais em `docs/DECISIONS.md` prevalecem.

## Fluxo de colaboração

ChatGPT publica especificação → Claude sincroniza/implementa/testa/push → ChatGPT revisa o commit → nova tarefa ou correção.

GitHub `andreholmo/astranovo` é o único estado compartilhado autorizado.
