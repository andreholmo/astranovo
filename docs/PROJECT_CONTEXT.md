# Verificação de alegação cripto — contexto do projeto

## Objetivo

Construir um experimento simples para verificar se uma IA consegue tomar decisões autônomas de trading com desempenho mensurável, começando com **100% de simulação e sem dinheiro real**.

Fluxo do MVP:

```text
dados reais de mercado → Astra → BUY / SELL / HOLD → carteira fictícia de US$100 → resultados
```

O objetivo inicial não é construir um produto completo. É descobrir, com dados e rastreabilidade, se a estratégia apresenta algum sinal de utilidade.

## Arquitetura conceitual

Astra será somente o motor de decisão. Software tradicional será responsável por:

- coleta dos dados reais de mercado;
- preparação e envio do contexto ao Astra;
- validação da resposta estruturada;
- Risk Manager determinístico;
- PaperBroker;
- carteira fictícia;
- logs e CSV;
- métricas de desempenho.

A IA não terá liberdade irrestrita. O Risk Manager deverá controlar progressivamente tamanho máximo de posição, perda diária, exposição, liquidez, slippage, allowlist e circuit breaker.

Nenhuma chave privada será entregue ao Astra.

## Fases autorizadas

1. Paper trading.
2. Testnet, somente após resultados interessantes e autorização.
3. Validação paralela.
4. Capital real muito pequeno, somente após nova decisão explícita.

A fase atual é exclusivamente a fase 1.

## Fora do escopo inicial

- corretora real;
- execução com dinheiro;
- testnet;
- dashboard;
- aplicação web;
- infraestrutura distribuída;
- otimizações prematuras;
- múltiplos agentes de trading;
- custódia ou gestão de chaves privadas.

## Responsabilidades

- **André:** proprietário e decisões de produto.
- **ChatGPT/GPT-5.6 Sol:** arquitetura, especificações, critérios de aceite, revisão de código, segurança e resultados.
- **Claude Code:** implementação, testes, commits e push.
- **Astra:** decisões futuras de BUY, SELL ou HOLD.

## GitHub

Repositório oficial: `andreholmo/astranovo`.

A conta `andresholmo` e seus repositórios não pertencem a este projeto.

## Fluxo de colaboração

```text
ChatGPT escreve TASK.md
        ↓
Claude sincroniza, implementa, testa e publica
        ↓
ChatGPT lê o commit e revisa
        ↓
Nova tarefa ou correção em TASK.md
```

O GitHub é o estado compartilhado. Decisões duráveis devem ser registradas no repositório.
