import { clausulas, condEleicao, type Filtros } from '../estado/filtros'
import { consulta, garanteTabela } from './duckdb'

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
/** Turnos de cada eleição ordinária — inclui o 2º turno, que `OpcaoEleicao` omite de propósito. */
export type OpcaoTurno = { SK_ELEICAO: number; ANO_ELEICAO: number; NR_TURNO: number }

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
    consulta<OpcaoTurno>(`
      SELECT SK_ELEICAO, ANO_ELEICAO, NR_TURNO FROM dim_eleicao
      WHERE NOT FL_SUPLEMENTAR ORDER BY ANO_ELEICAO, NR_TURNO`),
  ])
}

/**
 * Candidatos do recorte atual — opções do filtro global "Candidato".
 * Ignora o próprio `skVotavel` (senão reabrir a busca só mostraria quem já
 * está selecionado); os demais filtros (eleição, cargo, município, partido)
 * valem normalmente, então a lista já nasce curta na maioria dos recortes —
 * mas sem LIMIT, pelo mesmo motivo de `candidatosDoCargo`: Vereador sem
 * município escolhido passa fácil de mil candidatos, e um corte aqui esconde
 * gente da busca antes dela rodar.
 */
export function opcoesVotavel(f: Filtros) {
  const cond = [condEleicao(f.skEleicao), "v.TP_VOTO = 'Nominal'"]
  if (f.cdCargo !== null) cond.push(`f.CD_CARGO = ${f.cdCargo}`)
  if (f.cdMunicipio !== null) cond.push(`l.CD_MUNICIPIO = ${f.cdMunicipio}`)
  if (f.skPartido !== null) cond.push(`v.SK_PARTIDO = ${f.skPartido}`)
  return consulta<OpcaoVotavel>(`
    SELECT v.SK_VOTAVEL, v.NM_VOTAVEL, v.NM_URNA, p.SG_PARTIDO
    ${FATO} LEFT JOIN dim_partido p USING (SK_PARTIDO)
    WHERE ${cond.join(' AND ')}
    GROUP BY 1, 2, 3, 4
    ORDER BY SUM(f.QT_VOTOS_NORM) DESC
  `)
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
  const cond = [condEleicao(f.skEleicao)]
  if (f.cdMunicipio !== null) cond.push(`l.CD_MUNICIPIO = ${f.cdMunicipio}`)
  return consulta<Participacao>(`
    SELECT e.ANO_ELEICAO, e.TP_ESFERA,
           CAST(SUM(fl.QT_APTOS) AS BIGINT) AS QT_APTOS,
           CAST(SUM(fl.QT_COMPARECIMENTO) AS BIGINT) AS QT_COMPARECIMENTO,
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
  const condEleitorado = [condEleicao(f.skEleicao)]
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
             CAST(SUM(fl.QT_APTOS) AS BIGINT) AS APTOS,
             CAST(SUM(fl.QT_COMPARECIMENTO) AS BIGINT) AS COMPARECIMENTO
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

// ─── conferência ─────────────────────────────────────────────────────────

export type LinhaConferencia = {
  CD_MUNICIPIO: number; NM_MUNICIPIO: string; SK_VOTAVEL: number
  NR_VOTAVEL: string; NM_VOTAVEL: string; SG_PARTIDO: string | null
  VOTOS: number; PCT_MUNICIPIO: number
}

/**
 * Candidato × município, no grão que bate com a totalização oficial do TSE —
 * pensada para conferir número contra o resultado publicado, não para leitura
 * corrida. Por padrão só voto nominal entra (branco e nulo não têm
 * candidatura pra conferir); `incluirBrancosNulos` é o único painel que
 * respeita esse toggle hoje, de propósito — não faz sentido em Ranking de
 * partidos nem no vencedor do mapa.
 *
 * Agrupa por `SK_VOTAVEL`, não por `NR_VOTAVEL` cru: sem filtro de cargo ou
 * eleição, o mesmo número de urna se repete entre cargos e anos diferentes no
 * mesmo município — `SK_VOTAVEL` é a candidatura de verdade.
 */
export function conferenciaMunicipio(f: Filtros) {
  const soNominal = f.incluirBrancosNulos ? '' : "AND v.TP_VOTO = 'Nominal'"
  return consulta<LinhaConferencia>(`
    SELECT l.CD_MUNICIPIO, m.NM_MUNICIPIO, v.SK_VOTAVEL, v.NR_VOTAVEL, v.NM_VOTAVEL, p.SG_PARTIDO,
           CAST(ROUND(SUM(f.QT_VOTOS_NORM)) AS BIGINT) AS VOTOS,
           ROUND(100.0 * SUM(f.QT_VOTOS_NORM)
                 / SUM(SUM(f.QT_VOTOS_NORM)) OVER (PARTITION BY l.CD_MUNICIPIO), 2) AS PCT_MUNICIPIO
    ${FATO} JOIN dim_municipio m ON m.CD_MUNICIPIO = l.CD_MUNICIPIO
      LEFT JOIN dim_partido p USING (SK_PARTIDO)
    WHERE ${clausulas(f)} ${soNominal}
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY m.NM_MUNICIPIO, VOTOS DESC
  `)
}

// ─── cruzamento ──────────────────────────────────────────────────────────

export type OpcaoVotavel = {
  SK_VOTAVEL: number; NM_VOTAVEL: string; NM_URNA: string | null; SG_PARTIDO: string | null
}

/**
 * Candidatos nominais de um cargo numa eleição, ordenados por voto — é a
 * lista de busca do seletor de candidato no Cruzamento.
 *
 * De propósito, **não** escopa pelo filtro global de município: o Cruzamento
 * já ignora eleição e cargo da barra lateral (é o ponto dele — comparar
 * qualquer combinação), então filtrar a busca por município escondia
 * candidatos de cargo municipal de outras cidades sem avisar por quê, e
 * parecia a lista travada. O recorte de município continua valendo no
 * resultado do cruzamento (mapa e tabela), só não na busca.
 *
 * Sem LIMIT: Vereador é o cargo mais fragmentado (~7.800 candidatos no
 * estado inteiro em 2024) — um limite aqui cortava candidato de fora dos
 * mais votados gerais da lista antes mesmo da busca rodar, então digitar o
 * nome certinho não achava ninguém.
 */
export function candidatosDoCargo(skEleicao: number, cdCargo: number) {
  return consulta<OpcaoVotavel>(`
    SELECT v.SK_VOTAVEL, v.NM_VOTAVEL, v.NM_URNA, p.SG_PARTIDO
    FROM dim_votavel v
    LEFT JOIN dim_partido p USING (SK_PARTIDO)
    LEFT JOIN fato_votos f USING (SK_VOTAVEL)
    WHERE v.SK_ELEICAO = ${skEleicao} AND v.CD_CARGO = ${cdCargo} AND v.TP_VOTO = 'Nominal'
    GROUP BY 1, 2, 3, 4
    ORDER BY COALESCE(SUM(f.QT_VOTOS_NORM), 0) DESC
  `)
}

export type CandidatoCruzamento = {
  slot: 'A' | 'B' | 'C' | 'D'
  skEleicao: number; cdCargo: number; skVotavel: number
  nome: string; anoEleicao: number; dsCargo: string; sgPartido: string | null
}

export type LinhaCruzamento = {
  SK_LOCAL: number; NM_LOCAL: string; NM_MUNICIPIO: string
  LAT: number | null; LON: number | null; VOTOS: number[]
}

/**
 * Território de 1 a 4 candidatos, casado por `SK_LOCAL` — não por
 * (município, zona, seção) como faria uma junção ingênua. `SK_LOCAL` já
 * resolve zona renumerada e local que muda de nome entre anos, então
 * comparar 2018 com 2024 aqui é mais seguro que a chave bruta do TSE.
 *
 * Aproximação ecológica: mede coincidência territorial de votação, não o
 * eleitor individual, e a razão entre dois candidatos pode passar de 100%.
 */
export async function cruzamento(
  candidatos: CandidatoCruzamento[], cdMunicipio: number | null,
): Promise<LinhaCruzamento[]> {
  const n = candidatos.length
  if (!n) return []

  const partes = candidatos.map((c, i) => `
    SELECT ${i} AS idx, SK_LOCAL, SUM(QT_VOTOS_NORM) AS votos
    FROM fato_votos
    WHERE SK_ELEICAO = ${c.skEleicao} AND CD_CARGO = ${c.cdCargo} AND SK_VOTAVEL = ${c.skVotavel}
    GROUP BY SK_LOCAL`).join(' UNION ALL ')
  const colunas = candidatos
    .map((_, i) => `COALESCE(SUM(votos) FILTER (WHERE idx = ${i}), 0) AS V${i}`).join(', ')
  const selecionaV = candidatos.map((_, i) => `s.V${i}`).join(', ')
  const condMun = cdMunicipio !== null ? `AND la.CD_MUNICIPIO = ${cdMunicipio}` : ''

  type LinhaBruta = {
    SK_LOCAL: number; NM_LOCAL: string; NM_MUNICIPIO: string
    LAT: number | null; LON: number | null
  } & { [coluna: `V${number}`]: number }

  const linhas = await consulta<LinhaBruta>(`
    WITH u AS (${partes}),
    s AS (SELECT SK_LOCAL, ${colunas} FROM u GROUP BY SK_LOCAL)
    SELECT s.SK_LOCAL AS SK_LOCAL, la.NM_LOCAL_REF AS NM_LOCAL, m.NM_MUNICIPIO AS NM_MUNICIPIO,
           la.LATITUDE_REF AS LAT, la.LONGITUDE_REF AS LON, ${selecionaV}
    FROM s
    JOIN dim_local_atual la USING (SK_LOCAL)
    JOIN dim_municipio m ON m.CD_MUNICIPIO = la.CD_MUNICIPIO
    WHERE 1=1 ${condMun}
  `)

  return linhas.map((l) => ({
    SK_LOCAL: l.SK_LOCAL, NM_LOCAL: l.NM_LOCAL, NM_MUNICIPIO: l.NM_MUNICIPIO,
    LAT: l.LAT, LON: l.LON,
    VOTOS: candidatos.map((_, i) => l[`V${i}`] ?? 0),
  }))
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
  const condEleitorado = [condEleicao(f.skEleicao)]

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
  const condEleitorado = [condEleicao(f.skEleicao)]
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

export type TopLocalCandidato = {
  SK_LOCAL: number; SK_VOTAVEL: number; NOME: string; SG_PARTIDO: string | null; VOTOS: number
}

/**
 * Os mais votados de cada local, no recorte atual — pensado pro tooltip de
 * "Locais de votação" no Mapa, onde só total e comparecimento não dizem quem
 * puxou o voto ali. Inclui branco e nulo, igual ao ranking geral, pra manter
 * a mesma régua de "dá contexto".
 */
export function topPorLocal(f: Filtros, limite = 5) {
  return consulta<TopLocalCandidato>(`
    WITH candidatos AS (
      SELECT f.SK_LOCAL, f.SK_VOTAVEL, COALESCE(v.NM_URNA, v.NM_VOTAVEL) AS NOME, p.SG_PARTIDO,
             CAST(ROUND(SUM(f.QT_VOTOS_NORM)) AS BIGINT) AS VOTOS,
             ROW_NUMBER() OVER (PARTITION BY f.SK_LOCAL ORDER BY SUM(f.QT_VOTOS_NORM) DESC) AS pos
      ${FATO} LEFT JOIN dim_partido p USING (SK_PARTIDO)
      WHERE ${clausulas(f)}
      GROUP BY 1, 2, 3, 4
    )
    SELECT SK_LOCAL, SK_VOTAVEL, NOME, SG_PARTIDO, VOTOS
    FROM candidatos WHERE pos <= ${limite}
    ORDER BY SK_LOCAL, pos
  `)
}

export type CandidatoTopDois = {
  SK_VOTAVEL: number; SK_PARTIDO: number | null; NOME: string; SG_PARTIDO: string | null; VOTOS: number
}

export type VotosDoisPorLocal = {
  SK_LOCAL: number; NM_LOCAL: string; NM_MUNICIPIO: string
  LAT: number; LON: number
  VOTOS_A: number; VOTOS_B: number
  PCT_COMPARECIMENTO: number | null
}

export type DoisMaisVotados = { candidatos: CandidatoTopDois[]; locais: VotosDoisPorLocal[] }

/**
 * Os dois candidatos mais votados do cargo/eleição do recorte, e o voto de
 * cada um por local — usado só para o destaque de vencedor local no mapa de
 * Governador e de Presidente, onde "os dois mais votados" é um fato da eleição, não do
 * município filtrado. Por isso o top 2 ignora `cdMunicipio`; só o resultado
 * por local respeita esse filtro, igual ao Cruzamento.
 *
 * Exige eleição e cargo específicos — sem os dois, "os dois mais votados" não
 * tem resposta única (cargo municipal soma 224 disputas diferentes).
 */
export async function doisMaisVotadosPorLocal(f: Filtros): Promise<DoisMaisVotados> {
  if (f.skEleicao === null || f.cdCargo === null) return { candidatos: [], locais: [] }

  const candidatos = await consulta<CandidatoTopDois>(`
    SELECT v.SK_VOTAVEL, v.SK_PARTIDO, COALESCE(v.NM_URNA, v.NM_VOTAVEL) AS NOME, p.SG_PARTIDO,
           CAST(ROUND(SUM(f.QT_VOTOS_NORM)) AS BIGINT) AS VOTOS
    FROM fato_votos f
    JOIN dim_votavel v USING (SK_VOTAVEL)
    LEFT JOIN dim_partido p USING (SK_PARTIDO)
    WHERE f.SK_ELEICAO = ${f.skEleicao} AND f.CD_CARGO = ${f.cdCargo} AND v.TP_VOTO = 'Nominal'
    GROUP BY 1, 2, 3, 4
    ORDER BY VOTOS DESC
    LIMIT 2
  `)
  if (candidatos.length < 2) return { candidatos, locais: [] }
  const [a, b] = candidatos

  const condMun = f.cdMunicipio !== null ? `AND la.CD_MUNICIPIO = ${f.cdMunicipio}` : ''
  const locais = await consulta<VotosDoisPorLocal>(`
    WITH votos AS (
      SELECT SK_LOCAL,
        CAST(ROUND(SUM(QT_VOTOS_NORM) FILTER (WHERE SK_VOTAVEL = ${a.SK_VOTAVEL})) AS BIGINT) AS VOTOS_A,
        CAST(ROUND(SUM(QT_VOTOS_NORM) FILTER (WHERE SK_VOTAVEL = ${b.SK_VOTAVEL})) AS BIGINT) AS VOTOS_B
      FROM fato_votos
      WHERE SK_ELEICAO = ${f.skEleicao} AND CD_CARGO = ${f.cdCargo}
        AND SK_VOTAVEL IN (${a.SK_VOTAVEL}, ${b.SK_VOTAVEL})
      GROUP BY 1
    ),
    eleitorado AS (
      SELECT SK_LOCAL,
             ROUND(100.0 * SUM(QT_COMPARECIMENTO) / NULLIF(SUM(QT_APTOS), 0), 2) AS PCT
      FROM fato_local
      WHERE SK_ELEICAO = ${f.skEleicao}
      GROUP BY 1
    )
    SELECT vo.SK_LOCAL, la.NM_LOCAL_REF AS NM_LOCAL, m.NM_MUNICIPIO,
           la.LATITUDE_REF AS LAT, la.LONGITUDE_REF AS LON,
           COALESCE(vo.VOTOS_A, 0) AS VOTOS_A, COALESCE(vo.VOTOS_B, 0) AS VOTOS_B,
           el.PCT AS PCT_COMPARECIMENTO
    FROM votos vo
    JOIN dim_local_atual la USING (SK_LOCAL)
    JOIN dim_municipio m ON m.CD_MUNICIPIO = la.CD_MUNICIPIO
    LEFT JOIN eleitorado el USING (SK_LOCAL)
    WHERE la.LATITUDE_REF IS NOT NULL ${condMun}
  `)

  return { candidatos, locais }
}

// ─── perfil do eleitorado ────────────────────────────────────────────────

export type PerfilLinha = { DIMENSAO: string; CATEGORIA: string; QT_ELEITORES: number }

/** Aspas simples dobradas — só isso já basta pro literal de string do DuckDB. */
function aspas(s: string): string {
  return s.replace(/'/g, "''")
}

/**
 * Perfil demográfico do eleitorado **atual** (situação corrente do TSE, não
 * uma série por eleição — por isso só respeita `cdMunicipio`/`bairro`/`local`;
 * eleição, cargo, partido e candidato não têm sentido aqui). Vem já em
 * formato longo (uma linha por dimensão x categoria), então uma consulta só
 * serve todos os gráficos do painel; o componente filtra por `DIMENSAO` no
 * cliente.
 *
 * `local` é a chave natural (zona, local de votação) do arquivo do TSE, não
 * `SK_LOCAL` — essa fonte não tem série por eleição, então não existe a
 * renumeração entre anos que `SK_LOCAL` resolve, e a chave natural já é
 * suficiente e mais direta. Um `local` específico dispensa o `bairro`
 * (o local já sabe a que bairro pertence); `bairro` sozinho soma todos os
 * locais dele, o que exige juntar com `dim_local_perfil` pra saber quais são.
 */
export function perfilEleitorado(
  cdMunicipio: number | null,
  filtro: { bairro?: string; local?: { nrZona: number; nrLocal: number } } = {},
) {
  if (filtro.local) {
    const cond = [
      cdMunicipio !== null ? `CD_MUNICIPIO = ${cdMunicipio}` : null,
      `NR_ZONA = ${filtro.local.nrZona} AND NR_LOCAL_VOTACAO = ${filtro.local.nrLocal}`,
    ].filter((c) => c !== null)
    return consulta<PerfilLinha>(`
      SELECT DIMENSAO, CATEGORIA, CAST(SUM(QT_ELEITORES) AS BIGINT) AS QT_ELEITORES
      FROM fato_perfil_eleitorado
      WHERE ${cond.join(' AND ')}
      GROUP BY 1, 2
    `)
  }

  if (filtro.bairro) {
    const cond = [
      cdMunicipio !== null ? `f.CD_MUNICIPIO = ${cdMunicipio}` : null,
      `l.NM_BAIRRO = '${aspas(filtro.bairro)}'`,
    ].filter((c) => c !== null)
    return consulta<PerfilLinha>(`
      SELECT f.DIMENSAO, f.CATEGORIA, CAST(SUM(f.QT_ELEITORES) AS BIGINT) AS QT_ELEITORES
      FROM fato_perfil_eleitorado f
      JOIN dim_local_perfil l
        ON l.CD_MUNICIPIO = f.CD_MUNICIPIO AND l.NR_ZONA = f.NR_ZONA AND l.NR_LOCAL_VOTACAO = f.NR_LOCAL_VOTACAO
      WHERE ${cond.join(' AND ')}
      GROUP BY 1, 2
    `)
  }

  const cond = cdMunicipio !== null ? `WHERE CD_MUNICIPIO = ${cdMunicipio}` : ''
  return consulta<PerfilLinha>(`
    SELECT DIMENSAO, CATEGORIA, CAST(SUM(QT_ELEITORES) AS BIGINT) AS QT_ELEITORES
    FROM fato_perfil_eleitorado
    ${cond}
    GROUP BY 1, 2
  `)
}

export type OpcaoBairroPerfil = { NM_BAIRRO: string; QT_LOCAIS: number }

/** Bairros de um município, pro seletor primário do Perfil do Eleitorado. */
export function bairrosPerfil(cdMunicipio: number) {
  return consulta<OpcaoBairroPerfil>(`
    SELECT NM_BAIRRO, COUNT(*) AS QT_LOCAIS
    FROM dim_local_perfil
    WHERE CD_MUNICIPIO = ${cdMunicipio}
    GROUP BY 1
    ORDER BY NM_BAIRRO
  `)
}

export type OpcaoLocalPerfil = {
  NR_ZONA: number; NR_LOCAL_VOTACAO: number; NM_LOCAL_VOTACAO: string; NM_BAIRRO: string
}

/**
 * Locais de votação de um município, pro seletor secundário do Perfil do
 * Eleitorado — `bairro` estreita pra só os locais daquele bairro, pensado pra
 * quando o bairro já foi escolhido no seletor primário.
 */
export function locaisPerfil(cdMunicipio: number, bairro?: string) {
  const cond = [
    `CD_MUNICIPIO = ${cdMunicipio}`,
    bairro ? `NM_BAIRRO = '${aspas(bairro)}'` : null,
  ].filter((c) => c !== null)
  return consulta<OpcaoLocalPerfil>(`
    SELECT NR_ZONA, NR_LOCAL_VOTACAO, NM_LOCAL_VOTACAO, NM_BAIRRO
    FROM dim_local_perfil
    WHERE ${cond.join(' AND ')}
    ORDER BY NM_LOCAL_VOTACAO
  `)
}

// ─── votação por bairro → local ──────────────────────────────────────────

export type OpcaoPolitico = { SK_POLITICO: number; NM_URNA: string; NM_POLITICO: string; ANOS: string }

/**
 * Eleições que o painel "Votação por bairro" oferece por candidatura: a série principal
 * (1º turno das ordinárias) **mais o 2º turno** das ordinárias — Presidente 2018 e 2022,
 * Prefeito de Teresina 2020. Os demais painéis seguem só no 1º turno (`FL_SERIE_PRINCIPAL`),
 * porque somar turnos infla comparecimento; aqui cada turno é uma coluna separada.
 * Suplementar nunca entra. Alias esperado: `e` = dim_eleicao.
 */
const ELEICAO_E_2_TURNO = '(e.FL_SERIE_PRINCIPAL OR (e.NR_TURNO = 2 AND NOT e.FL_SUPLEMENTAR))'

/**
 * Políticos com voto nominal no município, em qualquer eleição da série
 * principal — a lista de busca do painel "Votação por bairro".
 *
 * Para cargo municipal só entram candidatos da própria cidade; para
 * deputado, todo candidato do estado que recebeu voto ali. `SK_POLITICO` é o
 * que liga a mesma pessoa entre eleições (e entre cargos), então escolher um
 * nome já traz todas as candidaturas dele.
 */
export function politicosDoMunicipio(cdMunicipio: number) {
  return consulta<OpcaoPolitico>(`
    WITH loc AS (SELECT SK_LOCAL, SK_ELEICAO FROM dim_local WHERE CD_MUNICIPIO = ${cdMunicipio})
    SELECT v.SK_POLITICO, p.NM_POLITICO,
           arg_max(COALESCE(v.NM_URNA, v.NM_VOTAVEL), v.SK_ELEICAO) AS NM_URNA,
           array_to_string(list_sort(list_distinct(list(e.ANO_ELEICAO))), ', ') AS ANOS
    FROM fato_votos f
    JOIN loc ON loc.SK_LOCAL = f.SK_LOCAL AND loc.SK_ELEICAO = f.SK_ELEICAO
    JOIN dim_votavel v ON v.SK_VOTAVEL = f.SK_VOTAVEL
    JOIN dim_eleicao e ON e.SK_ELEICAO = f.SK_ELEICAO
    JOIN dim_politico p ON p.SK_POLITICO = v.SK_POLITICO
    WHERE ${ELEICAO_E_2_TURNO} AND v.TP_VOTO = 'Nominal'
    GROUP BY v.SK_POLITICO, p.NM_POLITICO
    ORDER BY p.NM_POLITICO
  `)
}

export type ColunaTerritorio = {
  SK_VOTAVEL: number; SK_ELEICAO: number; CD_CARGO: number; ANO_ELEICAO: number; NR_TURNO: number
  DS_CARGO: string; NOME: string; SG_PARTIDO: string | null
  DS_SIT_TOT_TURNO: string | null; VOTOS: number
}

/** Candidaturas de um político com voto no município — uma coluna cada. */
export function candidaturasDoPolitico(skPolitico: number, cdMunicipio: number) {
  return consulta<ColunaTerritorio>(`
    WITH loc AS (SELECT SK_LOCAL, SK_ELEICAO FROM dim_local WHERE CD_MUNICIPIO = ${cdMunicipio})
    SELECT v.SK_VOTAVEL, v.SK_ELEICAO, v.CD_CARGO, e.ANO_ELEICAO, e.NR_TURNO, c.DS_CARGO,
           COALESCE(v.NM_URNA, v.NM_VOTAVEL) AS NOME, p.SG_PARTIDO, v.DS_SIT_TOT_TURNO,
           CAST(SUM(f.QT_VOTOS_NORM) AS DOUBLE) AS VOTOS
    FROM fato_votos f
    JOIN loc ON loc.SK_LOCAL = f.SK_LOCAL AND loc.SK_ELEICAO = f.SK_ELEICAO
    JOIN dim_votavel v ON v.SK_VOTAVEL = f.SK_VOTAVEL
    JOIN dim_eleicao e ON e.SK_ELEICAO = f.SK_ELEICAO
    JOIN dim_cargo c ON c.CD_CARGO = v.CD_CARGO
    LEFT JOIN dim_partido p ON p.SK_PARTIDO = v.SK_PARTIDO
    WHERE ${ELEICAO_E_2_TURNO} AND v.TP_VOTO = 'Nominal' AND v.SK_POLITICO = ${skPolitico}
    GROUP BY ALL
    ORDER BY e.ANO_ELEICAO, e.NR_TURNO, v.CD_CARGO
  `)
}

export type LocalTerritorio = {
  SK_LOCAL: number; NM_LOCAL: string; BAIRRO: string; NR_ZONA: number; QT_SECOES: number
}

/**
 * Locais de votação do município com o bairro **mais recente** de cada um.
 *
 * O bairro de um mesmo `SK_LOCAL` pode mudar de grafia ou de cadastro entre
 * eleições; usar o mais recente põe todas as colunas (de anos diferentes) sob
 * a mesma linha, em vez de espalhar o local por bairros distintos. Só entram
 * eleições da série principal — as suplementares têm cadastro incompleto.
 */
export function locaisDoMunicipio(cdMunicipio: number) {
  return consulta<LocalTerritorio>(`
    SELECT l.SK_LOCAL, la.NM_LOCAL_REF AS NM_LOCAL,
           arg_max(COALESCE(NULLIF(TRIM(l.NM_BAIRRO), ''), 'SEM BAIRRO'), l.SK_ELEICAO) AS BAIRRO,
           arg_max(l.NR_ZONA, l.SK_ELEICAO) AS NR_ZONA,
           CAST(arg_max(COALESCE(fl.QT_SECOES, 0), l.SK_ELEICAO) AS INTEGER) AS QT_SECOES
    FROM dim_local l
    JOIN dim_eleicao e ON e.SK_ELEICAO = l.SK_ELEICAO
    JOIN dim_local_atual la ON la.SK_LOCAL = l.SK_LOCAL
    LEFT JOIN fato_local fl ON fl.SK_LOCAL = l.SK_LOCAL AND fl.SK_ELEICAO = l.SK_ELEICAO
    WHERE l.CD_MUNICIPIO = ${cdMunicipio} AND e.FL_SERIE_PRINCIPAL
    GROUP BY l.SK_LOCAL, la.NM_LOCAL_REF
  `)
}

export type CelulaTerritorio = {
  NIVEL: 'L' | 'B' | 'M'; CHAVE: string; VOTOS: number; POSICAO: number; CONCORRENTES: number
}

/**
 * Votos de um candidato por local (`L`, chave = SK_LOCAL), por bairro (`B`,
 * chave = nome) e no município (`M`), cada um com a **colocação** dele entre
 * todos os candidatos nominais do mesmo cargo e eleição naquele recorte.
 *
 * A colocação é recalculada em cada nível — o 1º do bairro não é
 * necessariamente o 1º de cada escola dele. Empate divide a posição (RANK).
 * Candidato sem voto num recorte simplesmente não aparece nele.
 */
export function votosPorTerritorio(
  c: { skEleicao: number; cdCargo: number; skVotavel: number }, cdMunicipio: number,
) {
  return consulta<CelulaTerritorio>(`
    WITH mapa AS (
      SELECT l.SK_LOCAL,
             arg_max(COALESCE(NULLIF(TRIM(l.NM_BAIRRO), ''), 'SEM BAIRRO'), l.SK_ELEICAO) AS BAIRRO
      FROM dim_local l JOIN dim_eleicao e ON e.SK_ELEICAO = l.SK_ELEICAO
      WHERE l.CD_MUNICIPIO = ${cdMunicipio} AND e.FL_SERIE_PRINCIPAL
      GROUP BY l.SK_LOCAL
    ),
    base AS (
      SELECT f.SK_LOCAL, f.SK_VOTAVEL, SUM(f.QT_VOTOS_NORM) AS V
      FROM fato_votos f JOIN dim_votavel v ON v.SK_VOTAVEL = f.SK_VOTAVEL
      WHERE f.SK_ELEICAO = ${c.skEleicao} AND f.CD_CARGO = ${c.cdCargo} AND v.TP_VOTO = 'Nominal'
        AND f.SK_LOCAL IN (SELECT SK_LOCAL FROM mapa)
      GROUP BY 1, 2
    ),
    loc AS (
      SELECT SK_LOCAL, SK_VOTAVEL, V,
             RANK() OVER (PARTITION BY SK_LOCAL ORDER BY V DESC) AS R,
             COUNT(*) OVER (PARTITION BY SK_LOCAL) AS N
      FROM base
    ),
    bai AS (
      SELECT m.BAIRRO, b.SK_VOTAVEL, SUM(b.V) AS V FROM base b JOIN mapa m USING (SK_LOCAL) GROUP BY 1, 2
    ),
    bair AS (
      SELECT BAIRRO, SK_VOTAVEL, V,
             RANK() OVER (PARTITION BY BAIRRO ORDER BY V DESC) AS R,
             COUNT(*) OVER (PARTITION BY BAIRRO) AS N
      FROM bai
    ),
    mun AS (SELECT SK_VOTAVEL, SUM(V) AS V FROM base GROUP BY 1),
    munr AS (
      SELECT SK_VOTAVEL, V, RANK() OVER (ORDER BY V DESC) AS R, COUNT(*) OVER () AS N FROM mun
    )
    SELECT 'L' AS NIVEL, CAST(SK_LOCAL AS VARCHAR) AS CHAVE, CAST(V AS DOUBLE) AS VOTOS,
           CAST(R AS INTEGER) AS POSICAO, CAST(N AS INTEGER) AS CONCORRENTES
    FROM loc WHERE SK_VOTAVEL = ${c.skVotavel}
    UNION ALL
    SELECT 'B', BAIRRO, CAST(V AS DOUBLE), CAST(R AS INTEGER), CAST(N AS INTEGER)
    FROM bair WHERE SK_VOTAVEL = ${c.skVotavel}
    UNION ALL
    SELECT 'M', '', CAST(V AS DOUBLE), CAST(R AS INTEGER), CAST(N AS INTEGER)
    FROM munr WHERE SK_VOTAVEL = ${c.skVotavel}
  `)
}

/**
 * Seções (com algum voto nominal) de uma escola, nas eleições dadas.
 *
 * Vem de `fato_votos_secao`, que só é baixada quando alguém abre as seções de
 * uma escola. A numeração de seção pode mudar entre eleições; a união delas é
 * o que a tabela mostra, e a seção ausente num ano aparece como "—".
 */
export async function secoesDoLocal(skLocal: number, skEleicoes: number[]) {
  await garanteTabela('fato_votos_secao')
  const rs = await consulta<{ NR_SECAO: number }>(`
    SELECT DISTINCT NR_SECAO FROM fato_votos_secao
    WHERE SK_LOCAL = ${skLocal} AND SK_ELEICAO IN (${skEleicoes.join(', ')})
    ORDER BY NR_SECAO
  `)
  return rs.map((r) => r.NR_SECAO)
}

export type CelulaSecao = { NR_SECAO: number; VOTOS: number; POSICAO: number; CONCORRENTES: number }

/** Votos e colocação do candidato em cada seção de uma escola (mesma regra de `votosPorTerritorio`). */
export async function votosPorSecao(
  c: { skEleicao: number; cdCargo: number; skVotavel: number }, skLocal: number,
) {
  await garanteTabela('fato_votos_secao')
  return consulta<CelulaSecao>(`
    WITH b AS (
      SELECT s.NR_SECAO, s.SK_VOTAVEL, s.QT_VOTOS_NORM AS V
      FROM fato_votos_secao s JOIN dim_votavel v ON v.SK_VOTAVEL = s.SK_VOTAVEL
      WHERE s.SK_ELEICAO = ${c.skEleicao} AND s.SK_LOCAL = ${skLocal} AND v.CD_CARGO = ${c.cdCargo}
    ),
    r AS (
      SELECT NR_SECAO, SK_VOTAVEL, V,
             RANK() OVER (PARTITION BY NR_SECAO ORDER BY V DESC) AS R,
             COUNT(*) OVER (PARTITION BY NR_SECAO) AS N
      FROM b
    )
    SELECT NR_SECAO, CAST(V AS DOUBLE) AS VOTOS, CAST(R AS INTEGER) AS POSICAO,
           CAST(N AS INTEGER) AS CONCORRENTES
    FROM r WHERE SK_VOTAVEL = ${c.skVotavel} ORDER BY NR_SECAO
  `)
}
