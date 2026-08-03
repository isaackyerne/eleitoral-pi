import { useEffect, useState } from 'react'
import {
  opcoesVotavel,
  type OpcaoCargo, type OpcaoEleicao, type OpcaoMunicipio, type OpcaoPartido,
  type OpcaoTurno, type OpcaoVotavel,
} from '../dados/consultas'
import { useFiltros } from '../estado/filtros'
import { Busca, Campo, Seletor } from '../ui/Campo'

/**
 * Barra de filtros — governa todos os painéis.
 *
 * A eleição vem primeiro porque manda no resto: os códigos de cargo são
 * disjuntos entre esferas ({3,5,6,7} estadual, {11,13} municipal), então trocar
 * de ano pode invalidar o cargo escolhido — o store zera esse campo sozinho.
 *
 * O seletor de Eleição só lista 1º turno (`FL_SERIE_PRINCIPAL`) — é o
 * guardrail do modelo. O Turno aparece do lado quando a eleição escolhida
 * tiver 2º turno (hoje só 2020) e troca qual `SK_ELEICAO` de fato filtra,
 * sem tirar a eleição da lista principal.
 *
 * O Candidato busca o próprio recorte (eleição, cargo, município, partido já
 * escolhidos), então a lista já nasce curta na maioria das vezes — e o
 * `SK_VOTAVEL` só existe dentro do (eleição, cargo) em que foi gerado, então
 * trocar qualquer um dos dois zera a seleção sozinho, como o store já faz.
 */
export function Filtros({
  eleicoes, cargos, municipios, partidos, turnos,
}: {
  eleicoes: OpcaoEleicao[]
  cargos: OpcaoCargo[]
  municipios: OpcaoMunicipio[]
  partidos: OpcaoPartido[]
  turnos: OpcaoTurno[]
}) {
  const f = useFiltros()
  const esfera = eleicoes.find((e) => e.SK_ELEICAO === f.skEleicaoBase)?.TP_ESFERA
  const cargosValidos = esfera ? cargos.filter((c) => c.TP_ESFERA === esfera) : cargos

  const anoBase = eleicoes.find((e) => e.SK_ELEICAO === f.skEleicaoBase)?.ANO_ELEICAO
  const turnosDoAno = anoBase !== undefined ? turnos.filter((t) => t.ANO_ELEICAO === anoBase) : []

  const [candidatos, setCandidatos] = useState<OpcaoVotavel[]>([])
  useEffect(() => {
    let vivo = true
    opcoesVotavel({ ...f, skVotavel: null }).then((r) => { if (vivo) setCandidatos(r) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.skEleicao, f.cdCargo, f.cdMunicipio, f.skPartido])

  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl border borda bg-superficie p-4 sm:grid-cols-3 lg:grid-cols-5">
      <Campo rotulo="Eleição">
        <Seletor
          valor={f.skEleicaoBase}
          vazio="Todas as eleições"
          opcoes={eleicoes.map((e) => ({
            valor: e.SK_ELEICAO,
            rotulo: `${e.ANO_ELEICAO} · ${e.TP_ESFERA}`,
          }))}
          aoMudar={(v) => {
            f.definir('skEleicaoBase', v)
            f.definir('skEleicao', v)
            const e = eleicoes.find((x) => x.SK_ELEICAO === v)
            f.definirRotulo('skEleicao', e ? `${e.ANO_ELEICAO} · ${e.TP_ESFERA}` : null)
            f.definirRotulo('cdCargo', null)
          }}
        />
      </Campo>

      {turnosDoAno.length > 1 && (
        <Campo rotulo="Turno">
          <div role="radiogroup" aria-label="Turno" className="flex h-9 gap-1">
            {turnosDoAno.map((t) => (
              <button
                key={t.NR_TURNO}
                type="button"
                role="radio"
                aria-checked={f.skEleicao === t.SK_ELEICAO}
                onClick={() => {
                  f.definir('skEleicao', t.SK_ELEICAO)
                  const e = eleicoes.find((x) => x.SK_ELEICAO === f.skEleicaoBase)
                  f.definirRotulo(
                    'skEleicao',
                    e ? `${e.ANO_ELEICAO} · ${e.TP_ESFERA}${t.NR_TURNO === 2 ? ' · 2º turno' : ''}` : null,
                  )
                }}
                className={`flex-1 rounded-lg border borda text-sm transition ${
                  f.skEleicao === t.SK_ELEICAO
                    ? 'bg-realce/10 font-medium text-realce'
                    : 'text-tinta-2 hover:bg-tinta/5'
                }`}
              >
                {t.NR_TURNO}º turno
              </button>
            ))}
          </div>
        </Campo>
      )}

      <Campo rotulo="Cargo">
        <Seletor
          valor={f.cdCargo}
          vazio="Todos os cargos"
          opcoes={cargosValidos.map((c) => ({ valor: c.CD_CARGO, rotulo: c.DS_CARGO }))}
          aoMudar={(v) => {
            f.definir('cdCargo', v)
            f.definirRotulo('cdCargo', cargos.find((c) => c.CD_CARGO === v)?.DS_CARGO ?? null)
          }}
        />
      </Campo>

      <Campo rotulo="Município">
        <Busca
          valor={f.cdMunicipio}
          vazio="Todos os municípios"
          placeholder="Buscar município…"
          opcoes={municipios.map((m) => ({ valor: m.CD_MUNICIPIO, rotulo: m.NM_MUNICIPIO }))}
          aoMudar={(v, rotulo) => {
            f.definir('cdMunicipio', v)
            f.definirRotulo('cdMunicipio', rotulo)
          }}
        />
      </Campo>

      <Campo rotulo="Partido">
        <Busca
          valor={f.skPartido}
          vazio="Todos os partidos"
          placeholder="Buscar partido…"
          opcoes={partidos.map((p) => ({
            valor: p.SK_PARTIDO,
            rotulo: `${p.SG_PARTIDO} — ${p.NM_PARTIDO}`,
          }))}
          aoMudar={(v, rotulo) => {
            f.definir('skPartido', v)
            f.definirRotulo('skPartido', rotulo?.split(' — ')[0] ?? null)
          }}
        />
      </Campo>

      <Campo rotulo="Candidato">
        <Busca
          valor={f.skVotavel}
          vazio="Todos os candidatos"
          placeholder="Buscar candidato…"
          opcoes={candidatos.map((c) => ({
            valor: c.SK_VOTAVEL,
            rotulo: `${c.NM_URNA ?? c.NM_VOTAVEL}${c.SG_PARTIDO ? ` · ${c.SG_PARTIDO}` : ''}`,
          }))}
          aoMudar={(v, rotulo) => {
            f.definir('skVotavel', v)
            f.definirRotulo('skVotavel', rotulo)
          }}
        />
      </Campo>
    </div>
  )
}
