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
 */

export type Participacao = {
  ANO_ELEICAO: number
  TP_ESFERA: string
  QT_APTOS: number
  QT_COMPARECIMENTO: number
  PCT_COMPARECIMENTO: number
}

/** Participação por ano. `fato_local` é o grão certo: um registro por local. */
export function participacaoPorAno() {
  return consulta<Participacao>(`
    SELECT e.ANO_ELEICAO,
           e.TP_ESFERA,
           SUM(f.QT_APTOS)          AS QT_APTOS,
           SUM(f.QT_COMPARECIMENTO) AS QT_COMPARECIMENTO,
           ROUND(100.0 * SUM(f.QT_COMPARECIMENTO) / SUM(f.QT_APTOS), 2) AS PCT_COMPARECIMENTO
    FROM fato_local f
    JOIN dim_eleicao e USING (SK_ELEICAO)
    WHERE e.FL_SERIE_PRINCIPAL
    GROUP BY 1, 2
    ORDER BY 1
  `)
}

export type VotoPartido = {
  SK_PARTIDO: number
  SG_PARTIDO: string
  NM_PARTIDO: string
  ANO_ELEICAO: number
  VOTOS: number
}

/**
 * Votos por partido e ano, já normalizados.
 *
 * Conta só voto nominal e de legenda — branco e nulo não têm partido. O
 * `SK_PARTIDO` atravessa os anos corretamente mesmo quando o número muda.
 */
export function votosPorPartidoAno() {
  return consulta<VotoPartido>(`
    SELECT p.SK_PARTIDO,
           p.SG_PARTIDO,
           p.NM_PARTIDO,
           e.ANO_ELEICAO,
           CAST(ROUND(SUM(f.QT_VOTOS_NORM)) AS BIGINT) AS VOTOS
    FROM fato_votos f
    JOIN dim_eleicao e USING (SK_ELEICAO)
    JOIN dim_votavel v USING (SK_VOTAVEL)
    JOIN dim_partido p USING (SK_PARTIDO)
    WHERE e.FL_SERIE_PRINCIPAL
      AND v.TP_VOTO IN ('Nominal', 'Legenda')
    GROUP BY 1, 2, 3, 4
    ORDER BY 4, 5 DESC
  `)
}

export type Resumo = {
  QT_ELEICOES: number
  QT_LOCAIS: number
  QT_POLITICOS: number
  QT_VOTOS: number
}

export function resumo() {
  return consulta<Resumo>(`
    SELECT (SELECT COUNT(*) FROM dim_eleicao WHERE FL_SERIE_PRINCIPAL) AS QT_ELEICOES,
           (SELECT COUNT(*) FROM dim_local_atual)                      AS QT_LOCAIS,
           (SELECT COUNT(*) FROM dim_politico)                         AS QT_POLITICOS,
           (SELECT CAST(SUM(QT_VOTOS) AS BIGINT) FROM fato_votos)      AS QT_VOTOS
  `)
}
