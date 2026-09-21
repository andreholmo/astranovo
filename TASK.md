# Tarefa atual

- **ID:** TASK-028
- **Milestone:** M4 — decisão pura de progresso de tentativas
- **Status:** READY
- **Responsável:** Claude Code
- **Revisor:** ChatGPT/GPT-5.6 Sol
- **Base:** `main` após `docs/coordination/CHATGPT_REVIEW_TASK_027.md`

## Objetivo

Criar a menor máquina de estados pura que, a partir de avaliações auditáveis já realizadas e da política limitada existente, determine se há tentativa disponível, aceitação final ou esgotamento seguro.

`[] → ATTEMPT_AVAILABLE`
`[REJECTED...] → ATTEMPT_AVAILABLE | ATTEMPTS_EXHAUSTED`
`[..., ACCEPTED] → ACCEPTED`

Não deve chamar adaptador, executar tentativa, fazer retry, produzir HOLD, persistir nem acionar qualquer integração. Ela somente decide o próximo estado permitido.

## Leitura obrigatória

Leia integralmente `CLAUDE.md`, os documentos de arquitetura, decisões e roadmap, `docs/coordination/CHATGPT_REVIEW_TASK_027.md`, `docs/coordination/CLAUDE_REPORT.md`, `src/agent/evaluate-agent-response-capture.ts`, `src/agent/retry-policy.ts`, `src/agent/capture-agent-response.ts`, `src/domain/contracts.ts` e esta tarefa.

## Escopo exato

Crie `src/agent/decide-agent-attempt-progress.ts`.

Defina uma função síncrona, pura e determinística que recebe uma política de retry e uma lista readonly de resultados de `evaluateAgentResponseCapture`, e:

1. revalida fail-closed a política pelo validador existente e reavalia/valida cada captura; não confia em objetos estruturalmente forjados;
2. exige que todas as capturas pertençam exatamente ao mesmo `agentId`, `cycleId`, `promptVersion` e `model`;
3. rejeita lista com mais resultados que `maxAttempts`;
4. rejeita qualquer resultado após um `ACCEPTED`;
5. devolve união discriminada imutável e fechada:
   - `ATTEMPT_AVAILABLE`: `completedAttempts`, `maxAttempts` e, quando houver, o último código seguro de rejeição;
   - `ACCEPTED`: o resultado aceito validado e a contagem de tentativas concluídas;
   - `ATTEMPTS_EXHAUSTED`: `completedAttempts`, `maxAttempts` e somente códigos seguros de rejeição, sem texto bruto.
6. nunca inclui `rawResponse`, mensagem, stack, cause, token, segredo ou valor arbitrário em erro ou código.

A entrada vazia representa nenhuma tentativa executada e deve retornar `ATTEMPT_AVAILABLE`. O resultado aceito pode preservar sua captura auditável apenas no payload `ACCEPTED`; os dois demais resultados não devem expor captura bruta.

## Testes obrigatórios

- lista vazia, primeira tentativa disponível e contagem correta;
- rejeições abaixo do limite, no limite e acima do limite;
- aceitação na primeira e após rejeições;
- tentativa após `ACCEPTED` falha fechado;
- políticas inválidas, avaliações/capturas forjadas e proveniência divergente falham fechado;
- nenhum erro ou estado não aceito expõe resposta bruta, token, segredo ou valor arbitrário;
- união de resultados, política e entradas preservadas/congeladas conforme contratos;
- ausência de mutação e determinismo;
- prova offline de ausência de chamada de adaptador, retry executado, timer, relógio, aleatoriedade, rede e I/O.

## Documentação

Atualize o README apenas no necessário e registre a entrega em `docs/coordination/CLAUDE_REPORT.md`.

## Fora do escopo

Não implementar execução de tentativa, loop de retry, backoff, timeout, HOLD final, coordenador multiagente, persistência, logs externos, provider de mercado, ordem, fill, Risk Manager, PaperBroker, ledger, banco, dashboard ou integração Astra real.

Não usar HTTP, SDK externo, fila, concorrência, timer, delay, relógio, aleatoriedade, ambiente, token, segredo, credencial, wallet, blockchain, testnet, corretora, dinheiro real ou cloud.

## Critérios de aceite

- transições limitadas e seguras derivadas apenas de avaliações auditáveis e política validada;
- entrada forjada, inconsistente ou posterior a aceitação falha fechado;
- nenhuma informação arbitrária aparece em erros ou estados não aceitos;
- nenhuma tentativa é executada por este componente;
- `npm ci`, typecheck, build e testes passam;
- CI verde em Node.js 20 e 22;
- nenhuma rede, credencial ou rota financeira real.

## Entrega

Faça um único commit com a mensagem `feat: decide progresso de tentativas de agente`, push em branch própria e deixe a automação abrir o PR para `main`. Inclua resumo, testes e referência à issue. Não aprove nem mescle o próprio trabalho e não altere o status desta tarefa.
