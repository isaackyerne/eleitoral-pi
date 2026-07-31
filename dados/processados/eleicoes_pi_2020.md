# Eleições Piauí 2020 — base consolidada

`eleicoes_pi_2020.csv` — 211.659 linhas × 45 colunas, 83 MB, UTF-8, separador `,`, decimal `.`

**Granularidade:** uma linha por *eleição × turno × local de votação × cargo × votável*.
**Escopo:** Eleições Municipais de 15/11/2020 (1º turno, 224 municípios) e 29/11/2020
(2º turno, só Teresina), cargos Prefeito e Vereador. O arquivo inclui ainda 5 eleições
suplementares realizadas entre 2021 e 2024 — ver ressalva abaixo.

Gerado por `scripts/consolida_2020.py` a partir de `dados/2020/`.

## Colunas

Mesmo desenho de `eleicoes_pi_2018.csv`, com quatro colunas a mais para identificar a
eleição, já que este arquivo contém mais de uma.

| Coluna | Descrição |
|---|---|
| `ANO_ELEICAO`, `SG_UF` | Constantes: 2020, PI |
| `CD_ELEICAO`, `DS_ELEICAO`, `NM_TIPO_ELEICAO`, `DT_ELEICAO` | Identificação da eleição |
| `NR_TURNO` | 1 ou 2 (o 2º turno só existe em Teresina) |
| `CD_MUNICIPIO`, `NM_MUNICIPIO`, `NR_ZONA` | Município (224) e zona eleitoral (82) |
| `ID_LOCAL` | Chave do local: `municipio-zona-local`. **Use para agrupar por local** |
| `NR_LOCAL_VOTACAO`, `NM_LOCAL_VOTACAO`, `DS_TIPO_LOCAL` | Local de votação em 2020 (3.402 no 1º turno) |
| `DS_ENDERECO`, `NM_BAIRRO`, `NR_CEP`, `NR_TELEFONE_LOCAL` | Endereço e contato do local |
| `LATITUDE`, `LONGITUDE` | Coordenadas para mapa. Nulas em 55 locais (1,6%) |
| `DS_SITU_LOCAL_VOTACAO` | Situação cadastral do local |
| `QT_SECOES`, `QT_SECOES_AGREGADAS`, `QT_SECOES_ACESSIVEIS` | Seções do local |
| `CD_CARGO`, `DS_CARGO` | Prefeito (11), Vereador (13) |
| `TP_VOTO` | `Nominal`, `Legenda`, `Branco` ou `Nulo` |
| `NR_VOTAVEL`, `NM_VOTAVEL`, `SQ_CANDIDATO` | Identificação do votável (9.749 candidatos) |
| `NR_PARTIDO`, `NM_PARTIDO` | Partido (32). Nulo em branco/nulo |
| `QT_VOTOS` | Votos do votável naquele local e cargo |
| `QT_VOTOS_VALIDOS_LOCAL_CARGO` | Denominador: nominais + legenda |
| `QT_VOTOS_TOTAL_LOCAL_CARGO` | Denominador: todos os votos |
| `PCT_VOTOS_VALIDOS`, `PCT_VOTOS_TOTAL` | Percentuais já calculados |
| `QT_APTOS`, `QT_COMPARECIMENTO`, `QT_ABSTENCAO` | Eleitorado do local no turno (repetido nas linhas do local) |
| `PCT_COMPARECIMENTO`, `PCT_ABSTENCAO` | Percentuais de participação |
| `FL_APTOS_ESTIMADO` | Sempre `False` em 2020 (o campo de aptos veio completo) |
| `FL_LOCAL_REMANEJADO` | `True` onde o local mudou depois de 2020 — a geo pode apontar o destino |
| `FL_ELEICAO_SUPLEMENTAR` | `True` nas 5 eleições suplementares |

## Cuidados de uso

**Filtre as suplementares.** O arquivo do TSE embute eleições suplementares de
Juazeiro do Piauí (2021), Murici dos Portelas (2022), São Lourenço do Piauí (2023) e
Gilbués (2024) — 483 linhas, 0,2% do total. Elas são de anos posteriores e não têm
eleitorado correspondente (`QT_APTOS` nulo). **Para analisar a eleição de 2020, filtre
`FL_ELEICAO_SUPLEMENTAR = False`.** Sem esse filtro, quatro municípios aparecem com
resultados de dois pleitos somados.

**`NR_VOTAVEL` não identifica um candidato sozinho.** Ao contrário de 2018, aqui a
eleição é municipal: o número 13 aparece em 80 municípios com candidatos diferentes.
Use `SQ_CANDIDATO` como chave global, ou agrupe sempre incluindo `CD_MUNICIPIO`.

**Métricas de eleitorado repetem por linha.** `QT_APTOS`, `QT_COMPARECIMENTO` e
`QT_ABSTENCAO` são atributos do local naquele turno, replicados em todas as suas
linhas. Deduplique por `CD_ELEICAO` + `NR_TURNO` + `ID_LOCAL` antes de somar.

**Compare turnos separadamente.** O 2º turno cobre apenas Teresina; misturá-lo com o
1º turno duplica os votos da capital.

**Voto de legenda só existe em Vereador** (97.942 votos, `SQ_CANDIDATO` nulo). Para
ranking de candidatos, filtre `TP_VOTO = 'Nominal'`; para desempenho partidário,
inclua `Legenda`.

**Linhas com zero voto não existem** — a ausência de um candidato num local significa zero.

## Conferências aplicadas

- Soma de votos idêntica à do arquivo bruto por turno e cargo (4.593.905 no total)
- Eleição ordinária: 224 municípios, 3.402 locais no 1º turno, todos com cadastro e eleitorado
- Nenhum local com comparecimento acima dos aptos
- Participação: 84,58% no 1º turno (2.077.428 de 2.456.056) e 75,21% no 2º (420.177 de 558.661)
- `PCT_VOTOS_VALIDOS` soma 100% por local × cargo (desvio máximo 0,01 p.p., arredondamento)
- 2º turno de Teresina reproduz o oficial: Dr. Pessoa 62,31% × Kleber Montezuma 37,69%
- Prefeituras por partido (campo oficial `DS_SIT_TOT_TURNO` do TSE, contando um eleito por
  município): Progressistas 83, PSD 40, MDB 36, PT 23
