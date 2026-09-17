# Claude Code — instruções permanentes

Este repositório pertence ao projeto **Verificação de alegação cripto**.

## Fonte de verdade

Antes de iniciar qualquer trabalho:

1. Execute `git pull --ff-only origin main`.
2. Leia `docs/PROJECT_CONTEXT.md`.
3. Leia `TASK.md`.
4. Execute somente a tarefa marcada como `READY`.

## Responsabilidades

- André é o proprietário e decide produto.
- ChatGPT/GPT-5.6 Sol é arquiteto, especificador e revisor.
- Claude Code é o engenheiro responsável por implementar, testar, commitar e fazer push.
- Astra será o motor de decisão de trading.

## Regras obrigatórias

- O MVP é exclusivamente paper trading. Não integrar corretora real, testnet ou capital real sem nova autorização explícita.
- Nunca fornecer chaves privadas, seeds ou credenciais ao Astra.
- Não adicionar dashboard ou infraestrutura não solicitada.
- Não ampliar o escopo definido em `TASK.md`.
- Nunca sobrescrever alterações remotas: sincronize antes de trabalhar.
- Não alterar `TASK.md`; ele é controlado pelo arquiteto.
- Não commitar segredos, arquivos `.env`, tokens ou credenciais.
- Execute os testes e verificações descritos na tarefa.
- Se houver bloqueio ou ambiguidade material, não improvise: registre em `docs/coordination/CLAUDE_REPORT.md`.

## Entrega

Ao concluir:

1. Atualize `docs/coordination/CLAUDE_REPORT.md` com resumo, arquivos alterados, testes, limitações e decisões pendentes.
2. Faça commit usando a mensagem definida em `TASK.md`.
3. Faça push para `origin main`.
4. Informe o hash completo do commit.

Não marque a tarefa como aprovada. A aprovação é feita pelo ChatGPT após revisar o commit.
