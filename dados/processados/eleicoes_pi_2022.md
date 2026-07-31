# Eleições Piauí 2022 — base consolidada

`eleicoes_pi_2022.csv` — 321.063 linhas × 45 colunas, UTF-8, separador `,`, decimal `.`

**Granularidade:** uma linha por *local de votação × cargo × votável*.
**Escopo:** 1º turno das Eleições Gerais Estaduais de 02/10/2022, Piauí, cargos
Governador, Senador, Deputado Federal e Deputado Estadual.

Não há 2º turno estadual: Rafael Fonteles foi eleito governador já no 1º turno, com
57,62% dos votos válidos. O 2º turno de 30/10/2022 foi apenas presidencial, e a
eleição presidencial está em outro arquivo do TSE, fora deste conjunto.

Gerado por `scripts/consolida_2022.py` a partir de `dados/2022/`.

## Colunas

Mesmo desenho de `eleicoes_pi_2020.csv` — as colunas e seus significados são idênticos.
Diferenças de conteúdo específicas de 2022:

| Coluna | Observação para 2022 |
|---|---|
| `NR_TURNO` | Sempre 1 |
| `CD_CARGO`, `DS_CARGO` | Governador (3), Senador (5), Deputado Federal (6), Deputado Estadual (7) |
| `NR_ZONA` | 74 zonas — menos que as 82 de 2018 e 2020, por reorganização da Justiça Eleitoral |
| `NR_PARTIDO`, `NM_PARTIDO` | 26 partidos |
| `LATITUDE`, `LONGITUDE` | Nulas em 127 locais (3,8%) |
| `FL_APTOS_ESTIMADO` | Sempre `False` — o campo de aptos veio completo |
| `FL_LOCAL_REMANEJADO` | Sempre `False` — nenhum local foi remanejado após a eleição |
| `FL_ELEICAO_SUPLEMENTAR` | Sempre `False` — não há suplementares neste arquivo |

**Normalização aplicada:** o arquivo bruto de 2022 traz os textos em caixa alta
(`GOVERNADOR`, `ELEIÇÃO ORDINÁRIA`). `DS_CARGO`, `DS_ELEICAO` e `NM_TIPO_ELEICAO`
foram convertidos para o mesmo padrão de 2018 e 2020, para que os anos possam ser
empilhados sem tratamento adicional. Nomes de candidatos seguem em caixa alta, como
nos demais anos.

**Origem do cadastro do local:** ao contrário de 2018 e 2020, o arquivo de votação de
2022 não traz nome nem endereço do local — ambos vêm do cadastro de eleitorado.

## Cuidados de uso

**Senador teve 1 vaga em 2022** (em 2018 foram 2). O total do cargo é igual ao
comparecimento, então aqui os quatro cargos são diretamente comparáveis entre si — o
que **não** vale para 2018.

**Métricas de eleitorado repetem por linha.** `QT_APTOS`, `QT_COMPARECIMENTO` e
`QT_ABSTENCAO` são atributos do local, replicados em todas as suas linhas. Deduplique
por `ID_LOCAL` antes de agregar.

**Voto de legenda existe só nos cargos proporcionais** (236.239 votos, `SQ_CANDIDATO`
nulo). Para ranking de candidatos, filtre `TP_VOTO = 'Nominal'`; para desempenho
partidário, inclua `Legenda`.

**Federações partidárias não estão identificadas.** Em 2022 havia federações
(PT/PCdoB/PV, PSDB/Cidadania, PSOL/Rede), mas o dado do TSE registra o partido
individual do candidato. Para analisar por federação é preciso agrupar manualmente.

**Linhas com zero voto não existem** — a ausência de um candidato num local significa zero.

## Conferências aplicadas

- Soma de votos idêntica à do arquivo bruto (8.456.024); os quatro cargos somam
  2.114.006 cada, igual ao comparecimento
- 224 municípios, 3.386 locais, todos com cadastro e eleitorado; nenhum com
  comparecimento acima dos aptos
- Participação: 82,30% (2.114.006 de 2.568.604 aptos)
- `PCT_VOTOS_VALIDOS` soma 100% por local × cargo (desvio máximo 0,004 p.p.)
- Governador: Rafael Fonteles 1.115.139 votos × Sílvio Mendes 811.806, idênticos ao
  oficial. **Atenção ao percentual:** `PCT_VOTOS_VALIDOS` deste CSV usa como denominador
  todos os votos nominais e dá 56,72%, enquanto o TSE publica 57,62% — a definição legal
  de voto válido exclui os três candidatos com registro indeferido (Coronel Diego Melo,
  Gessy Lima e Lourdes Melo, 30.721 votos). A base unificada traz
  `QT_VOTOS_VALIDOS_OFICIAL` já com esse desconto.
- Senador: Wellington Dias 51,34%, eleito para a vaga única
