import { useEffect, useMemo, useState } from 'react'
import {
  conferenciaMunicipio, kpis, mapaLocais, mapaMunicipios, opcoes, participacao, tabela,
  topVotaveis, votosPorPartidoAno, type LocalMapa, type MunicipioMapa,
  type Granularidade, type Kpis as DadosKpis, type LinhaConferencia, type LinhaTabela,
  type OpcaoCargo, type OpcaoEleicao, type OpcaoMunicipio, type OpcaoPartido, type OpcaoTurno,
  type Participacao as DadoParticipacao, type VotavelTop, type VotoPartido,
} from './dados/consultas'
import { useFiltros, type Filtros as TipoFiltros } from './estado/filtros'
import { SECOES, useNavegacao } from './estado/navegacao'
import { useTema } from './estado/tema'
import { Conferencia } from './paineis/Conferencia'
import { Cruzamento } from './paineis/Cruzamento'
import { Filtros } from './paineis/Filtros'
import { Kpis } from './paineis/Kpis'
import { Mapa } from './paineis/Mapa'
import { Participacao } from './paineis/Participacao'
import { RankingPartidos } from './paineis/RankingPartidos'
import { RankingZonas } from './paineis/RankingZonas'
import { Tabela } from './paineis/Tabela'
import { TopVotaveis } from './paineis/TopVotaveis'
import { BotaoMenu, Sidebar } from './ui/Sidebar'
import { mapaDeSlots } from './viz/paleta'

type Listas = {
  eleicoes: OpcaoEleicao[]; cargos: OpcaoCargo[]
  municipios: OpcaoMunicipio[]; partidos: OpcaoPartido[]; turnos: OpcaoTurno[]
}

export default function App() {
  useTema() // aplica o data-tema no <html>
  const secao = useNavegacao((s) => s.secao)
  const filtros = useFiltros()
  const recorte: TipoFiltros = {
    skEleicao: filtros.skEleicao, skEleicaoBase: filtros.skEleicaoBase, cdCargo: filtros.cdCargo,
    cdMunicipio: filtros.cdMunicipio, skPartido: filtros.skPartido, skVotavel: filtros.skVotavel,
    incluirBrancosNulos: filtros.incluirBrancosNulos,
  }
  const chave = JSON.stringify(recorte)

  const [listas, setListas] = useState<Listas | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [grao, setGrao] = useState<Granularidade>('municipio')
  const [anoEscolhido, setAnoEscolhido] = useState<number | null>(null)

  // Os dados carregados vêm junto com o recorte que os gerou. Comparar esse
  // rótulo com o recorte atual dá o "carregando" de graça, sem um setState
  // síncrono dentro do efeito — que dispararia render em cascata.
  type Carga = {
    de: string
    kpis: DadosKpis | null
    participacao: DadoParticipacao[]
    top: VotavelTop[]
    partidos: VotoPartido[]
    linhas: LinhaTabela[]
    zonas: LinhaTabela[]
    municipios: MunicipioMapa[]
    locais: LocalMapa[]
    conferencia: LinhaConferencia[]
  }
  const [carga, setCarga] = useState<Carga | null>(null)
  const pedido = `${chave}|${grao}`
  const carregando = carga?.de !== pedido

  useEffect(() => {
    opcoes()
      .then(([eleicoes, cargos, municipios, partidos, turnos]) =>
        setListas({ eleicoes, cargos, municipios, partidos, turnos }),
      )
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    let vivo = true
    Promise.all([
      kpis(recorte), participacao(recorte), topVotaveis(recorte),
      votosPorPartidoAno(recorte), tabela(recorte, grao), tabela(recorte, 'zona'),
      mapaMunicipios(recorte), mapaLocais(recorte), conferenciaMunicipio(recorte),
    ])
      .then(([k, p, t, pa, tb, zn, mu, lo, cf]) => {
        if (!vivo) return
        setCarga({
          de: pedido, kpis: k[0] ?? null, participacao: p, top: t,
          partidos: pa, linhas: tb, zonas: zn, municipios: mu, locais: lo, conferencia: cf,
        })
      })
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof Error ? e.message : String(e))
      })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido])

  const VAZIO = useMemo(() => [], [])
  const dadosKpis = carga?.kpis ?? null
  const dadosPart = carga?.participacao ?? VAZIO
  const dadosTop = carga?.top ?? VAZIO
  const dadosPartidos = carga?.partidos ?? VAZIO
  const linhas = carga?.linhas ?? VAZIO
  const zonas = carga?.zonas ?? VAZIO
  const municipios = carga?.municipios ?? VAZIO
  const locaisMapa = carga?.locais ?? VAZIO
  const conferencia = carga?.conferencia ?? VAZIO

  // Slot de cor por partido, do total da série inteira — é o que faz a cor
  // seguir o partido em vez da posição no ranking de cada recorte.
  const slots = useMemo(() => {
    const total = new Map<number, number>()
    for (const d of dadosPartidos) {
      total.set(d.SK_PARTIDO, (total.get(d.SK_PARTIDO) ?? 0) + d.VOTOS)
    }
    return mapaDeSlots([...total.entries()].sort((a, b) => b[1] - a[1]).map(([sk]) => sk))
  }, [dadosPartidos])

  const anos = useMemo(
    () => [...new Set(dadosPartidos.map((d) => d.ANO_ELEICAO))].sort(),
    [dadosPartidos],
  )
  // O ano do ranking é derivado: se o escolhido some do recorte, cai no mais
  // recente disponível. Guardar um ano inválido só para corrigi-lo depois num
  // efeito é o que causaria o render em cascata.
  const ano =
    anoEscolhido !== null && anos.includes(anoEscolhido)
      ? anoEscolhido
      : (anos[anos.length - 1] ?? 0)

  const titulo = SECOES.find((s) => s.id === secao)?.rotulo ?? ''
  const mostra = (q: 'mapa' | 'participacao' | 'partidos') =>
    secao === 'visao' || secao === q

  return (
    <div className="min-h-dvh bg-plano md:flex">
      <Sidebar />

      <main id="conteudo" className="min-w-0 flex-1">
        <div className="mx-auto max-w-7xl space-y-5 px-5 py-6">
          <header className="flex items-center gap-3">
            <BotaoMenu />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-tinta">
                {titulo}
              </h1>
              <p className="mt-0.5 text-sm text-tinta-2">
                Eleições de 2018 a 2024 no Piauí, a partir dos dados abertos do TSE.
              </p>
            </div>
          </header>

          {erro && (
            <div className="rounded-xl border border-[#d03b3b]/30 bg-[#d03b3b]/5 p-5">
              <h2 className="font-medium text-[#d03b3b]">Não foi possível carregar</h2>
              <p className="mt-1 text-sm text-tinta-2">
                Os dados do painel não puderam ser lidos. Recarregue a página; se
                persistir, o arquivo de dados pode não estar disponível.
              </p>
              <p className="mt-2 text-xs text-tinta-3">{erro}</p>
            </div>
          )}

          {listas && (
            <Filtros
              eleicoes={listas.eleicoes} cargos={listas.cargos}
              municipios={listas.municipios} partidos={listas.partidos}
              turnos={listas.turnos}
            />
          )}

          <Kpis dados={dadosKpis} />

          {secao === 'visao' && (
            <div className="grid gap-5 xl:grid-cols-2">
              <TopVotaveis dados={dadosTop} slots={slots} carregando={carregando} />
              <Participacao dados={dadosPart} />
            </div>
          )}

          {mostra('mapa') && (
            <>
              <Mapa
                municipios={municipios} locais={locaisMapa}
                slots={slots} carregando={carregando}
              />
              <RankingZonas dados={zonas} carregando={carregando} />
            </>
          )}

          {mostra('participacao') && secao !== 'visao' && <Participacao dados={dadosPart} />}

          {mostra('partidos') && (
            <RankingPartidos
              dados={dadosPartidos} ano={ano} anos={anos}
              aoTrocarAno={setAnoEscolhido} slots={slots}
            />
          )}

          {secao === 'cruzamento' && listas && (
            <Cruzamento
              eleicoes={listas.eleicoes} cargos={listas.cargos} cdMunicipio={filtros.cdMunicipio}
            />
          )}

          <Tabela
            linhas={linhas} grao={grao} aoTrocarGrao={setGrao} carregando={carregando}
          />

          <Conferencia dados={conferencia} carregando={carregando} />

          <footer className="pt-2 pb-6 text-sm text-tinta-3">
            <p>
              Fonte: dados abertos do Tribunal Superior Eleitoral. O painel considera
              o 1º turno das eleições regulares; eleições suplementares ficam de fora.
            </p>
            <p className="mt-1">Análise e elaboração: Isaac Kyerne — IKGeo</p>
          </footer>
        </div>
      </main>
    </div>
  )
}
