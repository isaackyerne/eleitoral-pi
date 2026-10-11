import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  candidaturasDoPolitico, locaisDoMunicipio, politicosDoMunicipio, secoesDoLocal,
  votosPorSecao, votosPorTerritorio,
  type CelulaSecao, type CelulaTerritorio, type ColunaTerritorio, type LocalTerritorio,
  type OpcaoPolitico,
} from '../dados/consultas'
import { exportarExcel } from '../dados/excel'
import { Busca, Campo } from '../ui/Campo'
import { Nota } from '../ui/Nota'
import { formataInteiro } from '../viz/paleta'

/**
 * Votação de uma ou mais pessoas por bairro → escola → seção.
 *
 * Escolhe-se o político, não a eleição: `SK_POLITICO` liga a mesma pessoa
 * entre cargos e anos, então cada candidatura dela com voto no município vira
 * uma coluna (Ver. 2020, Ver. 2024, Dep. Fed. 2026…). Cada célula traz os votos
 * e a colocação da pessoa **naquele recorte**, entre os candidatos do mesmo
 * cargo e eleição — o 1º de um bairro não é necessariamente o 1º de cada
 * escola dele, nem de cada seção.
 *
 * Casamento por `SK_LOCAL` (e bairro mais recente do local), não por número de
 * local do TSE, então escolas que mudaram de número entre eleições continuam
 * numa linha só. As seções vêm de `fato_votos_secao`, baixada só quando alguém
 * abre as seções de uma escola; a numeração de seção pode mudar entre eleições,
 * e a linha mostra a união delas.
 *
 * Mede onde a pessoa teve voto, não quem votou nela — é leitura territorial,
 * não do eleitor individual.
 */

const MAX_PESSOAS = 3

const ABREVIACAO_CARGO: Record<string, string> = {
  Prefeito: 'Pref.', Vereador: 'Ver.', Governador: 'Gov.', Senador: 'Sen.',
  'Deputado Federal': 'Dep. Fed.', 'Deputado Estadual': 'Dep. Est.',
}

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

/** "CAIXA DAGUA" → "Caixa Dagua" — o cadastro do TSE vem todo em maiúsculas. */
function titulo(s: string): string {
  return s.toLocaleLowerCase('pt-BR').split(' ')
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1)))
    .join(' ')
}

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter((x) => x.length > 2 || x.length === 1)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toLocaleUpperCase('pt-BR')
}

// Mesmas cores fixas do resto do painel (PT vermelho, PP azul); o resto cai numa
// paleta genérica só para distinguir pessoas, sem significado de partido.
const CORES_AVATAR = ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7', '#b0398a', '#6b7280']
function corAvatar(sg: string | null, pessoa: number): string {
  if (sg === 'PT') return '#E4142C'
  if (sg === 'PP') return '#234F74'
  return CORES_AVATAR[pessoa % CORES_AVATAR.length]
}

type Coluna = ColunaTerritorio & { chave: string; pessoa: number }
type Mapas = { L: Map<string, CelulaTerritorio>; B: Map<string, CelulaTerritorio>; M: CelulaTerritorio | null }

type Carregado = { chave: string; colunas: Coluna[]; mapas: Mapas[] }
type DadosSecao = { nrs: number[]; porColuna: Map<number, CelulaSecao>[] }

function Celula({ c, pequena = false }: {
  c: { VOTOS: number; POSICAO: number; CONCORRENTES: number } | undefined | null
  pequena?: boolean
}) {
  if (!c || c.VOTOS <= 0) return <span className="text-tinta-3">—</span>
  return (
    <span
      className="whitespace-nowrap"
      title={`${c.POSICAO}º entre ${formataInteiro(c.CONCORRENTES)} candidatos com voto neste recorte`}
    >
      <span className={`tabular text-tinta ${pequena ? 'text-tinta-2' : 'font-bold'}`}>
        {formataInteiro(Math.round(c.VOTOS))}
      </span>{' '}
      <span className={`tabular text-xs ${c.POSICAO === 1 ? 'font-bold text-tinta' : 'text-tinta-3'}`}>
        ({c.POSICAO}º)
      </span>
    </span>
  )
}

function Avatar({ nome, cor }: { nome: string; cor: string }) {
  return (
    <span
      aria-hidden
      className="mx-auto flex size-10 items-center justify-center rounded-full text-sm font-semibold text-white ring-2 ring-offset-2 ring-offset-superficie"
      style={{ background: cor, ['--tw-ring-color' as string]: cor }}
    >
      {iniciais(nome)}
    </span>
  )
}

export function VotacaoPorBairro({
  cdMunicipio, nomeMunicipio,
}: {
  cdMunicipio: number | null
  nomeMunicipio: string | null
}) {
  // Quem monta este painel passa `key={cdMunicipio}`: trocar de município
  // reinicia a escolha de pessoas e as listas.
  const [opcoes, setOpcoes] = useState<OpcaoPolitico[]>([])
  const [locais, setLocais] = useState<LocalTerritorio[]>([])
  const [pessoas, setPessoas] = useState<number[]>([])
  const [carregado, setCarregado] = useState<Carregado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [secoesAbertas, setSecoesAbertas] = useState<Set<number>>(new Set())
  const [secoes, setSecoes] = useState<Record<string, DadosSecao>>({})
  const [ordem, setOrdem] = useState<number | null>(null)
  // Candidaturas escondidas pelo usuário (chave da coluna); começa tudo visível.
  const [ocultas, setOcultas] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (cdMunicipio === null) return
    let vivo = true
    Promise.all([politicosDoMunicipio(cdMunicipio), locaisDoMunicipio(cdMunicipio)])
      .then(([p, l]) => { if (vivo) { setOpcoes(p); setLocais(l) } })
      .catch((e: unknown) => { if (vivo) setErro(String(e)) })
    return () => { vivo = false }
  }, [cdMunicipio])

  const chavePedido = cdMunicipio === null ? '' : `${cdMunicipio}:${pessoas.join(',')}`
  useEffect(() => {
    if (cdMunicipio === null || !pessoas.length) return
    let vivo = true
    ;(async () => {
      const porPessoa = await Promise.all(pessoas.map((p) => candidaturasDoPolitico(p, cdMunicipio)))
      const colunas: Coluna[] = porPessoa.flatMap((cs, i) =>
        cs.map((c) => ({ ...c, chave: `${pessoas[i]}:${c.SK_VOTAVEL}`, pessoa: i })))
      const celulas = await Promise.all(colunas.map((c) =>
        votosPorTerritorio({ skEleicao: c.SK_ELEICAO, cdCargo: c.CD_CARGO, skVotavel: c.SK_VOTAVEL }, cdMunicipio)))
      const mapas: Mapas[] = celulas.map((cs) => {
        const m: Mapas = { L: new Map(), B: new Map(), M: null }
        for (const c of cs) {
          if (c.NIVEL === 'M') m.M = c
          else m[c.NIVEL].set(c.CHAVE, c)
        }
        return m
      })
      if (vivo) setCarregado({ chave: chavePedido, colunas, mapas })
    })().catch((e: unknown) => { if (vivo) setErro(String(e)) })
    return () => { vivo = false }
  }, [cdMunicipio, pessoas, chavePedido])

  const completo = carregado && carregado.chave === chavePedido ? carregado : null
  // O filtro de candidaturas age aqui, nos dados, para que tabela, seções e Excel
  // enxerguem só as colunas escolhidas. A chave inclui a seleção: o cache de seções
  // depende de quais colunas estão visíveis.
  const dados = useMemo<Carregado | null>(() => {
    if (!completo) return null
    const manter = completo.colunas.map((c) => !ocultas.has(c.chave))
    const colunas = completo.colunas.filter((_, i) => manter[i])
    return {
      chave: `${completo.chave}|${colunas.map((c) => c.chave).join(',')}`,
      colunas,
      mapas: completo.mapas.filter((_, i) => manter[i]),
    }
  }, [completo, ocultas])
  const carregando = pessoas.length > 0 && !completo && !erro

  function alternaColuna(chave: string) {
    setOcultas((s) => {
      const n = new Set(s)
      if (n.has(chave)) n.delete(chave)
      else n.add(chave)
      return n
    })
    setOrdem(null)
    setSecoesAbertas(new Set())
  }

  const linhas = useMemo(() => {
    if (!dados) return []
    const { mapas } = dados
    const porBairro = new Map<string, LocalTerritorio[]>()
    for (const l of locais) {
      const tem = mapas.some((m) => (m.L.get(String(l.SK_LOCAL))?.VOTOS ?? 0) > 0)
      if (!tem) continue
      const lista = porBairro.get(l.BAIRRO) ?? []
      lista.push(l)
      porBairro.set(l.BAIRRO, lista)
    }
    const votosEm = (nivel: 'L' | 'B', chave: string, col: number) => mapas[col][nivel].get(chave)?.VOTOS ?? 0
    const cmpNome = (a: string, b: string) => a.localeCompare(b, 'pt-BR')

    return [...porBairro.entries()]
      .map(([bairro, ls]) => ({
        bairro,
        locais: [...ls].sort((a, b) => (ordem !== null
          ? votosEm('L', String(b.SK_LOCAL), ordem) - votosEm('L', String(a.SK_LOCAL), ordem)
          : 0) || cmpNome(a.NM_LOCAL, b.NM_LOCAL)),
      }))
      .sort((a, b) => (ordem !== null ? votosEm('B', b.bairro, ordem) - votosEm('B', a.bairro, ordem) : 0)
        || cmpNome(a.bairro, b.bairro))
  }, [dados, locais, ordem])

  function alterna(bairro: string) {
    setAbertos((s) => {
      const n = new Set(s)
      if (n.has(bairro)) n.delete(bairro)
      else n.add(bairro)
      return n
    })
  }

  // As seções de uma escola só são consultadas (e a tabela baixada) na primeira
  // vez que ela é aberta; depois ficam em cache até as colunas mudarem.
  async function alternaSecoes(skLocal: number) {
    if (!dados) return
    const aberta = secoesAbertas.has(skLocal)
    setSecoesAbertas((s) => {
      const n = new Set(s)
      if (aberta) n.delete(skLocal)
      else n.add(skLocal)
      return n
    })
    const ref = `${dados.chave}|${skLocal}`
    if (aberta || secoes[ref]) return
    try {
      const eleicoes = [...new Set(dados.colunas.map((c) => c.SK_ELEICAO))]
      const [nrs, porColuna] = await Promise.all([
        secoesDoLocal(skLocal, eleicoes),
        Promise.all(dados.colunas.map((c) =>
          votosPorSecao({ skEleicao: c.SK_ELEICAO, cdCargo: c.CD_CARGO, skVotavel: c.SK_VOTAVEL }, skLocal))),
      ])
      setSecoes((s) => ({
        ...s,
        [ref]: { nrs, porColuna: porColuna.map((rs) => new Map(rs.map((r) => [r.NR_SECAO, r]))) },
      }))
    } catch (e) {
      setErro(String(e))
    }
  }

  function exportar() {
    if (!dados) return
    const { colunas, mapas } = dados
    const rotulo = (c: Coluna) => `${c.NOME} · ${ABREVIACAO_CARGO[c.DS_CARGO] ?? c.DS_CARGO} ${c.ANO_ELEICAO}`
    const cabecalho = colunas.flatMap((c) => [
      { titulo: `${rotulo(c)} — votos`, tipo: 'inteiro' as const, largura: 18 },
      { titulo: `${rotulo(c)} — colocação`, tipo: 'inteiro' as const, largura: 14 },
    ])
    const par = (cel: { VOTOS: number; POSICAO: number } | undefined | null) => [
      cel ? Math.round(cel.VOTOS) : null, cel ? cel.POSICAO : null,
    ]
    const saida: (string | number | null)[][] = [
      ['Total do município', '', '', '', ...mapas.flatMap((m) => par(m.M))],
    ]
    for (const l of linhas) {
      saida.push([titulo(l.bairro), '', '', '', ...mapas.flatMap((m) => par(m.B.get(l.bairro)))])
      for (const loc of l.locais) {
        saida.push([titulo(l.bairro), titulo(loc.NM_LOCAL), loc.NR_ZONA, '',
          ...mapas.flatMap((m) => par(m.L.get(String(loc.SK_LOCAL))))])
        const s = secoes[`${dados.chave}|${loc.SK_LOCAL}`]
        if (!s) continue // seção só sai na planilha das escolas que foram abertas na tela
        for (const nr of s.nrs) {
          saida.push([titulo(l.bairro), titulo(loc.NM_LOCAL), loc.NR_ZONA, nr,
            ...s.porColuna.flatMap((m) => par(m.get(nr)))])
        }
      }
    }
    exportarExcel(
      `eleitoral-pi-votacao-por-bairro-${(nomeMunicipio ?? 'municipio').toLowerCase().replace(/\s+/g, '-')}.xlsx`,
      [
        { titulo: 'Bairro', tipo: 'texto', largura: 28 },
        { titulo: 'Local de votação', tipo: 'texto', largura: 44 },
        { titulo: 'Zona', tipo: 'inteiro', largura: 8 },
        { titulo: 'Seção', tipo: 'inteiro', largura: 8 },
        ...cabecalho,
      ],
      saida,
      {
        aba: 'Votação por bairro',
        observacao: `${nomeMunicipio ?? ''} — votos e colocação do candidato em cada bairro, local de votação e (nas escolas abertas na tela) seção.`,
      },
    )
  }

  const opcoesBusca = useMemo(
    () => opcoes
      .filter((o) => !pessoas.includes(o.SK_POLITICO))
      .map((o) => ({
        valor: o.SK_POLITICO,
        rotulo: o.NM_URNA === o.NM_POLITICO ? `${o.NM_URNA} (${o.ANOS})` : `${o.NM_URNA} — ${o.NM_POLITICO} (${o.ANOS})`,
      })),
    [opcoes, pessoas],
  )
  const nomePessoa = (sk: number) => opcoes.find((o) => o.SK_POLITICO === sk)?.NM_URNA ?? `#${sk}`

  if (cdMunicipio === null) {
    return (
      <section className="rounded-xl border borda bg-superficie p-5">
        <h2 className="text-base font-semibold text-tinta">Votação por bairro</h2>
        <p className="mt-2 text-sm text-tinta-2">
          Escolha um município na barra de filtros para ver a votação de um candidato bairro a bairro.
        </p>
      </section>
    )
  }

  const colunas = dados?.colunas ?? []

  return (
    <section className="space-y-4">
      <div className="rounded-xl border borda bg-superficie p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-tinta">
            Votação por bairro{nomeMunicipio ? ` · ${titulo(nomeMunicipio)}` : ''}
          </h2>
          <Nota titulo="Como ler">
            Cada coluna é uma candidatura da pessoa escolhida, em qualquer eleição. O número é
            o total de votos no recorte; entre parênteses, a colocação dela entre os candidatos
            do mesmo cargo e eleição naquele bairro, escola ou seção. O bairro é o do cadastro
            mais recente do local de votação. A numeração das seções muda entre eleições: ao abrir
            uma escola, a lista reúne as seções de todos os anos das colunas, e uma seção que não
            existia naquele ano aparece com "—". Mostra onde a pessoa teve voto, não quem votou nela.
          </Nota>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,22rem)_1fr] sm:items-end">
          <Campo rotulo={pessoas.length ? 'Acrescentar outra pessoa' : 'Candidato'}>
            <Busca
              valor={null}
              vazio={pessoas.length >= MAX_PESSOAS ? `Máximo de ${MAX_PESSOAS} pessoas` : 'Buscar pelo nome…'}
              placeholder="Nome ou nome de urna…"
              opcoes={pessoas.length >= MAX_PESSOAS ? [] : opcoesBusca}
              aoMudar={(v) => {
                if (v !== null) { setPessoas((p) => [...p, v]); setOrdem(null); setSecoesAbertas(new Set()) }
              }}
            />
          </Campo>
          <div className="flex flex-wrap items-center gap-2">
            {pessoas.map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5 rounded-full border borda px-2.5 py-1 text-sm text-tinta">
                {nomePessoa(p)}
                <button
                  type="button" aria-label={`Remover ${nomePessoa(p)}`}
                  onClick={() => { setPessoas((l) => l.filter((x) => x !== p)); setOrdem(null); setSecoesAbertas(new Set()) }}
                  className="text-tinta-3 hover:text-tinta"
                >×</button>
              </span>
            ))}
            {dados && linhas.length > 0 && (
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => setAbertos(abertos.size ? new Set() : new Set(linhas.map((l) => l.bairro)))}
                  className="rounded-lg border borda px-3 py-1.5 text-sm text-tinta hover:bg-tinta/5"
                >
                  {abertos.size ? 'Recolher todos' : 'Expandir todos'}
                </button>
                <button
                  type="button" onClick={exportar}
                  className="rounded-lg border borda px-3 py-1.5 text-sm text-tinta hover:bg-tinta/5"
                >
                  Exportar Excel
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      {erro && <p className="text-sm text-[#d03b3b]">Não foi possível carregar: {erro}</p>}
      {!pessoas.length && !erro && (
        <p className="rounded-xl border borda bg-superficie p-5 text-sm text-tinta-2">
          Busque um candidato para ver a votação dele por bairro, escola e seção.
          {opcoes.length > 0 && ` ${formataInteiro(opcoes.length)} pessoas com voto neste município.`}
        </p>
      )}
      {carregando && <p className="text-sm text-tinta-3">Carregando…</p>}
      {completo && completo.colunas.length > 0 && (
        <div className="rounded-xl border borda bg-superficie p-4">
          <p className="text-xs font-medium text-tinta-3">Candidaturas exibidas</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {completo.colunas.map((c) => {
              const ligada = !ocultas.has(c.chave)
              return (
                <button
                  key={c.chave} type="button" onClick={() => alternaColuna(c.chave)}
                  aria-pressed={ligada}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    ligada
                      ? 'border-realce bg-realce/10 text-realce'
                      : 'borda text-tinta-3 line-through hover:bg-tinta/5'
                  }`}
                >
                  {c.NOME} · {ABREVIACAO_CARGO[c.DS_CARGO] ?? c.DS_CARGO} {c.ANO_ELEICAO}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {completo && !completo.colunas.length && (
        <p className="rounded-xl border borda bg-superficie p-5 text-sm text-tinta-2">
          Nenhuma candidatura com voto neste município.
        </p>
      )}
      {completo && completo.colunas.length > 0 && !colunas.length && (
        <p className="rounded-xl border borda bg-superficie p-5 text-sm text-tinta-2">
          Todas as candidaturas estão ocultas. Marque pelo menos uma acima.
        </p>
      )}

      {dados && colunas.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border borda bg-superficie">
          <table className="w-full min-w-[40rem] border-collapse">
            <thead>
              <tr className="border-b borda align-bottom">
                <th className="sticky left-0 z-10 bg-superficie px-5 py-4 text-left text-[15px] font-bold text-tinta">
                  Bairro / escola / seção
                </th>
                {colunas.map((c, i) => (
                  <th key={c.chave} className="min-w-32 px-3 py-4 text-center font-normal">
                    <button
                      type="button"
                      onClick={() => setOrdem(ordem === i ? null : i)}
                      className="mx-auto block w-full rounded-lg px-1 py-1 hover:bg-tinta/5"
                      title={ordem === i ? 'Voltar à ordem alfabética' : 'Ordenar por esta coluna'}
                    >
                      <Avatar nome={c.NOME} cor={corAvatar(c.SG_PARTIDO, c.pessoa)} />
                      <span className="mt-2 block text-[15px] font-bold text-tinta">{c.NOME}</span>
                      <span className="block text-xs text-tinta-2">
                        {ABREVIACAO_CARGO[c.DS_CARGO] ?? c.DS_CARGO} {c.ANO_ELEICAO}
                        {c.SG_PARTIDO ? ` · ${c.SG_PARTIDO}` : ''}
                      </span>
                      {(c.DS_SIT_TOT_TURNO?.toUpperCase().startsWith('ELEITO') || ordem === i) && (
                        <span className="block text-xs font-semibold text-realce">
                          {c.DS_SIT_TOT_TURNO?.toUpperCase().startsWith('ELEITO') ? 'Eleito' : ''}
                          {ordem === i ? ' ↓' : ''}
                        </span>
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b borda bg-tinta/[0.04]">
                <td className="sticky left-0 bg-superficie px-5 py-3.5 font-bold text-tinta">
                  Total do município
                </td>
                {dados.mapas.map((m, i) => (
                  <td key={colunas[i].chave} className="px-3 py-3.5 text-center"><Celula c={m.M} /></td>
                ))}
              </tr>
              {linhas.map((l) => {
                const aberto = abertos.has(l.bairro)
                return (
                  <Fragment key={l.bairro}>
                    <tr className="border-b borda hover:bg-tinta/[0.02]">
                      <td className="sticky left-0 bg-superficie px-5 py-3.5">
                        <button
                          type="button" onClick={() => alterna(l.bairro)} aria-expanded={aberto}
                          className="flex items-baseline gap-2 text-left"
                        >
                          <span aria-hidden className="text-xs text-tinta-3">{aberto ? '▾' : '▸'}</span>
                          <span className="text-[15px] font-bold text-tinta">{titulo(l.bairro)}</span>
                          <span className="text-sm text-tinta-3">
                            ({l.locais.length} {l.locais.length === 1 ? 'escola' : 'escolas'})
                          </span>
                        </button>
                      </td>
                      {dados.mapas.map((m, i) => (
                        <td key={colunas[i].chave} className="px-3 py-3.5 text-center"><Celula c={m.B.get(l.bairro)} /></td>
                      ))}
                    </tr>
                    {aberto && l.locais.map((loc) => {
                      const secAberta = secoesAbertas.has(loc.SK_LOCAL)
                      const s = secoes[`${dados.chave}|${loc.SK_LOCAL}`]
                      return (
                        <Fragment key={loc.SK_LOCAL}>
                          <tr className="border-b borda bg-tinta/[0.02]">
                            <td className="sticky left-0 bg-superficie py-3 pr-4 pl-10">
                              <span className="block font-medium text-tinta-2">{titulo(loc.NM_LOCAL)}</span>
                              <span className="block text-sm text-tinta-3">
                                Zona {loc.NR_ZONA}
                                {loc.QT_SECOES > 0 && (
                                  <>
                                    {' · '}
                                    <button
                                      type="button" onClick={() => alternaSecoes(loc.SK_LOCAL)}
                                      aria-expanded={secAberta}
                                      className="font-semibold text-realce hover:underline"
                                    >
                                      {secAberta ? '▾' : '▸'} {s ? s.nrs.length : loc.QT_SECOES}{' '}
                                      {(s ? s.nrs.length : loc.QT_SECOES) === 1 ? 'seção' : 'seções'}
                                    </button>
                                  </>
                                )}
                              </span>
                            </td>
                            {dados.mapas.map((m, i) => (
                              <td key={colunas[i].chave} className="px-3 py-3 text-center">
                                <Celula c={m.L.get(String(loc.SK_LOCAL))} pequena />
                              </td>
                            ))}
                          </tr>
                          {secAberta && !s && (
                            <tr className="border-b borda">
                              <td colSpan={colunas.length + 1} className="py-2 pl-16 text-sm text-tinta-3">
                                Carregando seções…
                              </td>
                            </tr>
                          )}
                          {secAberta && s && s.nrs.map((nr) => (
                            <tr key={nr} className="border-b borda">
                              <td className="sticky left-0 bg-superficie py-2.5 pr-4 pl-16 text-sm text-tinta-2">
                                Seção {nr}
                              </td>
                              {s.porColuna.map((m, i) => (
                                <td key={colunas[i].chave} className="px-3 py-2.5 text-center text-sm">
                                  <Celula c={m.get(nr)} pequena />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </Fragment>
                      )
                    })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
