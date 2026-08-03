import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip } from 'react-leaflet'
import type { Layer } from 'leaflet'
import type { Feature, FeatureCollection } from 'geojson'
import type { LocalMapa, MunicipioMapa } from '../dados/consultas'
import { useColapso } from '../estado/colapso'
import { useFiltros } from '../estado/filtros'
import { BotaoColapsar } from '../ui/BotaoColapsar'
import { Nota } from '../ui/Nota'
import { OUTROS, SLOTS, TINTA, formataInteiro, formataPct } from '../viz/paleta'
import { corSequencial, RAMPA_PASSOS } from '../viz/projecao'
import { ATRIBUICAO_CARTO, CENTRO_PI, urlTilesCarto, ZOOM_PI } from '../viz/mapabase'

/**
 * Mapa do Piauí sobre tiles reais (CARTO Positron, atribuição OpenStreetMap).
 *
 * Sempre claro, mesmo com o resto do painel no tema escuro — os tiles CARTO
 * escuros deixavam o coroplético colorido difícil de ler em cima, e a paleta
 * categórica só foi validada para contraste contra as duas superfícies do
 * app, não contra um tile de satélite/rua.
 *
 * Duas camadas alternáveis: municípios (coroplético) e locais de votação
 * (pontos). Duas leituras do coroplético: **partido** (cor fixa do vencedor)
 * e **comparecimento** (sequencial).
 */

// Fixo em claro — ver nota acima. Não segue `useTema()` de propósito.
const MODO_MAPA = 'claro'

type Camada = 'municipios' | 'locais'
type Pintura = 'partido' | 'comparecimento'

const ALTURA = 640

export function Mapa({
  municipios, locais, slots, carregando,
}: {
  municipios: MunicipioMapa[]
  locais: LocalMapa[]
  slots: Map<number, number>
  carregando: boolean
}) {
  const t = TINTA[MODO_MAPA]
  const definirFiltro = useFiltros((s) => s.definir)
  const definirRotulo = useFiltros((s) => s.definirRotulo)
  const colapsado = useColapso((s) => s.colapsados.mapa ?? false)
  const alternar = useColapso((s) => s.alternar)

  const [geo, setGeo] = useState<FeatureCollection | null>(null)
  const [camada, setCamada] = useState<Camada>('municipios')
  const [pintura, setPintura] = useState<Pintura>('partido')

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}dados/municipios_pi.geojson`)
      .then((r) => r.json())
      .then(setGeo)
      .catch(() => setGeo(null))
  }, [])

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
    if (!d) return '#eeede8'
    if (pintura === 'comparecimento') {
      return d.PCT_COMPARECIMENTO === null
        ? OUTROS
        : corSequencial(d.PCT_COMPARECIMENTO, faixa.min, faixa.max)
    }
    const i = d.SK_PARTIDO_VENCEDOR === null ? undefined : slots.get(d.SK_PARTIDO_VENCEDOR)
    return i === undefined ? OUTROS : SLOTS[MODO_MAPA][i]
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

  function tooltipMunicipio(d: MunicipioMapa): string {
    const linhas = [`<div style="font-weight:600">${d.NM_MUNICIPIO}</div>`]
    if (d.NM_VENCEDOR) {
      linhas.push(
        `<div>${d.NM_VENCEDOR}${d.SG_PARTIDO_VENCEDOR ? ` (${d.SG_PARTIDO_VENCEDOR})` : ''}` +
        `${d.PCT_VENCEDOR !== null ? ` · ${formataPct(d.PCT_VENCEDOR)}` : ''}</div>`,
      )
    }
    linhas.push(`<div class="tabular">${formataInteiro(d.VOTOS)} votos</div>`)
    if (d.PCT_COMPARECIMENTO !== null) {
      linhas.push(`<div class="tabular">${formataPct(d.PCT_COMPARECIMENTO)} de comparecimento</div>`)
    }
    return linhas.join('')
  }

  function aoCadaMunicipio(feature: Feature, layer: Layer) {
    const ibge = Number((feature.properties as { ibge: number } | null)?.ibge)
    const d = porIbge.get(ibge)
    if (!d) return
    layer.bindTooltip(tooltipMunicipio(d), { sticky: true, className: 'mapa-tooltip' })
    layer.on('click', () => {
      definirFiltro('cdMunicipio', d.CD_MUNICIPIO)
      definirRotulo('cdMunicipio', d.NM_MUNICIPIO)
    })
  }

  function estiloMunicipio(feature?: Feature) {
    const ibge = Number((feature?.properties as { ibge: number } | null)?.ibge)
    const d = porIbge.get(ibge)
    return {
      color: t.superficie,
      weight: 0.6,
      fillColor: cor(d),
      fillOpacity: camada === 'municipios' ? 0.85 : 0,
    }
  }

  return (
    <section className="rounded-xl border borda bg-superficie">
      <div className="flex flex-wrap items-center gap-2 border-b borda p-3">
        <div className="mr-auto flex items-start gap-2">
          <h2 className="text-base font-semibold text-tinta">Mapa eleitoral</h2>
          <Nota titulo="Como ler o mapa">
            Cada área é um município. Em "por partido", a cor é a do partido que
            teve mais votos ali — não a margem da vitória, então um município
            ganho por pouco tem a mesma cor de um ganho de longe.
          </Nota>
        </div>

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

        <BotaoColapsar aberto={!colapsado} aoAlternar={() => alternar('mapa')} rotulo="Mapa eleitoral" />
      </div>

      {!colapsado && (
      <div className="relative grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_200px]">
        <div className="relative overflow-hidden rounded-lg" style={{ height: ALTURA }}>
          {!geo || carregando ? (
            <div className="grid h-full place-items-center">
              <p className="text-sm text-tinta-3">Carregando o mapa…</p>
            </div>
          ) : (
            <MapContainer
              center={CENTRO_PI} zoom={ZOOM_PI} minZoom={5} maxZoom={16}
              style={{ height: '100%', width: '100%', background: t.plano }}
              aria-label="Mapa do Piauí por município"
            >
              <TileLayer url={urlTilesCarto(MODO_MAPA)} attribution={ATRIBUICAO_CARTO} />
              <GeoJSON
                key={`mun-${camada}-${pintura}-${municipios.length}`}
                data={geo}
                style={estiloMunicipio}
                onEachFeature={aoCadaMunicipio}
              />
              {camada === 'locais' &&
                locais.map((p) => (
                  <CircleMarker
                    key={p.SK_LOCAL} center={[p.LAT, p.LON]} radius={3}
                    pathOptions={{ color: t.realce, weight: 0, fillOpacity: 0.55 }}
                  >
                    <Tooltip sticky>
                      <div className="font-medium">{p.NM_LOCAL}</div>
                      <div>{p.NM_MUNICIPIO}</div>
                      <div className="tabular mt-1">
                        {formataInteiro(p.VOTOS)} votos
                        {p.PCT_COMPARECIMENTO !== null && ` · ${formataPct(p.PCT_COMPARECIMENTO)}`}
                      </div>
                    </Tooltip>
                  </CircleMarker>
                ))}
            </MapContainer>
          )}
        </div>

        <div className="min-w-0">
          {camada === 'locais' ? (
            <p className="text-sm text-tinta-2">
              Cada ponto é um local de votação — escola, posto, câmara.
              <span className="mt-1 block text-tinta-3">
                {formataInteiro(locais.length)} têm endereço geolocalizado. Os
                poucos sem coordenada não aparecem aqui, mas seguem contados nos
                totais.
              </span>
            </p>
          ) : pintura === 'partido' ? (
            <>
              <h3 className="text-xs font-medium tracking-wide text-tinta-3 uppercase">
                Municípios ganhos
              </h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {vencedores.map(([sk, v]) => (
                  <li key={sk} className="flex items-center gap-2">
                    <span aria-hidden className="size-3 shrink-0 rounded"
                      style={{ background: slots.has(sk) ? SLOTS[MODO_MAPA][slots.get(sk)!] : OUTROS }} />
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
                Quanto mais escuro, maior a parcela de eleitores que foi votar.
              </p>
            </>
          )}

          <p className="mt-4 text-xs text-tinta-3">
            Clique num município para ver só ele no painel.
          </p>
        </div>
      </div>
      )}
    </section>
  )
}
