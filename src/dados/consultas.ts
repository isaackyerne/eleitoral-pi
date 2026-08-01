import { clausulas, type Filtros } from '../estado/filtros'
import { consulta } from './duckdb'

/**
 * Consultas do painel.
 *
 * Os três guardrails do modelo aparecem em toda consulta e não são opcionais:
 *
 *  - `dim_eleicao.FL_SERIE_PRINCIPAL` — 4 linhas, o 1º turno de cada eleição
 *    ordinária. Sem esse filtro entram as 5 suplementares e o 2º turno de 2020,
 *    e Teresina passa a contar duas vezes.
 *  - `QT_VOTOS_NORM` em vez de `QT_VOTOS` — Senador teve 2 vagas em 2018 e cada
 *    eleitor votou duas vezes.
 *  - `SK_PARTIDO` em vez de `NR_PARTIDO` — o número 20 era PSC até 2022 e virou
 *    Podemos em 2024; agrupar por número funde partidos diferentes.
 *
 * O join canônico do fato é sempre o mesmo, então vale nomear.
 */
const FATO = `
  FROM fato_votos f
  JOIN dim_eleicao e USING (SK_ELEICAO)
  JOIN dim_votavel v USING (SK_VOTAVEL)
  JOIN dim_local   l ON l.SK_LOCAL = f.SK_LOCAL AND l.SK_ELEICAO = f.SK_ELEICAO
`

// ─── opções dos filtros ──────────────────────────────────────────────────

export type OpcaoEleicao = {
  SK_ELEICAO: number; ANO_ELEICAO: number; DS_ELEICAO: string; TP_ESFERA: string
}
export type OpcaoCargo = { CD_CARGO: number; DS_CARGO: string; TP_ESFERA: string }
export type OpcaoMunicipio = { CD_MUNICIPIO: number; NM_MUNICIPIO: string }
export type OpcaoPartido = { SK_PARTIDO: number; SG_PARTIDO: string; NM_PARTIDO: string }

export function opcoes() {
  return Promise.all([
    consulta<OpcaoEleicao>(`
      SELECT SK_ELEICAO, ANO_ELEICAO, DS_ELEICAO, TP_ESFERA
      FROM dim_eleicao WHERE FL_SERIE_PRINCIPAL ORDER BY ANO_ELEICAO DESC`),
    consulta<OpcaoCargo>(`SELECT CD_CARGO, DS_CARGO, TP_ESFERA FROM dim_cargo ORDER BY CD_CARGO`),
    consulta<OpcaoMunicipio>(`
      SELECT CD_MUNICIPIO, NM_MUNICIPIO FROM dim_municipio ORDER BY NM_MUNICIPIO`),
    consulta<OpcaoPartido>(`
      SELECT SK_PARTIDO, SG_PARTIDO, NM_PARTIDO FROM dim_partido ORDER BY SG_PARTIDO`),
  ])
}

// ─── KPIs ────────────────────────────────────────────────────────────────

export type Kpis = {
  QT_VOTOS: number; QT_MUNICIPIOS: number; QT_LOCAIS: number
  QT_ZONAS: number; QT_VOTAVEIS: number
}

export function kpis(f: Filtros) {
  return consulta<Kpis>(`
    SELECT CAST(SUM(f.QT_VOTOS_NORM) AS BIGINT) AS QT_VOTOS,
           COUNT(DISTINCT l.CD_MUNICIPIO)       AS QT_MUNICIPIOS,
           COUNT(DISTINCT f.SK_LOCAL)           AS QT_LOCAIS,
           COUNT(DISTINCT l.NR_ZONA)            AS QT_ZONAS,
           COUNT(DISTINCT CASE WHEN v.TP_VOTO = 'Nominal' THEN f.SK_VOTAVEL END) AS QT_VOTAVEIS
    ${FATO} WHERE ${clausulas(f)}
  `)
}

/** Participação do recorte. Vem de `fato_local`, o grão certo do eleitorado. */
export type Participacao = {
  ANO_ELEICAO: number; TP_ESFERA: string
  QT_APTOS: number; QT_COMPARECIMENTO: number; PCT_COMPARECIMENTO: number
}

export function participacao(f: Filtros) {
  const cond = ['e.FL_SERIE_PRINCIPAL']
  if (f.skEleicao !== null) cond.push(`e.SK_ELEICAO = ${f.skEleicao}`)
  if (f.cdMunicipio !== null) cond.push(`l.CD_MUNICIPIO = ${f.cdMunicipio}`)
  return consulta<Participacao>(`
    SELECT e.ANO_ELEICAO, e.TP_ESFERA,
           SUM(fl.QT_APTOS) AS QT_APTOS,
           SUM(fl.QT_COMPARECIMENTO) AS QT_COMPARECIMENTO,
           ROUND(100.0 * SUM(fl.QT_COMPARECIMENTO) / SUM(fl.QT_APTOS), 2) AS PCT_COMPARECIMENTO
    FROM fato_local fl
    JOIN dim_eleicao e USING (SK_ELEICAO)
    JOIN dim_local   l ON l.SK_LOCAL = fl.SK_LOCAL AND l.SK_ELEICAO = fl.SK_ELEICAO
    WHERE ${cond.join(' AND ')}
    GROUP BY 1, 2 ORDER BY 1
  `)
}

// ─── rankings ────────────────────────────────────────────────────────────

export type VotavelTop = {
  SK_VOTAVEL: number; NM_VOTAVEL: string; NM_URNA: string | null
  SG_PARTIDO: string | null; SK_PARTIDO: number | null; TP_VOTO: string; VOTOS: number
}

/** Mais votados do recorte, já incluindo branco e nulo para dar contexto. */
export function topVotaveis(f: Filtros, limite = 8) {
  return consulta<VotavelTop>(`
    SELECT f.SK_VOTAVEL, v.NM_VOTAVEL, v.NM_URNA, p.SG_PARTIDO, v.SK_PARTIDO, v.TP_VOTO,
           CAST(ROUND(SUM(f.QT_VOTOS_NORM)) AS BIGINT) AS VOTOS
    ${FATO} LEFT JOIN dim_partido p USING (SK_PARTIDO)
    WHERE ${clausulas(f)}
    GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 7 DESC LIMIT ${limite}
  `)
}

export type VotoPartido = {
  SK_PARTIDO: number; SG_PARTIDO: string; NM_PARTIDO: string
  ANO_ELEICAO: number; VOTOS: number
}

/** Série de partido por ano — ignora o filtro de ano, que é o ponto dela. */
export function votosPorPartidoAno(f: Filtros) {
  const cond = ['e.FL_SERIE_PRINCIPAL', "v.TP_VOTO IN ('Nominal', 'Legenda')"]
  if (f.cdCargo !== null) cond.push(`f.CD_CARGO = ${f.cdCargo}`)
  if (f.cdMunicipio !== null) cond.push(`l.CD_MUNICIPIO = ${f.cdMunicipio}`)
  return consulta<VotoPartido>(`
    SELECT v.SK_PARTIDO, p.SG_PARTIDO, p.NM_PARTIDO, e.ANO_ELEICAO,
           CAST(ROUND(SUM(f.QT_VOTOS_NORM)) AS BIGINT) AS VOTOS
    ${FATO} JOIN dim_partido p USING (SK_PARTIDO)
    WHERE ${cond.join(' AND ')}
    GROUP BY 1, 2, 3, 4 ORDER BY 4, 5 DESC
  `)
}

// ─── tabela ──────────────────────────────────────────────────────────────

export type Granularidade = 'municipio' | 'zona' | 'local'

export type LinhaTabela = {
  CHAVE: string; NOME: string; DETALHE: string | null
  VOTOS: number; APTOS: number | null; COMPARECIMENTO: number | null
  PCT_COMPARECIMENTO: number | null
}

const GRAO: Record<Granularidade, { chave: string; nome: string; detalhe: string }> = {
  municipio: {
    chave: 'CAST(l.CD_MUNICIPIO AS VARCHAR)',
    nome: 'ANY_VALUE(m.NM_MUNICIPIO)',
    detalhe: `'Município'`,
  },
  zona: {
    chave: `CAST(l.CD_MUNICIPIO AS VARCHAR) || '-' || CAST(l.NR_ZONA AS VARCHAR)`,
    nome: `'Zona ' || CAST(ANY_VALUE(l.NR_ZONA) AS VARCHAR)`,
    detalhe: 'ANY_VALUE(m.NM_MUNICIPIO)',
  },
  local: {
    chave: 'CAST(f.SK_LOCAL AS VARCHAR)',
    nome: 'ANY_VALUE(l.NM_LOCAL_VOTACAO)',
    detalhe: `ANY_VALUE(m.NM_MUNICIPIO) || ' · zona ' || CAST(ANY_VALUE(l.NR_ZONA) AS VARCHAR)`,
  },
}

/**
 * Tabela do recorte, em três granularidades.
 *
 * Votos e eleitorado vêm de fatos de grãos diferentes, então são somados em
 * CTEs separadas antes de se juntarem — é o que impede o eleitorado de ser
 * multiplicado pelo número de votáveis.
 */
export function tabela(f: Filtros, grao: Granularidade) {
  const g = GRAO[grao]
  const condEleitorado = ['e.FL_SERIE_PRINCIPAL']
  if (f.skEleicao !== null) condEleitorado.push(`e.SK_ELEICAO = ${f.skEleicao}`)
  if (f.cdMunicipio !== null) condEleitorado.push(`l.CD_MUNICIPIO = ${f.cdMunicipio}`)

  const chaveEleitorado = g.chave.replace(/\bf\./g, 'fl.')

  return consulta<LinhaTabela>(`
    WITH votos AS (
      SELECT ${g.chave} AS CHAVE, ${g.nome} AS NOME, ${g.detalhe} AS DETALHE,
             CAST(ROUND(SUM(f.QT_VOTOS_NORM)) AS BIGINT) AS VOTOS
      ${FATO} JOIN dim_municipio m ON m.CD_MUNICIPIO = l.CD_MUNICIPIO
      WHERE ${clausulas(f)}
      GROUP BY 1
    ),
    eleitorado AS (
      SELECT ${chaveEleitorado} AS CHAVE,
             SUM(fl.QT_APTOS) AS APTOS,
             SUM(fl.QT_COMPARECIMENTO) AS COMPARECIMENTO
      FROM fato_local fl
      JOIN dim_eleicao e USING (SK_ELEICAO)
      JOIN dim_local   l ON l.SK_LOCAL = fl.SK_LOCAL AND l.SK_ELEICAO = fl.SK_ELEICAO
      WHERE ${condEleitorado.join(' AND ')}
      GROUP BY 1
    )
    SELECT v.CHAVE, v.NOME, v.DETALHE, v.VOTOS,
           el.APTOS, el.COMPARECIMENTO,
           ROUND(100.0 * el.COMPARECIMENTO / NULLIF(el.APTOS, 0), 2) AS PCT_COMPARECIMENTO
    FROM votos v LEFT JOIN eleitorado el USING (CHAVE)
    ORDER BY v.VOTOS DESC
  `)
}

// ─── mapa ────────────────────────────────────────────────────────────────

export type MunicipioMapa = {
  CD_MUNICIPIO: number; CD_MUNICIPIO_IBGE: number; NM_MUNICIPIO: string
  VOTOS: number; PCT_COMPARECIMENTO: number | null
  SK_PARTIDO_VENCEDOR: number | null; SG_PARTIDO_VENCEDOR: string | null
  NM_VENCEDOR: string | null; PCT_VENCEDOR: number | null
}

/**
 * Um registro por município, para o coroplético.
 *
 * O vencedor sai por `SK_PARTIDO`, não por número — em 2024 o número 20 é
 * Podemos e nos anos anteriores era PSC. Só conta voto nominal: legenda não
 * tem candidato, e branco/nulo não disputam.
 */
export function mapaMunicipios(f: Filtros) {
  const condEleitorado = ['e.FL_SERIE_PRINCIPAL']
  if (f.skEleicao !== null) condEleitorado.push(`e.SK_ELEICAO = ${f.skEleicao}`)

  return consulta<MunicipioMapa>(`
    WITH base AS (
      SELECT l.CD_MUNICIPIO, f.SK_VOTAVEL, v.SK_PARTIDO, v.NM_VOTAVEL, v.NM_URNA, v.TP_VOTO,
             SUM(f.QT_VOTOS_NORM) AS VOTOS
      ${FATO} WHERE ${clausulas(f)}
      GROUP BY 1, 2, 3, 4, 5, 6
    ),
    total AS (
      SELECT CD_MUNICIPIO, CAST(ROUND(SUM(VOTOS)) AS BIGINT) AS VOTOS,
             SUM(CASE WHEN TP_VOTO = 'Nominal' THEN VOTOS ELSE 0 END) AS NOMINAIS
      FROM base GROUP BY 1
    ),
    vencedor AS (
      SELECT CD_MUNICIPIO, SK_PARTIDO, NM_VOTAVEL, NM_URNA, VOTOS,
             ROW_NUMBER() OVER (PARTITION BY CD_MUNICIPIO ORDER BY VOTOS DESC) AS pos
      FROM base WHERE TP_VOTO = 'Nominal'
    ),
    eleitorado AS (
      SELECT l.CD_MUNICIPIO,
             ROUND(100.0 * SUM(fl.QT_COMPARECIMENTO) / NULLIF(SUM(fl.QT_APTOS), 0), 2) AS PCT
      FROM fato_local fl
      JOIN dim_eleicao e USING (SK_ELEICAO)
      JOIN dim_local   l ON l.SK_LOCAL = fl.SK_LOCAL AND l.SK_ELEICAO = fl.SK_ELEICAO
      WHERE ${condEleitorado.join(' AND ')}
      GROUP BY 1
    )
    SELECT m.CD_MUNICIPIO, m.CD_MUNICIPIO_IBGE, m.NM_MUNICIPIO,
           t.VOTOS, el.PCT AS PCT_COMPARECIMENTO,
           w.SK_PARTIDO AS SK_PARTIDO_VENCEDOR, p.SG_PARTIDO AS SG_PARTIDO_VENCEDOR,
           COALESCE(w.NM_URNA, w.NM_VOTAVEL) AS NM_VENCEDOR,
           ROUND(100.0 * w.VOTOS / NULLIF(t.NOMINAIS, 0), 1) AS PCT_VENCEDOR
    FROM total t
    JOIN dim_municipio m USING (CD_MUNICIPIO)
    LEFT JOIN vencedor w ON w.CD_MUNICIPIO = t.CD_MUNICIPIO AND w.pos = 1
    LEFT JOIN dim_partido p ON p.SK_PARTIDO = w.SK_PARTIDO
    LEFT JOIN eleitorado el ON el.CD_MUNICIPIO = t.CD_MUNICIPIO
  `)
}

export type LocalMapa = {
  SK_LOCAL: number; NM_LOCAL: string; NM_MUNICIPIO: string
  LAT: number; LON: number; VOTOS: number
  PCT_COMPARECIMENTO: number | null
}

/** Locais de votação com coordenada — 97,4% do total têm. */
export function mapaLocais(f: Filtros) {
  const condEleitorado = ['e.FL_SERIE_PRINCIPAL']
  if (f.skEleicao !== null) condEleitorado.push(`e.SK_ELEICAO = ${f.skEleicao}`)
  if (f.cdMunicipio !== null) condEleitorado.push(`l.CD_MUNICIPIO = ${f.cdMunicipio}`)

  return consulta<LocalMapa>(`
    WITH votos AS (
      SELECT f.SK_LOCAL, CAST(ROUND(SUM(f.QT_VOTOS_NORM)) AS BIGINT) AS VOTOS
      ${FATO} WHERE ${clausulas(f)} GROUP BY 1
    ),
    eleitorado AS (
      SELECT fl.SK_LOCAL,
             ROUND(100.0 * SUM(fl.QT_COMPARECIMENTO) / NULLIF(SUM(fl.QT_APTOS), 0), 2) AS PCT
      FROM fato_local fl
      JOIN dim_eleicao e USING (SK_ELEICAO)
      JOIN dim_local   l ON l.SK_LOCAL = fl.SK_LOCAL AND l.SK_ELEICAO = fl.SK_ELEICAO
      WHERE ${condEleitorado.join(' AND ')} GROUP BY 1
    )
    SELECT v.SK_LOCAL, la.NM_LOCAL_REF AS NM_LOCAL, m.NM_MUNICIPIO,
           la.LATITUDE_REF AS LAT, la.LONGITUDE_REF AS LON,
           v.VOTOS, el.PCT AS PCT_COMPARECIMENTO
    FROM votos v
    JOIN dim_local_atual la USING (SK_LOCAL)
    JOIN dim_municipio m ON m.CD_MUNICIPIO = la.CD_MUNICIPIO
    LEFT JOIN eleitorado el USING (SK_LOCAL)
    WHERE la.LATITUDE_REF IS NOT NULL
  `)
}
