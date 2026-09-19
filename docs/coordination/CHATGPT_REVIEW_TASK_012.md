# Revisão do ChatGPT — TASK-012

- **Tarefa:** TASK-012 — seleção de snapshot sem look-ahead para replay
- **PR:** #21
- **SHA revisado e aceito:** `fd82f759b71111fa609f028302567ea1dcbf0f81`
- **Merge squash:** `d73eff001e7ea98066c2f1f9c24a22f26614ecdf`
- **Data:** 2026-09-19
- **Resultado:** ACEITA SEM CORREÇÕES

## Verificação

A implementação cria `selectLatestAvailableSnapshot`, que valida todos os snapshots do par solicitado e seleciona somente o mais recente cujo `availableAt <= decisionAt`.

Foram confirmados:

- reutilização de `parseMarketSnapshot`;
- rejeição fail-closed quando não existe snapshot elegível;
- rejeição de empate no maior `availableAt`;
- validação de snapshots futuros do par antes de ignorá-los;
- independência da ordem de entrada;
- ausência de mutação;
- retorno validado e imutável;
- determinismo e ausência de relógio, rede, aleatoriedade ou I/O;
- nenhuma dependência runtime ou rota financeira real.

## CI

- Node.js 20: verde;
- Node.js 22: verde;
- `npm ci`, typecheck e testes: verdes;
- suíte final: 336 testes aprovados.

## Conclusão

TASK-012 aceita e incorporada à `main`. A próxima tarefa permanece em M3 e compõe essa primitiva em uma série cronológica de snapshots para replay, sem executar decisões ou ordens.
