# Claude Code — instruções permanentes

Este repositório pertence ao projeto **Verificação de alegação cripto / AstraNovo**.

## Fonte de verdade

Antes de iniciar qualquer trabalho:

1. Sincronize o trabalho com a branch `main` sem sobrescrever alterações remotas.
2. Leia `docs/PROJECT_CONTEXT.md`.
3. Leia `docs/DECISIONS.md`.
4. Leia `docs/ARCHITECTURE.md`.
5. Leia `TASK.md`.
6. Execute somente a tarefa marcada como `READY`.

Quando `TASK.md` indicar documentos adicionais, a leitura também é obrigatória.

## Responsabilidades

- André é o proprietário e decide produto e mudanças de alto impacto.
- ChatGPT/GPT-5.6 Sol é arquiteto, especificador e revisor.
- Claude Code implementa, testa, commita e entrega por pull request.
- Astra será futuramente o motor de propostas de decisão.

## Regras obrigatórias

- A fase atual é exclusivamente paper trading.
- IA propõe; software valida; Risk Manager determinístico autoriza; Broker executa.
- Nunca fornecer chaves, seeds, tokens ou credenciais ao modelo.
- Não integrar corretora real, wallet, testnet, capital real ou rota de ordem sem autorização explícita.
- Não adicionar dashboard ou infraestrutura não solicitada.
- Não ampliar o escopo de `TASK.md`.
- Nunca sobrescrever alterações remotas; sincronize antes de trabalhar.
- Não alterar `TASK.md`; ele é controlado pelo arquiteto.
- Não commitar `.env`, segredos, tokens ou credenciais.
- Preserve a atribuição de código upstream.
- Execute todas as verificações descritas na tarefa.
- Se houver bloqueio ou ambiguidade material, pare e registre em `docs/coordination/CLAUDE_REPORT.md`.

## Entrega

1. Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos, testes, limitações e decisões.
2. Use a mensagem de commit definida em `TASK.md`.
3. Entregue as alterações na branch criada pela Claude Code Action; nunca faça push direto para `main`.
4. A automação abrirá ou reutilizará um pull request dessa branch para `main`.
5. Informe no relatório o hash completo do commit e os testes executados.

Claude não aprova nem mescla a própria tarefa. A aprovação e o merge são feitos pelo ChatGPT após revisão do diff e da CI.
