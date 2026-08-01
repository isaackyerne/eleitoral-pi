# Eleições Piauí 2018-2024 — base unificada

Star schema em Parquet, **5,3 MB** no total, cobrindo as eleições de 2018, 2020, 2022 e
2024 no Piauí. Substitui os quatro CSVs por ano (409 MB), que continuam existindo como
camada intermediária.

Gerado por `scripts/unifica.py` a partir de `dados/processados/eleicoes_pi_<ano>.csv` e
dos arquivos de candidatura do TSE em `dados/brutos_tse/`.

## Por que não é um arquivo só

Nos CSVs por ano, `QT_APTOS` fica na mesma linha que `QT_VOTOS` e os quatro dicionários
precisam avisar "deduplique por local antes de somar". Aqui os grãos são tabelas
separadas: **`QT_APTOS` não existe em `fato_votos`**. Somar a métrica errada vira erro de
coluna inexistente em vez de número inflado.

```
fato_votos        1.093.619   eleição × local × cargo × votável   QT_VOTOS, QT_VOTOS_NORM
fato_local_cargo     41.389   eleição × local × cargo             válidos, nominais, legenda, branco, nulo
fato_local           14.023   eleição × local                     aptos, comparecimento, abstenção
```

## Conferência contra o TSE

`fato_oficial_munzona` (2.771 linhas) traz os agregados **publicados pelo TSE**, do
arquivo `detalhe_votacao_munzona`, sem nenhuma derivação nossa. O grão é município ×
zona × cargo, mais grosso que o da base. **Para qualquer número que vá a público, é esta
a referência.**

Comparando a base com ela:

| Confere exatamente | Resíduo |
|---|---|
| Comparecimento e abstenções, nas 4 eleições ordinárias | — |
| Total de votos, brancos e nulos, em todos os cargos | — |
| Votos válidos oficiais em **11 das 15** combinações eleição × cargo | — |
| Aptos de 2018 | +7 eleitores (0,0003%) |
| Válidos: Vereador 2020 | +1.410 (0,07%) |
| Válidos: Dep. Federal 2022 | +127 (0,006%) |
| Válidos: Prefeito e Vereador 2024 | −6.428 e −4.658 (0,3% e 0,2%) |

O resíduo vem de `QT_VOTOS_VALIDOS_OFICIAL` ser **derivado**: o TSE publica a anulação
por município/zona, não por local, então a base decide candidatura a candidatura se o
voto entrou nos válidos. A regra acerta na esmagadora maioria, mas em 2024 há 57
candidaturas que recebem voto no Boletim de Urna e somem do arquivo oficial sem terem
sido anuladas — e nenhum campo publicado distingue esse caso de uma anulação real. A
suíte de validação trava o resíduo em 0,4%: qualquer piora derruba o pipeline.

## Qual denominador usar para percentual

`fato_local_cargo` traz **dois** totais de votos válidos, e a diferença entre eles não é
cosmética:

| Coluna | Definição |
|---|---|
| `QT_VOTOS_VALIDOS` | nominais + legenda, tudo que não é branco nem nulo |
| **`QT_VOTOS_VALIDOS_OFICIAL`** | idem, **menos os votos em candidatos com registro indeferido** — é a definição legal, e a que reproduz os percentuais publicados pelo TSE |

Em 2022, três candidatos a governador estavam com registro indeferido (Coronel Diego
Melo, Gessy Lima e Lourdes Melo) e somaram 30.721 votos. Pelo denominador simples,
Rafael Fonteles fica com 56,72%; pelo oficial, com os **57,62%** que o TSE publicou.
Total descontado por ano: 11.971 (2018), 12.533 (2020), 34.721 (2022).

Em 2024 o TSE não publica a situação do registro (o campo vem como `#NE`), então
`FL_CANDIDATURA_APTA` fica nulo e nada é descontado — as duas colunas são iguais nesse
ano. **Use `QT_VOTOS_VALIDOS_OFICIAL` como padrão.**

## Tabelas

| Tabela | Linhas | Grão |
|---|---:|---|
| `fato_votos` | 1.093.619 | eleição × local × cargo × votável |
| `fato_local_cargo` | 41.389 | eleição × local × cargo |
| `fato_local` | 14.023 | eleição × local |
| `dim_eleicao` | 9 | eleição (ano + turno + suplementar) |
| `dim_eleicao_cargo` | 17 | eleição × cargo — vagas e votos por eleitor |
| `dim_cargo` | 6 | cargo |
| `dim_municipio` | 224 | município |
| `dim_local` | 14.023 | local × eleição (dimensão que muda devagar) |
| `dim_local_atual` | 3.730 | local (identidade + geo de referência) |
| `dim_partido` | 38 | partido como entidade jurídica |
| `dim_partido_ano` | 117 | ano × número → partido |
| `dim_votavel` | 20.747 | votável dentro de uma eleição |
| `dim_politico` | 14.363 | pessoa, pelo título de eleitor |
| `fato_oficial_munzona` | 2.771 | agregados publicados pelo TSE (município × zona × cargo) |

## Como consultar

```python
import pandas as pd
U = 'dados/processados/unificado'
fv = pd.read_parquet(f'{U}/fato_votos.parquet')
de = pd.read_parquet(f'{U}/dim_eleicao.parquet')
dv = pd.read_parquet(f'{U}/dim_votavel.parquet')

# Sempre comece filtrando a série principal.
principal = de[de.FL_SERIE_PRINCIPAL]
```

`FL_SERIE_PRINCIPAL` é verdadeiro em exatamente 4 linhas — o 1º turno de cada eleição
ordinária. Um único predicado exclui as 5 suplementares e o 2º turno de 2020.

## Os quatro problemas que esta base resolve

**1. A chave de local não atravessava os anos.** `ID_LOCAL` ("município-zona-local")
quebra quando a zona é renumerada, e o PI foi de 82 para 74 zonas entre 2020 e 2022, com
27 municípios renumerados — dois deles indo e voltando (61→77→61→61). Só 2.861 dos 4.056
`ID_LOCAL` existiam nos quatro anos.

`SK_LOCAL` resolve isso em três passos: zona canônica (municípios de zona única viram 0),
agrupamento por número, e união por nome **vetando qualquer união entre grupos que
coexistam no mesmo ano**. Resultado: **3.730 locais, painel de 3.139 nos quatro anos,
zero fusões indevidas**. A cobertura de votos do painel sobe de ~89% para ~94,5% ao ano.

A tentação era usar (município, número do local), que dá números parecidos — mas o número
é namespaced por zona e 258-288 locais distintos por ano colidiriam. Em Campo Maior 2018,
zona 7 local 1031 é o SAAE e zona 96 local 1031 é a Escola Leonardo da Vinci.

**2. O número do partido muda de dono.** 20 era PSC até 2022 e virou Podemos em 2024; 25
era DEM e virou PRD; 44 era PRP e virou União Brasil. Agrupar por `NR_PARTIDO` funde
partidos diferentes. `SK_PARTIDO` identifica a entidade jurídica, e `dim_partido_ano`
mapeia (ano, número) → partido, com `FL_NUMERO_REATRIBUIDO` marcando as fronteiras.
O caso mais traiçoeiro é o Podemos, que **migrou do número 19 para o 20** — então
(2022, 19) e (2024, 20) são o mesmo partido, enquanto (2022, 20) é outro.

**3. Não havia identidade de pessoa.** `SQ_CANDIDATO` identifica uma candidatura, não uma
pessoa, e é 100% vazio em 2024. Números de urna são reciclados: 75% dos pares casados
entre 2020 e 2024 pelo trio (município, cargo, número) são pessoas diferentes.

`SK_POLITICO` usa o **título de eleitor** do candidato, dos arquivos de candidatura do
TSE. O CPF seria o natural, mas o TSE o suprime desde 2024 por proteção de dados (todas as
linhas trazem "-4"); o título continua completo e distinto nos quatro anos. Assim
Wellington Dias é a mesma pessoa em 2018 (governador) e 2022 (senador), apesar de o nome
aparecer com acento num ano e sem no outro.

**4. Os rótulos divergiam.** 2024 trazia nome de urna ("SILVIO MENDES"), os outros anos o
nome legal; legenda vinha como sigla em 2024 e nome completo antes; branco e nulo eram
"VOTO BRANCO"/"Branco". Agora `NM_VOTAVEL` é o **nome legal em todos os anos** (via
arquivos de candidatura), o nome de urna fica em `NM_URNA`, legenda usa o nome canônico do
partido, e branco/nulo têm duas linhas globais (`SK_VOTAVEL` -1 e -2) para serem uma série
única entre anos.

## Guardas de comparabilidade

**`QT_VOTOS_NORM` em vez de `QT_VOTOS`** quando comparar cargos ou anos. Senador teve
2 vagas em 2018 e cada eleitor votou duas vezes: o total do cargo (3.995.174) é o dobro do
comparecimento. `QT_VOTOS_NORM` divide por `QT_VOTOS_POR_ELEITOR` e sempre soma certo.

**Não compare volume entre esferas.** 2018 e 2022 são estaduais, 2020 e 2024 municipais —
`TP_ESFERA` em `dim_eleicao` marca isso. Prefeito e Governador não vão no mesmo eixo. Para
comparar os quatro anos, use participação (`PCT_COMPARECIMENTO`, `PCT_ABSTENCAO`), que é
comparável.

**Para séries por local, filtre `FL_PAINEL_COMPLETO`** em `dim_local_atual`: são os 3.139
locais presentes nos quatro anos, ~94,5% dos votos. Sem esse filtro, a variação entre anos
mistura mudança de eleitorado com abertura e fechamento de locais.

**Coordenadas: use `LATITUDE_REF`/`LONGITUDE_REF`** de `dim_local_atual`, não as de
`dim_local`. As coordenadas por ano vêm em duas safras de geocodificação ({2020, 2024}
batem em 94%, {2018, 2022} em 71%, cruzado 4-9%), com diferenças de 1 a 50 m que fariam o
mapa tremer ao trocar o ano. A referência é a do ano mais recente que tenha coordenada, e
cobre 97,4% dos locais. Os 148 locais com dispersão acima de ~2 km entre anos estão
marcados com `FL_GEO_DIVERGENTE`.

## Verificações que o pipeline aplica

Falha é fatal. Além de conservação de votos (27.637.538 no total, batendo por ano e cargo
com os arquivos brutos) e ausência de chave estrangeira nula, a suíte prova que não houve
fusão silenciosa:

- nenhum `SK_LOCAL` contém dois locais no mesmo ano; nenhum atravessa município
- `SK(2022,20) ≠ SK(2024,20)`, `SK(2018,44) ≠ SK(2022,44)`, `SK(2018,25) ≠ SK(2024,25)`
- `SK(2022,19) = SK(2024,20)` — o Podemos não pode ser partido em dois
- renomeações preservadas: `SK(2018,10) = SK(2024,10)` (PRB/Republicanos), idem PR/PL e PTC/AGIR
- nenhum político aparece duas vezes na mesma disputa
- `QT_APTOS = QT_COMPARECIMENTO + QT_ABSTENCAO`, e só as suplementares ficam sem eleitorado
- votos no cargo de voto único = comparecimento, em cada eleição ordinária
- agregados do TSE conferidos: comparecimento exato nas 4 ordinárias, válidos exatos em
  11 das 15 combinações eleição × cargo, resíduo travado em 0,4%
- resultados oficiais reproduzidos, pelo denominador legal: Wellington Dias 55,65%
  (2018), Dr. Pessoa 62,31% (2º turno 2020), Rafael Fonteles 57,62% (2022), Sílvio
  Mendes 52,19% (Teresina 2024)
- totais por ano/turno/cargo conferidos **direto dos zips originais**, sem passar pela
  camada intermediária: 40 verificações, todas batendo
- prefeituras por sigla canônica: 2020 PP 83 / PSD 40 / MDB 36 / PT 23; 2024 PSD 65 /
  MDB 57 / PT 50 / PP 34 — o teste que pegaria uma fusão PSC/Podemos

## Limites conhecidos

- **Sem 2º turno em 2024.** O arquivo de origem é o `bweb_1t`. Não houve 2º turno no PI
  em 2024 (Sílvio Mendes fez 52,19% em Teresina), então nada falta — mas se o TSE publicar
  um `bweb_2t` de outro ano, ele precisa entrar.
- **591 locais fora do painel** (3.730 − 3.139) são locais que abriram ou fecharam no
  período. Não é erro; é rotatividade real da rede de votação.
- **45 uniões de local rejeitadas** por coexistirem no mesmo ano estão em
  `scripts/referencia/locais_unioes_rejeitadas.csv`. São candidatas a revisão humana: em
  geral são dois prédios com o mesmo nome ("POSTO DE SAÚDE"), mas alguns podem ser salas
  distintas do mesmo local.
- **`dim_votavel` é por eleição, de propósito.** Para atravessar anos use `SK_POLITICO`,
  nunca `NR_VOTAVEL`.
- **Federação partidária** só é registrada em `SG_FEDERACAO` de `dim_votavel`, sem
  dimensão própria — só se aplica a 2022 e 2024.
