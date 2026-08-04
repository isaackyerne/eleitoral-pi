import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip as TooltipMapa } from 'react-leaflet'
import type { FeatureCollection } from 'geojson'
import {
  candidatosDoCargo, cruzamento,
  type CandidatoCruzamento, type LinhaCruzamento,
  type OpcaoCargo, type OpcaoEleicao, type OpcaoVotavel,
} from '../dados/consultas'
import { exportarExcel } from '../dados/excel'
import { Busca, Campo, Seletor } from '../ui/Campo'
import { Nota } from '../ui/Nota'
import { TINTA, formataInteiro, formataPct } from '../viz/paleta'
import { ATRIBUICAO_CARTO, CENTRO_PI, urlTilesCarto, ZOOM_PI } from '../viz/mapabase'

/**
 * Comparação territorial de 1 a 4 candidatos, de qualquer eleição e cargo,
 * casados por `SK_LOCAL` — não por (município, zona, seção) como faria uma
 * junção ingênua do arquivo bruto do TSE. `SK_LOCAL` já resolve zona
 * renumerada e local que muda de nome entre anos (ver
 * `eleicoes_pi_unificado.md`), então cruzar 2018 com 2024 aqui é mais seguro
 * que a chave crua.
 *
 * Só o candidato A é obrigatório. Com um, é a distribuição territorial dele;
 * com dois, domínio A×B por local; com três ou quatro, o líder de cada local.
 * É aproximação **ecológica** — mede coincidência territorial de votação, não
 * o eleitor individual — e a razão entre dois candidatos pode passar de 100%.
 */

type Slot = 'A' | 'B' | 'C' | 'D'
const SLOTS: Slot[] = ['A', 'B', 'C', 'D']

// Cor do slot antes de ter candidato escolhido — sem partido ainda não dá
// pra saber a cor de verdade, então é só um indicador de posição (A/B/C/D).
// Vira o fallback do slot vazio no formulário; a cor de verdade (`coresCandidatos`)
// assume assim que alguém é escolhido.
const CORES_SLOT_SELECAO: Record<Slot, string> = {
  A: '#2a78d6', B: '#eb6834', C: '#1baf7a', D: '#4a3aa7',
}

/**
 * Cor de cada candidato no resultado: PT sempre vermelho, PP sempre azul —
 * mesma cor fixa do resto do painel — na ordem A, B, C, D (A tem prioridade:
 * se A e B forem os dois do PT, só A fica vermelho). Um segundo candidato do
 * mesmo partido, ou qualquer outro partido, cai na paleta genérica de
 * posição, só pra distinguir visualmente — sem significado de identidade.
 */
const CORES_GENERICAS = ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7'] as const

function coresCandidatos(ativos: CandidatoCruzamento[]): Record<Slot, string> {
  const cores = {} as Record<Slot, string>
  let ptLivre = true
  let ppLivre = true
  let iGenerica = 0
  for (const c of ativos) {
    if (c.sgPartido === 'PT' && ptLivre) {
      cores[c.slot] = '#E4142C'
      ptLivre = false
    } else if (c.sgPartido === 'PP' && ppLivre) {
      cores[c.slot] = '#234F74'
      ppLivre = false
    } else {
      cores[c.slot] = CORES_GENERICAS[iGenerica % CORES_GENERICAS.length]
      iGenerica += 1
    }
  }
  return cores
}

const CARGO_PADRAO: Record<string, string[]> = {
  Estadual: ['Governador', 'Deputado Estadual'],
  Municipal: ['Prefeito', 'Vereador'],
}
function cargoPadrao(cargosValidos: OpcaoCargo[], esfera: string | undefined): number | null {
  const preferidos = esfera ? CARGO_PADRAO[esfera] ?? [] : []
  const achado = cargosValidos.find((c) => preferidos.includes(c.DS_CARGO))
  return (achado ?? cargosValidos[0])?.CD_CARGO ?? null
}

// O mapa fica sempre claro, mesmo com o painel no tema escuro — mesmo
// motivo do Mapa.tsx: tile escuro atrapalha a leitura das cores por cima.
const MODO_MAPA = 'claro'
const ALTURA_MAPA = 480

function SeletorCandidato({
  slot, cor, eleicoes, cargos, anoPadrao, opcional, aoMudar,
}: {
  slot: Slot
  cor: string
  eleicoes: OpcaoEleicao[]
  cargos: OpcaoCargo[]
  anoPadrao: number
  opcional: boolean
  aoMudar: (v: CandidatoCruzamento | null) => void
}) {
  const eleicaoInicial = eleicoes.find((e) => e.ANO_ELEICAO === anoPadrao) ?? eleicoes[0] ?? null
  const [skEleicao, setSkEleicao] = useState<number | null>(eleicaoInicial?.SK_ELEICAO ?? null)
  const [cdCargo, setCdCargo] = useState<number | null>(() => {
    const validos = eleicaoInicial
      ? cargos.filter((c) => c.TP_ESFERA === eleicaoInicial.TP_ESFERA) : cargos
    return cargoPadrao(validos, eleicaoInicial?.TP_ESFERA)
  })
  const [skVotavel, setSkVotavel] = useState<number | null>(null)
  const [candidatos, setCandidatos] = useState<OpcaoVotavel[]>([])

  const eleicaoAtual = eleicoes.find((e) => e.SK_ELEICAO === skEleicao)
  const cargosValidos = useMemo(
    () => (eleicaoAtual ? cargos.filter((c) => c.TP_ESFERA === eleicaoAtual.TP_ESFERA) : cargos),
    [cargos, eleicaoAtual],
  )

  useEffect(() => {
    let vivo = true
    const pedido = skEleicao !== null && cdCargo !== null
      ? candidatosDoCargo(skEleicao, cdCargo)
      : Promise.resolve<OpcaoVotavel[]>([])
    pedido.then((r) => { if (vivo) setCandidatos(r) })
    return () => { vivo = false }
  }, [skEleicao, cdCargo])

  function escolheCandidato(v: number | null) {
    setSkVotavel(v)
    if (v === null || skEleicao === null || cdCargo === null) { aoMudar(null); return }
    const c = candidatos.find((x) => x.SK_VOTAVEL === v)
    const e = eleicoes.find((x) => x.SK_ELEICAO === skEleicao)
    const cg = cargos.find((x) => x.CD_CARGO === cdCargo)
    if (!c || !e || !cg) return
    aoMudar({
      slot, skEleicao, cdCargo, skVotavel: v,
      nome: c.NM_URNA ?? c.NM_VOTAVEL, anoEleicao: e.ANO_ELEICAO, dsCargo: cg.DS_CARGO,
      sgPartido: c.SG_PARTIDO,
    })
  }

  return (
    <div className="min-w-0 space-y-2 rounded-lg border borda p-3">
      <div className="flex items-baseline gap-1.5">
        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: cor }} />
        <span className="text-sm font-semibold text-tinta">Candidato {slot}</span>
        {opcional && <span className="text-xs text-tinta-3">— opcional</span>}
      </div>

      <Campo rotulo="Eleição">
        <Seletor
          valor={skEleicao}
          vazio="—"
          opcoes={eleicoes.map((e) => ({ valor: e.SK_ELEICAO, rotulo: `${e.ANO_ELEICAO} · ${e.TP_ESFERA}` }))}
          aoMudar={(v) => {
            setSkEleicao(v)
            const e = eleicoes.find((x) => x.SK_ELEICAO === v)
            const validos = e ? cargos.filter((c) => c.TP_ESFERA === e.TP_ESFERA) : cargos
            setCdCargo(cargoPadrao(validos, e?.TP_ESFERA))
            escolheCandidato(null)
          }}
        />
      </Campo>

      <Campo rotulo="Cargo">
        <Seletor
          valor={cdCargo}
          vazio="—"
          opcoes={cargosValidos.map((c) => ({ valor: c.CD_CARGO, rotulo: c.DS_CARGO }))}
          aoMudar={(v) => { setCdCargo(v); escolheCandidato(null) }}
        />
      </Campo>

      <Campo rotulo="Candidato">
        <Busca
          valor={skVotavel}
          vazio={opcional ? '— nenhum —' : 'Buscar candidato…'}
          placeholder="Buscar candidato…"
          opcoes={candidatos.map((c) => ({
            valor: c.SK_VOTAVEL,
            rotulo: `${c.NM_URNA ?? c.NM_VOTAVEL}${c.SG_PARTIDO ? ` · ${c.SG_PARTIDO}` : ''}`,
          }))}
          aoMudar={(v) => escolheCandidato(v)}
        />
      </Campo>
    </div>
  )
}

export function Cruzamento({
  eleicoes, cargos, cdMunicipio,
}: {
  eleicoes: OpcaoEleicao[]
  cargos: OpcaoCargo[]
  cdMunicipio: number | null
}) {
  const t = TINTA[MODO_MAPA]
  const anoA = eleicoes[0]?.ANO_ELEICAO ?? 0
  const anoBCD = eleicoes[1]?.ANO_ELEICAO ?? anoA

  const [defs, setDefs] = useState<Record<Slot, CandidatoCruzamento | null>>({
    A: null, B: null, C: null, D: null,
  })
  const ativos = useMemo(
    () => SLOTS.map((s) => defs[s]).filter((d): d is CandidatoCruzamento => d !== null),
    [defs],
  )
  const n = ativos.length
  const coresPorSlot = useMemo(() => coresCandidatos(ativos), [ativos])

  const chave = useMemo(
    () => `${JSON.stringify(ativos.map((d) => [d.skEleicao, d.cdCargo, d.skVotavel]))}|${cdMunicipio}`,
    [ativos, cdMunicipio],
  )

  // `linhas` sempre vem junto da chave que a gerou — comparar com a chave
  // atual dá o "carregando" sem um setState separado que atrasa um frame em
  // relação a `ativos`. Foi exatamente essa defasagem que crashava o tooltip
  // do mapa: `n` já virava 2 antes de `linhas` vir no formato de 2 valores.
  type Carga = { de: string; linhas: LinhaCruzamento[] }
  const [carga, setCarga] = useState<Carga | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregando = carga?.de !== chave

  useEffect(() => {
    let vivo = true
    const pedido = ativos.length ? cruzamento(ativos, cdMunicipio) : Promise.resolve<LinhaCruzamento[]>([])
    pedido
      .then((r) => {
        if (!vivo) return
        setCarga({ de: chave, linhas: r })
        setErro(null)
      })
      .catch((e: unknown) => {
        if (!vivo) return
        // Marca a chave como resolvida mesmo em erro — senão `carregando`
        // trava em true para sempre, escondido atrás do aviso de erro.
        setCarga({ de: chave, linhas: [] })
        setErro(e instanceof Error ? e.message : String(e))
      })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  const VAZIO_LINHAS = useMemo(() => [], [])
  const linhas = carga?.linhas ?? VAZIO_LINHAS

  const [geo, setGeo] = useState<FeatureCollection | null>(null)
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}dados/municipios_pi.geojson`)
      .then((r) => r.json()).then(setGeo).catch(() => setGeo(null))
  }, [])

  // Totais exatos: `linhas` já vem sem exigir coordenada, então soma tudo,
  // não só o que aparece no mapa.
  const totais = useMemo(() => ativos.map((_, i) => linhas.reduce((s, l) => s + l.VOTOS[i], 0)), [linhas, ativos])
  const comTodos = useMemo(
    () => linhas.filter((l) => l.VOTOS.every((v) => v > 0)).length,
    [linhas],
  )
  const geoPontos = useMemo(
    () => linhas.filter((l): l is LinhaCruzamento & { LAT: number; LON: number } => l.LAT !== null && l.LON !== null),
    [linhas],
  )
  const maxTamanho = useMemo(
    () => Math.max(1, ...geoPontos.map((l) => l.VOTOS.reduce((s, v) => s + v, 0))),
    [geoPontos],
  )

  function raio(total: number): number {
    return 2 + 8 * Math.sqrt(total / maxTamanho)
  }

  // Líder do local, cor do próprio candidato — o mesmo critério em 1, 2, 3 ou
  // 4 candidatos. Empate cai no de índice menor (A antes de B), então A
  // também é quem "vence" um empate — é o candidato principal do cruzamento.
  function corPonto(l: LinhaCruzamento): string {
    const lider = l.VOTOS.reduce((iMax, v, i) => (v > l.VOTOS[iMax] ? i : iMax), 0)
    return coresPorSlot[ativos[lider].slot]
  }

  function exportar() {
    exportarExcel(
      'eleitoral-pi-cruzamento.xlsx',
      [
        { titulo: 'Local', tipo: 'texto', largura: 34 },
        { titulo: 'Município', tipo: 'texto', largura: 24 },
        ...ativos.map((d) => ({ titulo: `${d.slot} · ${d.nome}`, tipo: 'inteiro' as const, largura: 20 })),
        { titulo: 'Total', tipo: 'inteiro' as const, largura: 14 },
      ],
      linhas.map((l) => [
        l.NM_LOCAL, l.NM_MUNICIPIO, ...l.VOTOS, l.VOTOS.reduce((s, v) => s + v, 0),
      ]),
      { aba: 'Cruzamento' },
    )
  }

  const corpo = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({
    count: linhas.length,
    getScrollElement: () => corpo.current,
    estimateSize: () => 40,
    overscan: 12,
  })

  return (
    <section className="space-y-4">
      <div className="rounded-xl border borda bg-superficie p-4">
        <div className="flex items-start gap-2">
          <h2 className="text-base font-semibold text-tinta">Cruzamento por local de votação</h2>
          <Nota titulo="O que é uma aproximação ecológica">
            A comparação mede coincidência territorial de votação, não o
            eleitor individual — dois candidatos podem parecer "trocar" voto
            só porque venceram nos mesmos locais. Entre eleições diferentes, a
            razão entre candidatos pode passar de 100%: locais abrem e fecham
            entre um pleito e outro.
          </Nota>
        </div>
        <p className="mt-1 text-sm text-tinta-2">
          Escolha de 1 a 4 candidatos, de qualquer eleição e cargo. Só o A é
          obrigatório. O casamento é por local de votação (não por seção — a
          base não guarda esse grão), o que já resolve zona renumerada entre anos.
          A busca por candidato não é afetada pelo filtro de município da
          barra lateral — só o mapa e a tabela abaixo são.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SLOTS.map((s) => (
            <SeletorCandidato
              key={s} slot={s} cor={coresPorSlot[s] ?? CORES_SLOT_SELECAO[s]}
              eleicoes={eleicoes} cargos={cargos}
              anoPadrao={s === 'A' ? anoA : anoBCD} opcional={s !== 'A'}
              aoMudar={(v) => setDefs((d) => ({ ...d, [s]: v }))}
            />
          ))}
        </div>
      </div>

      {erro && (
        <div className="rounded-xl border border-[#d03b3b]/30 bg-[#d03b3b]/5 p-4 text-sm">
          <p className="font-medium text-[#d03b3b]">Não foi possível cruzar esses candidatos.</p>
          <p className="mt-1 text-xs text-tinta-3">{erro}</p>
        </div>
      )}

      {n === 0 ? (
        <div className="rounded-xl border borda bg-superficie p-8 text-center text-sm text-tinta-3">
          Selecione ao menos o candidato A. Com um só, você vê a distribuição
          territorial dele; com dois ou mais, o cruzamento.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {ativos.map((d, i) => (
              <div key={d.slot} className="rounded-xl border borda bg-superficie px-4 py-3">
                <div className="flex items-center gap-1.5 text-tinta-3">
                  <span aria-hidden className="size-2.5 rounded-full" style={{ background: coresPorSlot[d.slot] }} />
                  <span className="truncate text-xs font-medium">
                    {d.slot} · {d.nome} ({d.anoEleicao})
                  </span>
                </div>
                <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-tinta">
                  {formataInteiro(totais[i] ?? 0)}
                </div>
              </div>
            ))}
            {n === 2 && (
              <div className="rounded-xl border borda bg-superficie px-4 py-3">
                <span className="text-xs font-medium text-tinta-3">Razão global A/B</span>
                <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-tinta">
                  {totais[1] ? formataPct((totais[0] / totais[1]) * 100) : '—'}
                </div>
              </div>
            )}
            {n >= 3 && (
              <div className="rounded-xl border borda bg-superficie px-4 py-3">
                <span className="text-xs font-medium text-tinta-3">Locais com todos</span>
                <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-tinta">
                  {formataInteiro(comTodos)}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border borda bg-superficie p-4">
            <h3 className="text-sm font-semibold text-tinta">
              {n === 1 ? 'Distribuição territorial' : 'Líder por local'}
            </h3>
            <div className="relative mt-3 overflow-hidden rounded-lg" style={{ height: ALTURA_MAPA }}>
              {!geo ? (
                <div className="grid h-full place-items-center">
                  <p className="text-sm text-tinta-3">Carregando o mapa…</p>
                </div>
              ) : carregando ? (
                <div className="grid h-full place-items-center">
                  <p className="text-sm text-tinta-3">Carregando…</p>
                </div>
              ) : (
                <MapContainer
                  center={CENTRO_PI} zoom={ZOOM_PI} minZoom={5} maxZoom={16}
                  style={{ height: '100%', width: '100%', background: t.plano }}
                  aria-label="Mapa do cruzamento"
                >
                  <TileLayer url={urlTilesCarto(MODO_MAPA)} attribution={ATRIBUICAO_CARTO} />
                  <GeoJSON
                    key="mun"
                    data={geo}
                    style={{ color: t.grade, weight: 0.5, fillOpacity: 0 }}
                  />
                  {geoPontos.map((l) => (
                    <CircleMarker
                      key={l.SK_LOCAL} center={[l.LAT, l.LON]}
                      radius={raio(l.VOTOS.reduce((s, v) => s + v, 0))}
                      pathOptions={{ color: corPonto(l), weight: 0, fillOpacity: 0.7 }}
                    >
                      <TooltipMapa sticky>
                        <div className="font-medium">{l.NM_LOCAL}</div>
                        <div>{l.NM_MUNICIPIO}</div>
                        <div className="tabular mt-1">
                          {ativos.map((d, i) => `${d.slot}: ${formataInteiro(l.VOTOS[i])}`).join(' · ')}
                        </div>
                      </TooltipMapa>
                    </CircleMarker>
                  ))}
                </MapContainer>
              )}
            </div>
            {linhas.length > geoPontos.length && (
              <p className="mt-2 text-xs text-tinta-3">
                {formataInteiro(linhas.length - geoPontos.length)} locais sem coordenada ficam fora do
                mapa, mas seguem na tabela abaixo.
              </p>
            )}
          </div>

          <div className="rounded-xl border borda bg-superficie">
            <div className="flex items-center gap-2 border-b borda p-3">
              <h3 className="mr-auto text-sm font-semibold text-tinta">Local a local</h3>
              <button
                type="button" onClick={exportar} disabled={!linhas.length}
                className="flex h-9 items-center gap-1.5 rounded-lg border borda px-3 text-sm text-tinta-2 transition hover:bg-tinta/5 disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor"
                  strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
                </svg>
                Exportar
              </button>
            </div>

            <div
              className="grid gap-x-3 border-b borda px-4 py-2 text-xs font-medium text-tinta-3"
              style={{ gridTemplateColumns: `1fr repeat(${n}, 6rem) 6rem` }}
            >
              <span>Local · Município</span>
              {ativos.map((d) => <span key={d.slot} className="truncate text-right">{d.slot} · {d.nome}</span>)}
              <span className="text-right">Total</span>
            </div>

            <div ref={corpo} className="h-96 overflow-y-auto">
              {carregando ? (
                <p className="p-4 text-sm text-tinta-3">Carregando…</p>
              ) : !linhas.length ? (
                <p className="p-4 text-sm text-tinta-3">Nenhuma seção com voto para essa combinação.</p>
              ) : (
                <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
                  {virtual.getVirtualItems().map((item) => {
                    const l = linhas[item.index]
                    return (
                      <div
                        key={l.SK_LOCAL}
                        className="absolute inset-x-0 grid items-center gap-x-3 border-b borda px-4 text-sm hover:bg-tinta/[0.03]"
                        style={{
                          gridTemplateColumns: `1fr repeat(${n}, 6rem) 6rem`,
                          height: item.size, transform: `translateY(${item.start}px)`,
                        }}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-tinta">{l.NM_LOCAL}</div>
                          <div className="truncate text-xs text-tinta-3">{l.NM_MUNICIPIO}</div>
                        </div>
                        {l.VOTOS.map((v, i) => (
                          <span key={i} className="tabular text-right text-tinta-2">{formataInteiro(v)}</span>
                        ))}
                        <span className="tabular text-right font-medium text-tinta">
                          {formataInteiro(l.VOTOS.reduce((s, v) => s + v, 0))}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <p className="border-t borda px-4 py-2 text-xs text-tinta-3">
              {formataInteiro(linhas.length)} locais
            </p>
          </div>
        </>
      )}
    </section>
  )
}
