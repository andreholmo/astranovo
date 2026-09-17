# Base de adaptação: GPTHEIST

## Origem fixada

- Repositório: `immortalhowwl/gptheist`
- URL: https://github.com/immortalhowwl/gptheist
- Commit analisado e fixado: `2ad2e47b798341df4584edd68a6998e8c07c0618`
- Licença: MIT, copyright (c) 2026 immortalhowwl
- Data da análise: 2026-09-17

Qualquer código copiado ou derivado deve preservar o aviso de copyright e a licença MIT. O projeto deve registrar a procedência em `THIRD_PARTY_NOTICES.md`.

## O que o projeto original realmente é

GPTHEIST implementa um pipeline determinístico de dez responsabilidades para avaliar um cenário de mercado. Os “agentes” atuais são etapas de regras, não processos de IA. A entrada de replay é JSON local; o resultado é uma decisão paper-only; Palermo possui veto; Professor coordena a decisão final; o rastro é gravado em JSONL imutável.

O modo Desk lê dados públicos da Robinhood Chain, mas não possui carteira, chave privada, assinatura, corretora nem execução de ordens. O próprio README esclarece que não é backtester nem calculadora de lucro.

## Decisão de adaptação

AstraNovo será uma adaptação do padrão de segurança e coordenação do GPTHEIST, não uma simples troca de nomes e nem uma cópia da interface visual.

A unidade “agente” do nosso experimento será diferente: cada agente é um competidor autônomo com estratégia, orçamento e carteira fictícia próprios. A quantidade será configurável; a configuração inicial terá seis agentes, sem limite codificado em seis.

Cada ciclo terá:

1. snapshot de mercado;
2. proposta BUY, SELL ou HOLD do agente;
3. validação determinística;
4. veto ou aprovação pelo Risk Manager;
5. execução exclusivamente pelo PaperBroker;
6. atualização da carteira fictícia;
7. auditoria append-only e métricas.

O modelo/Astra jamais terá acesso direto ao PaperBroker, a credenciais, a chaves privadas ou a qualquer caminho de execução real.

## Componentes reaproveitados conceitualmente

| GPTHEIST | AstraNovo |
|---|---|
| Fixture validada | Snapshot de mercado validado e reproduzível |
| Handoff ordenado | Envelope tipado entre decisão, risco e broker |
| Palermo veto | Risk Manager determinístico e incontornável |
| Professor paper-only | Orquestrador que só pode solicitar PaperBroker |
| JSONL imutável | Ledger/auditoria append-only por execução |
| Run ID determinístico | IDs idempotentes de ciclo e ordem |
| Replay offline | Replay determinístico para testes |
| Testes de entradas malformadas | Testes de schema, limites, idempotência e segurança |
| Fail closed | Dados ausentes, antigos ou inválidos geram HOLD/veto |

## O que não será importado para o núcleo do MVP

- Desk visual e assets temáticos;
- integração específica com Robinhood Chain/Pons;
- servidor HTTP;
- consulta social via FxTwitter;
- nomes fixos dos dez personagens;
- afirmação de que regras determinísticas são agentes de IA;
- qualquer wallet, testnet ou execução real.

Esses elementos não ajudam a responder a primeira pergunta do experimento: os agentes conseguem produzir resultado em paper trading?

## Arquitetura inicial

- `config/agents.json`: registro configurável, inicialmente com seis agentes e orçamento definido pelo proprietário antes de cada experimento;
- `src/domain`: tipos e invariantes;
- `src/market`: interface de dados reais e fixtures/replay;
- `src/agents`: interface do motor Astra e adaptadores simulados para teste;
- `src/risk`: regras determinísticas e veto;
- `src/broker`: PaperBroker, fills simulados, taxas e slippage;
- `src/portfolio`: caixa e posições isolados por agente;
- `src/orchestrator`: ciclos e isolamento de falhas;
- `src/audit`: eventos JSONL append-only;
- `src/metrics`: P&L, retorno, drawdown e exposição;
- `tests`: testes unitários, integração e replay.

## Restrições não negociáveis do MVP

- somente simulação;
- nenhuma dependência de corretora, wallet ou chave privada;
- nenhuma rota de código para ordem real;
- saldo nunca pode ficar negativo;
- agente nunca pode gastar além do orçamento/carteira;
- SELL nunca pode exceder a posição;
- Risk Manager não pode ser ignorado;
- falha de um agente não interrompe os demais;
- decisões e fills devem ser reproduzíveis em replay;
- segredos não entram em logs, fixtures ou prompts;
- rentabilidade não é prometida: o sistema mede uma hipótese.

## Estratégia de incorporação

A primeira implementação deve portar apenas o núcleo útil, com atribuição, para uma base TypeScript testável. Código copiado deve ser identificável na revisão. O import não deve trazer o Desk nem a integração live específica. Depois da baseline verde, as etapas seguintes adicionam carteira multiagente, PaperBroker, Risk Manager e adaptador Astra em incrementos revisáveis.
