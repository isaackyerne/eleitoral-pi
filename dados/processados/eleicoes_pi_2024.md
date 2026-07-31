# Eleições Piauí 2024 — base consolidada

`eleicoes_pi_2024.csv` — 188.997 linhas × 47 colunas, UTF-8, separador `,`, decimal `.`

**Granularidade:** uma linha por *local de votação × cargo × votável*.
**Escopo:** 1º turno das Eleições Municipais de 06/10/2024, Piauí, cargos Prefeito e
Vereador, 224 municípios.

Não houve 2º turno no estado: Teresina é o único município acima de 200 mil eleitores
e Sílvio Mendes venceu ali com 52,19% dos votos válidos.

Gerado por `scripts/consolida_2024.py` a partir de `dados/2024/`.

## Origem diferente dos demais anos

O arquivo de votação de 2024 é o **Boletim de Urna Web** (`bweb_1t_PI`), não o
`votacao_secao` usado de 2018 a 2022. É a fonte mais completa do conjunto:

- `QT_APTOS`, `QT_COMPARECIMENTO` e `QT_ABSTENCOES` vêm medidos pela urna, por seção.
  Nos outros anos precisaram ser derivados do cadastro de eleitorado. Os dois valores
  conferem exatamente nas 9.233 seções — duas fontes independentes concordando.
- `NR_PARTIDO`, `SG_PARTIDO` e `NM_PARTIDO` são nativos. Nos outros anos o partido foi
  derivado do prefixo do número do votável.
- `TP_VOTO` (Nominal / Legenda / Branco / Nulo) vem pronto do campo `DS_TIPO_VOTAVEL`.

Em contrapartida, o boletim **não publica `SQ_CANDIDATO`** — a coluna existe no CSV,
sempre vazia, apenas para manter o mesmo esquema dos demais anos.

## Colunas

Mesmo desenho dos CSVs de 2020 e 2022, com duas colunas exclusivas de 2024:

| Coluna | Descrição |
|---|---|
| `SG_PARTIDO` | Sigla do partido (PT, MDB, PSD…). Só existe em 2024 |
| `QT_ELEITOR_BIOM_SEM_HABILITACAO` | Eleitores com biometria que não foram habilitados pelo leitor, somados por local (185.907 no estado) |

Diferenças de conteúdo específicas de 2024:

| Coluna | Observação para 2024 |
|---|---|
| `NR_TURNO` | Sempre 1 |
| `CD_CARGO`, `DS_CARGO` | Prefeito (11), Vereador (13) |
| `NR_ZONA` | 74 zonas |
| `NM_VOTAVEL` | **Nome de urna** ("SILVIO MENDES"), não o nome completo dos outros anos. Em votos de legenda traz a sigla do partido |
| `SQ_CANDIDATO` | Sempre vazio — ver acima |
| `NR_PARTIDO`, `NM_PARTIDO` | 27 partidos |
| `LATITUDE`, `LONGITUDE` | Nulas em apenas 25 locais (0,7%) — a melhor cobertura da série |
| `FL_APTOS_ESTIMADO` | Sempre `False` — os aptos vêm medidos pela urna |
| `FL_LOCAL_REMANEJADO` | `True` em 108 locais alterados após a eleição |
| `FL_ELEICAO_SUPLEMENTAR` | Sempre `False` |

## Cuidados de uso

**`NR_VOTAVEL` não identifica um candidato sozinho.** Como em 2020, a eleição é
municipal e o mesmo número se repete entre municípios com candidatos diferentes. Aqui
o problema é maior que em 2020, porque **não há `SQ_CANDIDATO` para desempatar** —
agrupe sempre incluindo `CD_MUNICIPIO`.

**Métricas de eleitorado repetem por linha.** `QT_APTOS`, `QT_COMPARECIMENTO`,
`QT_ABSTENCAO` e `QT_ELEITOR_BIOM_SEM_HABILITACAO` são atributos do local, replicados
em todas as suas linhas. Deduplique por `ID_LOCAL` antes de somar.

**Voto de legenda só existe em Vereador** (71.162 votos). Para ranking de candidatos,
filtre `TP_VOTO = 'Nominal'`; para desempenho partidário, inclua `Legenda`.

**Linhas com zero voto não existem** — a ausência de um candidato num local significa zero.

## Conferências aplicadas

- Soma de votos idêntica à do boletim (4.599.674); cada cargo soma 2.299.837, exatamente
  igual ao comparecimento
- `QT_APTOS = QT_COMPARECIMENTO + QT_ABSTENCAO` em todos os locais
- Aptos do boletim idênticos aos do cadastro de eleitorado nas 9.233 seções
- 224 municípios, 3.414 locais, todos com cadastro; nenhum com comparecimento acima dos aptos
- Participação: 85,22% (2.299.837 de 2.698.764 aptos) — a maior da série 2018-2024
- `PCT_VOTOS_VALIDOS` soma 100% por local × cargo (desvio máximo 0,007 p.p.)
- Teresina reproduz o oficial: Sílvio Mendes 52,19% × Fábio Novo 43,26%
- Prefeituras por partido: PSD 65, MDB 57, PT 50, PP 34
