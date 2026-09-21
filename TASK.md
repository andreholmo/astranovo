# Tarefa atual

- **ID:** TASK-030
- **Milestone:** M4 — retry auditável e estritamente limitado
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_029.md`

## Objetivo

Criar a menor composição offline que execute tentativas auditáveis em sequência, somente enquanto a política permitir:

```text
AgentRetryPolicy + ids explícitos
→ runAuditableAgentAttempt (uma chamada por tentativa)
→ ACCEPTED | próxima tentativa | ATTEMPTS_EXHAUSTED
```

O fluxo deve parar imediatamente no primeiro `ACCEPTED` ou ao atingir `maxAttempts`. Somente uma resposta capturada e avaliada como `REJECTED` autoriza a tentativa seguinte. Falha anterior à captura continua falhando fechado e não pode provocar retry.

Não adicionar espera, backoff, timeout, relógio, geração de ID, persistência, HOLD, rede ou integração real.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/coordination/CHATGPT_REVIEW_TASK_029.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/agent/agent-adapter.ts`, `src/agent/retry-policy.ts`, `src/agent/decide-agent-attempt-progress.ts`, `src/agent/run-auditable-agent-attempt.ts`, `src/agent/evaluate-agent-response-capture.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/run-bounded-agent-attempts.ts`.

Defina `runBoundedAgentAttempts`, assíncrona, que recebe explicitamente:

- `adapter`;
- `request`;
- `policy`;
- `responseIds`, uma lista ordenada de IDs fornecidos pelo chamador;
- `promptVersion`;
- `model`.

Antes da primeira chamada ao adaptador:

1. valide fail-closed o objeto de entrada, `policy`, `request`, metadados e a lista inteira de `responseIds`;
2. exija que `responseIds.length === policy.maxAttempts`;
3. exija IDs válidos, distintos e na ordem fornecida; não gere, normalize ou deduza IDs;
4. rejeite entradas forjadas com `ContractValidationError` sanitizado, sem tocar o adaptador.

Na execução:

1. use `runAuditableAgentAttempt` como única fronteira de chamada e avaliação;
2. use `decideAgentAttemptProgress` para decidir, após cada avaliação, entre continuar, aceitar ou encerrar;
3. faça no máximo `policy.maxAttempts` chamadas e exatamente uma chamada por tentativa;
4. execute nova tentativa somente após uma avaliação `REJECTED`;
5. pare imediatamente no primeiro `ACCEPTED`;
6. se `runAuditableAgentAttempt` lançar por falha anterior à captura, propague somente o erro sanitizado e não tente novamente;
7. devolva um resultado imutável e fechado:
   - `ACCEPTED`: todas as avaliações realizadas, mais a avaliação aceita;
   - `ATTEMPTS_EXHAUSTED`: todas as avaliações rejeitadas e os códigos fechados na ordem;
8. preserve cada captura bruta byte a byte nas avaliações retornadas.

Não altere o contrato público de `runAuditableAgentAttempt`, `runSingleAgentAttempt`, `decideAgentAttemptProgress` ou `AgentRetryPolicy`.

## Testes obrigatórios

- aceita na primeira tentativa e não consome as demais respostas/IDs;
- rejeita uma vez e aceita na segunda, com exatamente duas chamadas;
- esgota políticas de 1, 2 e 3 tentativas sem exceder o limite;
- preserva avaliações, capturas brutas, ordem, IDs e códigos;
- jamais tenta novamente após exceção do adaptador ou resposta não-string;
- toda a entrada, inclusive todos os `responseIds`, é validada antes da primeira chamada;
- IDs ausentes, extras, duplicados, inválidos ou forjados falham fechado;
- política, request, adaptador, metadados e objeto de entrada forjados falham fechado quando aplicável;
- resultados, lista de avaliações e listas de códigos são congelados; entradas não são mutadas;
- mesmo adaptador sequencial determinístico e mesma entrada produzem resultado campo a campo idêntico;
- nenhuma chamada após `ACCEPTED` e nenhuma quarta chamada sob qualquer entrada;
- ausência de timer, delay, backoff, timeout, relógio, aleatoriedade, HTTP, SDK, ambiente, persistência e I/O;
- toda a suíte anterior continua verde.

Use nos testes um adaptador sequencial local e determinístico. Não amplie `StubAgentAdapter` nesta tarefa.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Não implementar backoff, espera, timeout, agendamento, concorrência, retry infinito, HOLD final, coordenador multiagente, persistência, logs externos, provider de mercado, integração Astra real, ordem, fill, Risk Manager, PaperBroker, ledger, banco, dashboard ou cloud.

Não usar HTTP, SDK externo, fila, timer, relógio, aleatoriedade, variável de ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora ou dinheiro real.

## Critérios de aceite

- retry somente após `REJECTED` auditável;
- parada imediata em `ACCEPTED` ou `ATTEMPTS_EXHAUSTED`;
- no máximo três chamadas, conforme política validada;
- nenhuma nova tentativa após falha sem captura;
- histórico completo e imutável das avaliações realizadas;
- nenhuma geração implícita de ID e nenhuma duplicação material da lógica existente;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: executa tentativas auditaveis limitadas`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
