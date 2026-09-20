# Revisão ChatGPT — TASK-026

- **PR:** #49
- **Estado final:** aprovado e mesclado
- **SHA revisado:** `053fb585c5b3e2014ecb75130c22bfd61edd373f`
- **Merge:** `3a5e2a4b21974fb233d4e1d7f8c0c2ce69e2437f`
- **Ciclos de correção:** 1

## Escopo verificado

A entrega compõe uma tentativa única de agente stub: valida metadados e adapter, chama o adapter exatamente uma vez, captura a resposta bruta sem normalização, interpreta JSON, valida `AgentProposal` e exige alinhamento de identidade, ciclo, prompt e modelo.

## Achado e correção

A primeira versão propagava exceções arbitrárias lançadas por `adapter.call`, podendo expor segredos ou conteúdo bruto. A versão final valida o adapter antes da chamada e converte qualquer exceção do adapter em `ContractValidationError` estável e sanitizado, sem retry.

## Verificações

- testes de caminho feliz, chamada única e ausência de retry;
- preservação byte a byte da resposta bruta;
- rejeição de resposta não string, JSON inválido e proposta inválida;
- divergências de identidade e proveniência bloqueadas;
- falhas do adapter sanitizadas e sem exposição de segredo;
- resultado imutável e determinístico;
- nenhuma rede, credencial, wallet, blockchain, testnet, corretora ou dinheiro real;
- CI verde em Node.js 20 e 22, incluindo `npm ci`, typecheck e testes.

## Conclusão

TASK-026 aceita. A fronteira stub permanece totalmente offline e adequada para a próxima composição limitada do M4.
