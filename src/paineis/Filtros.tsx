import type {
  OpcaoCargo, OpcaoEleicao, OpcaoMunicipio, OpcaoPartido,
} from '../dados/consultas'
import { useFiltros } from '../estado/filtros'
import { Busca, Campo, Seletor } from '../ui/Campo'

/**
 * Barra de filtros — governa todos os painéis.
 *
 * A eleição vem primeiro porque manda no resto: os códigos de cargo são
 * disjuntos entre esferas ({3,5,6,7} estadual, {11,13} municipal), então trocar
 * de ano pode invalidar o cargo escolhido — o store zera esse campo sozinho.
 */
export function Filtros({
  eleicoes, cargos, municipios, partidos,
}: {
  eleicoes: OpcaoEleicao[]
  cargos: OpcaoCargo[]
  municipios: OpcaoMunicipio[]
  partidos: OpcaoPartido[]
}) {
  const f = useFiltros()
  const esfera = eleicoes.find((e) => e.SK_ELEICAO === f.skEleicao)?.TP_ESFERA
  const cargosValidos = esfera ? cargos.filter((c) => c.TP_ESFERA === esfera) : cargos

  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl border borda bg-superficie p-4 lg:grid-cols-4">
      <Campo rotulo="Eleição">
        <Seletor
          valor={f.skEleicao}
          vazio="Todas as eleições"
          opcoes={eleicoes.map((e) => ({
            valor: e.SK_ELEICAO,
            rotulo: `${e.ANO_ELEICAO} · ${e.TP_ESFERA}`,
          }))}
          aoMudar={(v) => {
            f.definir('skEleicao', v)
            const e = eleicoes.find((x) => x.SK_ELEICAO === v)
            f.definirRotulo('skEleicao', e ? `${e.ANO_ELEICAO} · ${e.TP_ESFERA}` : null)
            f.definirRotulo('cdCargo', null)
          }}
        />
      </Campo>

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
    </div>
  )
}
