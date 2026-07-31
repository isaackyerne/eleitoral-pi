# Eleições Piauí 2018 — base consolidada

`eleicoes_pi_2018.csv` — 371.900 linhas × 41 colunas, 126 MB, UTF-8, separador `,`, decimal `.`

**Granularidade:** uma linha por *local de votação × cargo × votável*.
**Escopo:** 1º turno das Eleições Gerais Estaduais de 07/10/2018, Piauí. Não há 2º turno
estadual (o governo foi decidido em 1º turno) e a eleição presidencial está em outro
arquivo do TSE, fora deste conjunto.

Gerado por `scripts/consolida_2018.py` a partir de `dados/2018/`.

## Colunas

| Coluna | Descrição |
|---|---|
| `ANO_ELEICAO`, `NR_TURNO`, `DT_ELEICAO`, `SG_UF` | Constantes: 2018, 1, 2018-10-07, PI |
| `CD_MUNICIPIO`, `NM_MUNICIPIO` | Código TSE e nome do município (224 municípios) |
| `NR_ZONA` | Zona eleitoral (82 zonas) |
| `ID_LOCAL` | Chave do local: `municipio-zona-local`. **Use esta coluna para agrupar por local** |
| `NR_LOCAL_VOTACAO`, `NM_LOCAL_VOTACAO`, `DS_TIPO_LOCAL` | Local de votação em 2018 (3.464 locais) |
| `DS_ENDERECO`, `NM_BAIRRO`, `NR_CEP`, `NR_TELEFONE_LOCAL` | Endereço e contato do local |
| `LATITUDE`, `LONGITUDE` | Coordenadas para mapa. Nulas em 185 locais (5,3%) |
| `DS_SITU_LOCAL_VOTACAO` | Situação cadastral do local |
| `QT_SECOES`, `QT_SECOES_AGREGADAS`, `QT_SECOES_ACESSIVEIS` | Seções do local |
| `CD_CARGO`, `DS_CARGO` | Governador (3), Senador (5), Deputado Federal (6), Deputado Estadual (7) |
| `TP_VOTO` | `Nominal`, `Legenda`, `Branco` ou `Nulo` |
| `NR_VOTAVEL`, `NM_VOTAVEL`, `SQ_CANDIDATO` | Identificação do votável |
| `NR_PARTIDO`, `NM_PARTIDO` | Partido (33 partidos). Nulo em branco/nulo |
| `QT_VOTOS` | Votos do votável naquele local e cargo |
| `QT_VOTOS_VALIDOS_LOCAL_CARGO` | Denominador: nominais + legenda do local/cargo |
| `QT_VOTOS_TOTAL_LOCAL_CARGO` | Denominador: todos os votos do local/cargo |
| `PCT_VOTOS_VALIDOS`, `PCT_VOTOS_TOTAL` | Percentuais já calculados |
| `QT_APTOS`, `QT_COMPARECIMENTO`, `QT_ABSTENCAO` | Eleitorado do local (repetido em todas as linhas do local) |
| `PCT_COMPARECIMENTO`, `PCT_ABSTENCAO` | Percentuais de participação |
| `FL_APTOS_ESTIMADO` | `True` em 12 locais cujo total de aptos foi reconstruído |
| `FL_LOCAL_REMANEJADO` | `True` onde o local mudou depois de 2018 — a geo pode apontar o destino |

## Cuidados de uso

**Métricas de eleitorado repetem por linha.** `QT_APTOS`, `QT_COMPARECIMENTO` e
`QT_ABSTENCAO` são atributos do local, replicados em todas as suas linhas. Somá-las
direto infla o resultado — deduplique por `ID_LOCAL` antes de agregar.

**Senador teve 2 vagas.** Cada eleitor votou duas vezes, então o total do cargo
(3.995.174) é o dobro do comparecimento. Não compare o volume de Senador com o dos
demais cargos sem dividir por 2.

**Comparecimento vem do cargo Governador** (voto único), por isso equivale ao total de
comparecimentos: 1.997.587 sobre 2.370.017 aptos, ou 84,29%.

**Voto de legenda existe só nos cargos proporcionais.** São 309.102 votos em que o
eleitor escolheu o partido, não um candidato; `SQ_CANDIDATO` é nulo. Para ranking de
candidatos, filtre `TP_VOTO = 'Nominal'`; para desempenho partidário, inclua `Legenda`.

**Linhas com zero voto não existem.** O TSE só publica combinações com pelo menos um
voto, então a ausência de um candidato num local significa zero.

## Conferências aplicadas

- Soma de votos idêntica à do arquivo bruto em todos os cargos (9.987.935)
- 3.464 locais, todos com cadastro e eleitorado; nenhum com comparecimento acima dos aptos
- `PCT_VOTOS_VALIDOS` soma 100% por local × cargo (desvio máximo 0,004 p.p., arredondamento)
- Ranking de Governador reproduz o oficial: Wellington Dias 55,65% dos válidos
