import { useEffect, useMemo, useRef, useState } from 'react'
import type { LocalMapa, MunicipioMapa } from '../dados/consultas'
import { useFiltros } from '../estado/filtros'
import { useTema } from '../estado/tema'
import { OUTROS, SLOTS, TINTA, formataInteiro, formataPct } from '../viz/paleta'
import { caixaDe, corSequencial, projeta, RAMPA_PASSOS } from '../viz/projecao'

/**
 * Mapa do Piauí em SVG.
 *
 * Duas camadas alternáveis, como na referência: municípios (coroplético) e
 * locais de votação (pontos). Sem tiles — a geometria do IBGE é desenhada
 * direto, o que deixa o mapa herdar as cores do tema em vez de ficar um
 * retângulo claro dentro de um painel escuro.
 *
 * Duas leituras do coroplético:
 *  - **partido**: categórico, com a cor fixa do partido vencedor;
 *  - **comparecimento**: sequencial, uma cor variando em luminosidade.
 */

type Geo = {
  features: {
    properties: { ibge: number }
    geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: never }
  }[]
}

type Camada = 'municipios' | 'locais'
type Pintura = 'partido' | 'comparecimento'

const L = 560
const A = 640

export function Mapa({
  municipios, locais, slots, carregando,
}: {
  municipios: MunicipioMapa[]
  locais: LocalMapa[]
  slots: Map<number, number>
  carregando: boolean
}) {
  const modo = useTema()
  const t = TINTA[modo]
  const definirFiltro = useFiltros((s) => s.definir)
  const definirRotulo = useFiltros((s) => s.definirRotulo)

  const [geo, setGeo] = useState<Geo | null>(null)
  const [camada, setCamada] = useState<Camada>('municipios')
  const [pintura, setPintura] = useState<Pintura>('partido')
  const [sobre, setSobre] = useState<{ x: number; y: number; html: React.ReactNode } | null>(null)
  const svg = useRef<SVGSVGElement>(null)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}dados/municipios_pi.geojson`)
      .then((r) => r.json())
      .then(setGeo)
      .catch(() => setGeo(null))
  }, [])

  const proj = useMemo(
    () => (geo ? projeta(caixaDe(geo.features), L, A) : null),
    [geo],
  )

  const porIbge = useMemo(() => {
    const m = new Map<number, MunicipioMapa>()
    for (const d of municipios) m.set(d.CD_MUNICIPIO_IBGE, d)
    return m
  }, [municipios])

  const faixa = useMemo(() => {
    const vs = municipios.map((d) => d.PCT_COMPARECIMENTO).filter((v): v is number => v !== null)
    return { min: Math.min(...vs), max: Math.max(...vs) }
  }, [municipios])

  function cor(d: MunicipioMapa | undefined): string {
    if (!d) return modo === 'claro' ? '#eeede8' : '#242422'
    if (pintura === 'comparecimento') {
      return d.PCT_COMPARECIMENTO === null
        ? OUTROS
        : corSequencial(d.PCT_COMPARECIMENTO, faixa.min, faixa.max)
    }
    const i = d.SK_PARTIDO_VENCEDOR === null ? undefined : slots.get(d.SK_PARTIDO_VENCEDOR)
    return i === undefined ? OUTROS : SLOTS[modo][i]
  }

  // Legenda do modo partido: só os que de fato vencem algum município.
  const vencedores = useMemo(() => {
    const conta = new Map<number, { sg: string; n: number }>()
    for (const d of municipios) {
      if (d.SK_PARTIDO_VENCEDOR === null) continue
      const a = conta.get(d.SK_PARTIDO_VENCEDOR) ?? { sg: d.SG_PARTIDO_VENCEDOR ?? '—', n: 0 }
      a.n += 1
      conta.set(d.SK_PARTIDO_VENCEDOR, a)
    }
    return [...conta.entries()].sort((a, b) => b[1].n - a[1].n)
  }, [municipios])

  function posiciona(e: React.MouseEvent, html: React.ReactNode) {
    const r = svg.current?.getBoundingClientRect()
    if (!r) return
    setSobre({ x: e.clientX - r.left, y: e.clientY - r.top, html })
  }

  return (
    <section className="rounded-xl border borda bg-superficie">
      <div className="flex flex-wrap items-center gap-2 border-b borda p-3">
        <h2 className="mr-auto text-base font-semibold text-tinta">Mapa eleitoral</h2>

        <div role="tablist" aria-label="Camada" className="flex gap-1">
          {([['municipios', 'Municípios'], ['locais', 'Locais de votação']] as const).map(
            ([id, rotulo]) => (
              <button key={id} role="tab" aria-selected={camada === id}
                onClick={() => setCamada(id)}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  camada === id ? 'bg-realce/10 font-medium text-realce' : 'text-tinta-2 hover:bg-tinta/5'
                }`}>
                {rotulo}
              </button>
            ),
          )}
        </div>

        {camada === 'municipios' && (
          <div role="tablist" aria-label="Pintura" className="flex gap-1">
            {([['partido', 'Por partido'], ['comparecimento', 'Comparecimento']] as const).map(
              ([id, rotulo]) => (
                <button key={id} role="tab" aria-selected={pintura === id}
                  onClick={() => setPintura(id)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs transition ${
                    pintura === id ? 'bg-tinta/10 font-medium text-tinta' : 'text-tinta-3 hover:bg-tinta/5'
                  }`}>
                  {rotulo}
                </button>
              ),
            )}
          </div>
        )}
      </div>

      <div className="relative grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_200px]">
        <div className="relative">
          {!geo || carregando ? (
            <p className="py-20 text-center text-sm text-tinta-3">Carregando o mapa…</p>
          ) : (
            <svg ref={svg} viewBox={`0 0 ${L} ${A}`} className="h-auto w-full"
              role="img" aria-label="Mapa do Piauí por município">
              <g onMouseLeave={() => setSobre(null)}>
                {geo.features.map((f) => {
                  const d = porIbge.get(f.properties.ibge)
                  return (
                    <path
                      key={f.properties.ibge}
                      d={proj!.caminho(f.geometry.coordinates, f.geometry.type)}
                      fill={camada === 'municipios' ? cor(d) : 'transparent'}
                      stroke={t.superficie}
                      strokeWidth={0.5}
                      className={d ? 'cursor-pointer' : ''}
                      onMouseMove={(e) =>
                        d && posiciona(e, (
                          <>
                            <div className="font-medium text-tinta">{d.NM_MUNICIPIO}</div>
                            <dl className="mt-1 space-y-0.5 text-tinta-2">
                              {d.NM_VENCEDOR && (
                                <div>
                                  {d.NM_VENCEDOR}
                                  {d.SG_PARTIDO_VENCEDOR && ` (${d.SG_PARTIDO_VENCEDOR})`}
                                  {d.PCT_VENCEDOR !== null && ` · ${formataPct(d.PCT_VENCEDOR)}`}
                                </div>
                              )}
                              <div className="tabular">{formataInteiro(d.VOTOS)} votos</div>
                              {d.PCT_COMPARECIMENTO !== null && (
                                <div className="tabular">
                                  {formataPct(d.PCT_COMPARECIMENTO)} de comparecimento
                                </div>
                              )}
                            </dl>
                          </>
                        ))
                      }
                      onClick={() => {
                        if (!d) return
                        definirFiltro('cdMunicipio', d.CD_MUNICIPIO)
                        definirRotulo('cdMunicipio', d.NM_MUNICIPIO)
                      }}
                    />
                  )
                })}

                {camada === 'locais' &&
                  locais.map((p) => {
                    const [x, y] = proj!.ponto(p.LON, p.LAT)
                    return (
                      <circle
                        key={p.SK_LOCAL} cx={x} cy={y} r={2.2}
                        fill={t.realce} fillOpacity={0.55}
                        onMouseMove={(e) =>
                          posiciona(e, (
                            <>
                              <div className="font-medium text-tinta">{p.NM_LOCAL}</div>
                              <div className="text-tinta-2">{p.NM_MUNICIPIO}</div>
                              <div className="tabular mt-1 text-tinta-2">
                                {formataInteiro(p.VOTOS)} votos
                                {p.PCT_COMPARECIMENTO !== null &&
                                  ` · ${formataPct(p.PCT_COMPARECIMENTO)}`}
                              </div>
                            </>
                          ))
                        }
                      />
                    )
                  })}
              </g>
            </svg>
          )}

          {sobre && (
            <div
              className="pointer-events-none absolute z-10 max-w-64 rounded-lg border borda bg-superficie px-3 py-2 text-sm shadow-lg"
              style={{
                left: Math.min(sobre.x + 12, L - 180),
                top: sobre.y + 12,
              }}
            >
              {sobre.html}
            </div>
          )}
        </div>

        <div className="min-w-0">
          {camada === 'locais' ? (
            <p className="text-sm text-tinta-2">
              {formataInteiro(locais.length)} locais com coordenada.
              <span className="mt-1 block text-tinta-3">
                97,4% dos locais têm geolocalização; os demais somem do mapa mas
                continuam nos totais.
              </span>
            </p>
          ) : pintura === 'partido' ? (
            <>
              <h3 className="text-xs font-medium tracking-wide text-tinta-3 uppercase">
                Municípios vencidos
              </h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {vencedores.map(([sk, v]) => (
                  <li key={sk} className="flex items-center gap-2">
                    <span aria-hidden className="size-3 shrink-0 rounded"
                      style={{ background: slots.has(sk) ? SLOTS[modo][slots.get(sk)!] : OUTROS }} />
                    <span className="min-w-0 flex-1 truncate text-tinta">{v.sg}</span>
                    <span className="tabular text-tinta-2">{v.n}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <h3 className="text-xs font-medium tracking-wide text-tinta-3 uppercase">
                Comparecimento
              </h3>
              <div className="mt-2 flex h-3 overflow-hidden rounded">
                {RAMPA_PASSOS.map((c) => (
                  <div key={c} className="flex-1" style={{ background: c }} />
                ))}
              </div>
              <div className="tabular mt-1 flex justify-between text-xs text-tinta-3">
                <span>{formataPct(faixa.min)}</span>
                <span>{formataPct(faixa.max)}</span>
              </div>
              <p className="mt-3 text-xs text-tinta-3">
                Uma cor só, variando em luminosidade — a regra para magnitude
                contínua.
              </p>
            </>
          )}

          <p className="mt-4 text-xs text-tinta-3">
            Clique num município para filtrar o painel.
          </p>
        </div>
      </div>
    </section>
  )
}
