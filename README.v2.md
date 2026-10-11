# Eleições do Piauí — 2018 a 2026

Painel de dados eleitorais do Piauí, montado a partir dos dados abertos do
TSE. Cobre as cinco eleições ordinárias do período (2018 Estadual, 2020
Municipal, 2022 Estadual, 2024 Municipal, 2026 Estadual), sempre 1º turno —
eleições suplementares e o 2º turno de 2020 ficam de fora de propósito, pra não
inflar comparação entre anos.

Presidente (1º turno de 2018, 2022 e 2026) também está na base. O TSE publica esse
cargo só nos arquivos nacionais (`_BR`), então `scripts/extrai_presidente.py` tira
deles as linhas do Piauí antes de `consolida_<ano>.py`. O total de Presidente passa de
Governador por poucos votos: o voto em trânsito deixa eleitor de outra UF votar para
Presidente numa seção daqui. O 2º turno de Presidente não entra.

Todo o processamento roda no navegador: os dados vêm em Parquet e são lidos
direto por um DuckDB compilado pra Wasm, sem backend.

## Como rodar

```bash
npm install
npm run dev
```

Abre em `http://localhost:5173`. O comando `dev` já roda `npm run dados`
antes (via `predev`), que copia os `.parquet` de
`dados/processados/unificado/` pra `public/dados/` — é de lá que o app lê em
tempo de execução.

```bash
npm run build   # tsc -b && vite build (roda `dados` antes, via `prebuild`)
npm run lint
npm run preview # serve o build de dist/
```

## Deploy

Contínuo via Netlify, ligado ao GitHub. Não existe comando de deploy manual:
um `git push` pra `main` já dispara o build (`npm run build`) e publica.

## Stack

React 19 + TypeScript + Vite + Tailwind CSS 4, Zustand pra estado global,
DuckDB-Wasm pra consulta, Recharts pra gráfico, Leaflet (tiles CARTO
Positron, atribuição OpenStreetMap) pro mapa, ExcelJS pra exportação.

## Modelo de dados

Esquema estrela em `dados/processados/unificado/*.parquet`, com o
detalhamento completo (grão de cada tabela, chaves estáveis entre anos,
guardrails de consulta) em
[`eleicoes_pi_unificado.md`](dados/processados/unificado/eleicoes_pi_unificado.md).
Os três guardrails que toda consulta em `src/dados/consultas.ts` respeita:

- `FL_SERIE_PRINCIPAL` — só o 1º turno das 4 eleições ordinárias.
- `QT_VOTOS_NORM` em vez de `QT_VOTOS` — normaliza cargo com mais de uma
  vaga (Senador teve 2 em 2018).
- `SK_PARTIDO` em vez de `NR_PARTIDO` — o número de partido é reciclado
  entre eleições (20 era PSC até 2022, virou Podemos em 2024).

## Filtros globais

Eleição (com seletor de turno), Cargo, Município, Partido e Candidato —
combináveis, valem pra quase todos os painéis. Trocar Eleição ou Cargo
invalida o Candidato selecionado, já que `SK_VOTAVEL` só existe dentro do
(eleição, cargo) em que a candidatura foi gerada.

## Telas

**Visão geral** — todos os painéis abaixo empilhados, cada um com botão de
recolher (estado persiste entre sessões). **Mais votados** lista os 8
primeiros do recorte (10 quando o cargo é Deputado Estadual, Federal ou
Vereador — mais fragmentados), branco e nulo incluídos e ranqueados pelo
próprio quantitativo.

**Mapa** — dois modos:
- *Municípios*: coroplético por partido vencedor (cor fixa por partido) ou
  por comparecimento (rampa sequencial). Clicar num município aplica o
  filtro de Município.
- *Locais de votação*: um ponto por local. Passar o mouse mostra os 5 mais
  votados ali. Com Cargo = Governador, o comportamento muda: mostra os 2
  candidatos mais votados do estado inteiro e colore cada local pelo
  partido de quem venceu ali, com legenda dedicada.

**Participação** — comparecimento por eleição, Estadual x Municipal.

**Partidos** — ranking de partido mais votado, por ano; cor de cada partido
é fixa entre os anos (nunca troca com a posição no ranking). PT é sempre
vermelho (`#E4142C`) e PP sempre azul (`#234F74`), fixo em qualquer tema; os
demais partidos usam uma paleta categórica validada pra contraste e
daltonismo.

**Cruzamento** — compara território de 1 a 4 candidatos (de qualquer
eleição e cargo, não só os do filtro global), casados por local de votação.
PT e PP mantêm a mesma cor fixa aqui também — o candidato A tem prioridade
se dois da lista forem do mesmo partido; o segundo cai numa cor genérica pra
não repetir. Com 1 candidato mostra distribuição; com 2+ mostra o líder de
cada local.

**Tabela** e **Conferência** — por município, zona ou local; a Conferência
bate candidato × município no grão da totalização oficial do TSE (número de
urna incluso). As duas exportam pra `.xlsx` formatado (cabeçalho, largura de
coluna, formato numérico por tipo).

## Tema

Claro, escuro ou "sistema", com escuro como padrão. Os mapas (Mapa e
Cruzamento) ficam sempre no tema claro, independente da escolha — os tiles
do CARTO no escuro atrapalhavam a leitura da paleta categórica por cima.

---

*Este arquivo é a documentação do projeto; o `README.md` original (gerado
pelo template do Vite) foi mantido como está, sem alteração.*
