# Registro de decisões

## D-001 — Estado compartilhado

GitHub `andreholmo/astranovo` é a fonte de verdade entre André, ChatGPT e Claude Code. `TASK.md` contém somente a tarefa liberada; Claude registra entrega no relatório e não aprova o próprio trabalho.

## D-002 — Segurança financeira

Fase atual é paper-only. Não existem wallet, private key, testnet, corretora ou rota de execução real. Qualquer mudança requer decisão explícita de André.

## D-003 — Separação de autoridade

IA produz proposta estruturada. Validador rejeita ambiguidade. Risk Manager determinístico prevalece. Somente PaperBroker pode produzir fills e alterar a carteira.

## D-004 — Natureza do GPTHEIST

GPTHEIST é referência conceitual e de segurança, não prova de rentabilidade nem implementação de agentes LLM. Base auditada: `immortalhowwl/gptheist@2ad2e47b798341df4584edd68a6998e8c07c0618`.

## D-005 — Linguagem

A nova baseline será Node.js 20+ com TypeScript estrito, alinhada ao upstream auditado. O plano Python anterior permanece histórico e não governa a implementação.

## D-006 — Multiagente

A quantidade de agentes é configurável. A configuração inicial contém seis perfis, cada um com orçamento/carteira isolados de US$100 para demonstração. Não haverá limite codificado em seis.

## D-007 — Dois modos experimentais

A arquitetura preserva a possibilidade de MODE_A_REFERENCE, semelhante ao pipeline GPTHEIST, e MODE_B_OPTIMIZED. A fundação não antecipa qual vencerá.

## D-008 — Persistência contábil

Fills e eventos append-only serão a fonte de verdade; snapshots de carteira são derivados. Reexecução não pode duplicar fills.

## D-009 — Look-ahead

Todo dado/feature precisa respeitar o instante em que estava disponível. Testes de replay devem provar que dados futuros não entram na decisão.

## D-010 — Complexidade

Cada milestone deve responder a uma necessidade experimental atual. Dashboard, cloud, live execution e automação entre agentes ficam adiados.
