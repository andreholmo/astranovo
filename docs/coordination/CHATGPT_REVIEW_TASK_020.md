# Revisão ChatGPT — TASK-020

- **PR:** #37
- **Head revisado:** `4d1247195f9821cbd029bda683c1947bb926ee25`
- **Merge:** `23ea39d7b88431981fa8833107517e4de1623cb3`
- **Resultado:** ACEITO
- **Ciclos de correção:** 1/3

## Verificações

- exatamente um BUY e um SELL integrais, do mesmo agente, ativo, quote, escala e quantidade;
- timestamps canônicos, com fechamento estritamente posterior à abertura;
- cálculo exato de WIN, LOSS e BREAK_EVEN exclusivamente sobre `totalMicros`;
- coerência contábil fail-closed de `grossMicros ± feeMicros === totalMicros`;
- proteção contra fee de SELL maior que o gross;
- resultado imutável, determinístico e sem mutação das entradas;
- ausência de agregação, posição parcial, FIFO/LIFO ou short;
- nenhuma wallet externa, blockchain, testnet, corretora, credencial ou dinheiro real;
- CI verde em Node.js 20 e 22;
- 485 testes informados pela entrega.

## Correção solicitada

O primeiro SHA aceitava fills internamente inconsistentes. O Claude corrigiu a validação no SHA final, adicionou três testes regressivos e preservou o cálculo do resultado exclusivamente sobre `totalMicros`, sem dupla contagem de fee.

## Conclusão

A TASK-020 atende aos critérios de aceite e permanece integralmente no domínio de simulação. O PR foi mesclado por squash após revisão do SHA acima.
