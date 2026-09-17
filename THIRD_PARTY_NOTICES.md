# Third-party notices

## GPTHEIST

- **Repositório:** `immortalhowwl/gptheist` — https://github.com/immortalhowwl/gptheist
- **Commit auditado:** `2ad2e47b798341df4584edd68a6998e8c07c0618`
- **Licença:** MIT
- **Autor:** immortalhowwl
- **Auditoria:** `docs/GPTHEIST_ANALYSIS.md`

### O que foi aproveitado

Nenhum arquivo de código do GPTHEIST foi copiado para este repositório. O que foi
aproveitado é o **padrão de engenharia** observado durante a auditoria do commit acima,
aplicado aqui em código original:

- validação explícita em runtime, com helpers por tipo de campo (string limitada, número
  finito, enum), em vez de dependência de schema em runtime;
- timestamps ISO-8601 UTC canônicos verificados por round-trip (`new Date(epoch).toISOString()`),
  rejeitando grafias alternativas do mesmo instante;
- limites superiores explícitos para strings e arrays;
- rejeição de caracteres de controle em texto;
- postura *fail-closed*: evidência ausente ou ambígua é recusada em vez de interpretada;
- testes adversariais com `node:test`, sem runner de terceiros;
- TypeScript estrito com `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes`;
- CI com `permissions: contents: read` e actions fixadas por SHA.

O arquivo `.github/workflows/ci.yml` deste repositório usa os mesmos SHAs fixados de
`actions/checkout` e `actions/setup-node` observados no commit auditado.

### O que foi deliberadamente não aproveitado

Conforme `docs/GPTHEIST_ANALYSIS.md` e `docs/DECISIONS.md` (D-004): o Desk visual, o
servidor HTTP, os assets, o branding e os dez personagens, a integração Robinhood
Chain/Pons, o FxTwitter e o deploy Railway. As regras fixas que o upstream apresenta como
agentes não foram reproduzidas — o AstraNovo separa proposta de IA, validação determinística
e Risk Manager.

### Licença MIT do GPTHEIST

```text
MIT License

Copyright (c) 2026 immortalhowwl

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Dependências

Este projeto não possui dependências de runtime. As dependências de desenvolvimento são
`typescript` e `@types/node`, ambas sob licenças Apache-2.0 e MIT respectivamente, obtidas
via npm e não redistribuídas aqui.
