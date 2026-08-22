import { useMemo } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { PerfilLinha } from '../dados/consultas'
import { useColapso } from '../estado/colapso'
import { useTema } from '../estado/tema'
import { BotaoColapsar } from '../ui/BotaoColapsar'
import { Nota } from '../ui/Nota'
import { SLOTS, TINTA, formataInteiro, formataPct } from '../viz/paleta'

/**
 * Perfil demográfico do eleitorado atual da Bahia.
 *
 * Fonte própria (`fato_perfil_eleitorado`, do cadastro corrente do TSE, não
 * de uma eleição) — por isso só reage ao filtro de município, os demais
 * (eleição, cargo, partido, candidato) não entram na consulta.
 *
 * Cor/raça, identidade de gênero, quilombola e intérprete de libras têm
 * "não informado" em ~80% dos registros — autodeclaração é recente no
 * cadastro do TSE. Os dois primeiros excluem essa fatia do gráfico (que só
 * mostra quem se autodeclarou) e trazem o percentual à parte; os dois
 * últimos, quase binários fora do "não informado", viram indicador simples
 * em vez de gráfico.
 */

const NAO_INFORMADO = 'NÃO INFORMADO'

const ORDEM_FAIXA_ETARIA = [
  '15 anos', '16 anos', '17 anos', '18 anos', '19 anos', '20 anos',
  '21 a 24 anos', '25 a 29 anos', '30 a 34 anos', '35 a 39 anos',
  '40 a 44 anos', '45 a 49 anos', '50 a 54 anos', '55 a 59 anos',
  '60 a 64 anos', '65 a 69 anos', '70 a 74 anos', '75 a 79 anos',
  '80 a 84 anos', '85 a 89 anos', '90 a 94 anos', '95 a 99 anos',
  '100 anos ou mais', 'Inválida',
]

const ORDEM_GRAU_INSTRUCAO = [
  'ANALFABETO', 'LÊ E ESCREVE', 'ENSINO FUNDAMENTAL INCOMPLETO',
  'ENSINO FUNDAMENTAL COMPLETO', 'ENSINO MÉDIO INCOMPLETO',
  'ENSINO MÉDIO COMPLETO', 'SUPERIOR INCOMPLETO', 'SUPERIOR COMPLETO',
  NAO_INFORMADO,
]

function ordena(categorias: string[], ordem: string[]): string[] {
  const emOrdem = ordem.filter((c) => categorias.includes(c))
  const resto = categorias.filter((c) => !ordem.includes(c)).sort()
  return [...emOrdem, ...resto]
}

type Contagem = { categoria: string; qt: number }

function porDimensao(dados: PerfilLinha[], dimensao: string): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const d of dados) {
    if (d.DIMENSAO !== dimensao) continue
    mapa.set(d.CATEGORIA, (mapa.get(d.CATEGORIA) ?? 0) + d.QT_ELEITORES)
  }
  return mapa
}

function moda(mapa: Map<string, number>, excluir: readonly string[] = []): string | null {
  let melhor: string | null = null
  let max = -1
  for (const [cat, qt] of mapa) {
    if (excluir.includes(cat)) continue
    if (qt > max) { max = qt; melhor = cat }
  }
  return melhor
}

function soma(mapa: Map<string, number>, excluir: readonly string[] = []): number {
  let s = 0
  for (const [cat, qt] of mapa) if (!excluir.includes(cat)) s += qt
  return s
}

function capitaliza(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

/** Nome próprio de município: cada palavra maiúscula, exceto conectivos. */
function capitalizaNome(s: string): string {
  return s.toLowerCase().split(' ').map((p, i) => (i > 0 && CONECTIVOS.has(p) ? p : capitaliza(p))).join(' ')
}

function DicaBarra({
  active, payload, rotuloValor,
}: { active?: boolean; payload?: { payload: Contagem }[]; rotuloValor: string }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border borda bg-superficie px-3 py-2 text-sm shadow-lg">
      <div className="font-medium text-tinta">{d.categoria}</div>
      <dl className="mt-1 space-y-0.5 text-tinta-2 tabular-nums">
        <div className="flex gap-3">
          <dt className="w-24">{rotuloValor}</dt>
          <dd>{formataInteiro(d.qt)}</dd>
        </div>
      </dl>
    </div>
  )
}

/** Barra vertical — poucas categorias com rótulo curto (Gênero, Faixa Etária). */
function BarraVertical({
  dados, alturaGrafico = 220,
}: { dados: Contagem[]; alturaGrafico?: number }) {
  const modo = useTema()
  const t = TINTA[modo]
  return (
    <div style={{ height: alturaGrafico }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 20, right: 8, bottom: 4, left: dados.length > 8 ? 24 : 8 }}>
          <CartesianGrid stroke={t.grade} vertical={false} />
          <XAxis
            dataKey="categoria" tickLine={false} axisLine={{ stroke: t.eixo }}
            tick={{ fill: t.suave, fontSize: 11 }} interval={0}
            angle={dados.length > 8 ? -35 : 0} textAnchor={dados.length > 8 ? 'end' : 'middle'}
            height={dados.length > 8 ? 52 : 24}
          />
          <YAxis hide />
          <Tooltip content={<DicaBarra rotuloValor="Eleitores" />}
            cursor={{ fill: 'color-mix(in srgb, currentColor 4%, transparent)' }} />
          <Bar dataKey="qt" radius={[4, 4, 0, 0]} maxBarSize={48}>
            {dados.map((d, i) => (
              <Cell key={d.categoria} fill={SLOTS[modo][i % SLOTS[modo].length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Barra horizontal — muitas categorias ou rótulo longo (Grau, Estado Civil). */
function BarraHorizontal({ dados }: { dados: Contagem[] }) {
  const modo = useTema()
  const t = TINTA[modo]
  return (
    <div style={{ height: dados.length * 30 + 20 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 60, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={t.grade} horizontal={false} />
          <XAxis type="number" hide />
          <YAxis
            type="category" dataKey="categoria" width={160}
            tickLine={false} axisLine={false} tick={{ fill: t.secundaria, fontSize: 11 }}
            tickFormatter={(v: string) => capitaliza(v)}
          />
          <Tooltip content={<DicaBarra rotuloValor="Eleitores" />}
            cursor={{ fill: 'color-mix(in srgb, currentColor 4%, transparent)' }} />
          <Bar dataKey="qt" radius={[0, 4, 4, 0]} barSize={16}>
            {dados.map((d, i) => (
              <Cell key={d.categoria} fill={SLOTS[modo][i % SLOTS[modo].length]} />
            ))}
            <LabelList dataKey="qt" position="right" offset={8}
              formatter={(v) => (typeof v === 'number' ? formataInteiro(v) : '')}
              style={{ fill: t.secundaria, fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Rosca — categorias binárias/pequenas (Gênero, Cor/Raça entre informados). */
function Rosca({ dados, total }: { dados: Contagem[]; total: number }) {
  const modo = useTema()
  return (
    <div className="flex items-center gap-4">
      <div className="h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={dados} dataKey="qt" nameKey="categoria" innerRadius="62%" outerRadius="100%"
              paddingAngle={1} strokeWidth={0}>
              {dados.map((d, i) => (
                <Cell key={d.categoria} fill={SLOTS[modo][i % SLOTS[modo].length]} />
              ))}
            </Pie>
            <Tooltip content={<DicaBarra rotuloValor="Eleitores" />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {dados.map((d, i) => (
          <li key={d.categoria} className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full"
              style={{ background: SLOTS[modo][i % SLOTS[modo].length] }} />
            <span className="min-w-0 flex-1 truncate text-tinta-2">{capitaliza(d.categoria)}</span>
            <span className="shrink-0 tabular-nums text-tinta">{formataPct((d.qt / total) * 100)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Cartao({
  titulo, nota, children,
}: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border borda bg-superficie p-5">
      <div className="flex items-start gap-2">
        <h3 className="text-sm font-semibold text-tinta">{titulo}</h3>
        {nota && <Nota titulo={titulo}>{nota}</Nota>}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

function Indicador({ rotulo, valor, pct }: { rotulo: string; valor: number; pct: number }) {
  return (
    <div className="rounded-lg bg-tinta/5 px-3 py-2.5">
      <div className="text-xs text-tinta-3">{rotulo}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums text-tinta">{formataInteiro(valor)}</span>
        <span className="text-xs tabular-nums text-tinta-3">({formataPct(pct)})</span>
      </div>
    </div>
  )
}

export function PerfilEleitorado({
  dados, nomeMunicipio,
}: { dados: PerfilLinha[]; nomeMunicipio: string | null }) {
  const colapsado = useColapso((s) => s.colapsados.perfil ?? false)
  const alternar = useColapso((s) => s.alternar)
  const localCurto = nomeMunicipio ? capitalizaNome(nomeMunicipio) : 'Bahia'
  const local = nomeMunicipio ? `de ${localCurto}` : 'da Bahia'

  const dm = useMemo(() => {
    const genero = porDimensao(dados, 'GENERO')
    const faixaEtaria = porDimensao(dados, 'FAIXA_ETARIA')
    const grauInstrucao = porDimensao(dados, 'GRAU_INSTRUCAO')
    const corRaca = porDimensao(dados, 'COR_RACA')
    const estadoCivil = porDimensao(dados, 'ESTADO_CIVIL')
    const identidadeGenero = porDimensao(dados, 'IDENTIDADE_GENERO')
    const quilombola = porDimensao(dados, 'QUILOMBOLA')
    const libras = porDimensao(dados, 'INTERPRETE_LIBRAS')

    const total = soma(genero)
    const jovens = (faixaEtaria.get('16 anos') ?? 0) + (faixaEtaria.get('17 anos') ?? 0)

    const modaGenero = moda(genero, [NAO_INFORMADO])
    const modaFaixa = moda(faixaEtaria, ['Inválida'])
    const modaGrau = moda(grauInstrucao, [NAO_INFORMADO])

    const paraLista = (mapa: Map<string, number>, ordem?: string[]): Contagem[] => {
      const cats = ordem ? ordena([...mapa.keys()], ordem) : [...mapa.keys()].sort((a, b) => (mapa.get(b) ?? 0) - (mapa.get(a) ?? 0))
      return cats.map((categoria) => ({ categoria, qt: mapa.get(categoria) ?? 0 }))
    }

    const informadosCorRaca = soma(corRaca, [NAO_INFORMADO])
    const informadosIdentidade = soma(identidadeGenero, [NAO_INFORMADO])

    return {
      total, jovens,
      pctJovens: total > 0 ? (jovens / total) * 100 : 0,
      modaGenero, modaFaixa, modaGrau,
      genero: paraLista(genero),
      faixaEtaria: paraLista(faixaEtaria, ORDEM_FAIXA_ETARIA),
      grauInstrucao: paraLista(grauInstrucao, ORDEM_GRAU_INSTRUCAO),
      estadoCivil: paraLista(estadoCivil),
      corRaca: paraLista(corRaca).filter((d) => d.categoria !== NAO_INFORMADO),
      informadosCorRaca,
      pctNaoInformadoCorRaca: total > 0 ? (soma(corRaca, []) - informadosCorRaca) / soma(corRaca, []) * 100 : 0,
      identidadeGenero: paraLista(identidadeGenero).filter((d) => d.categoria !== NAO_INFORMADO),
      informadosIdentidade,
      quilomboSim: quilombola.get('SIM') ?? 0,
      quilomboTotal: soma(quilombola),
      librasSim: libras.get('SIM') ?? 0,
      librasTotal: soma(libras),
    }
  }, [dados])

  if (dados.length === 0) return null

  return (
    <section className="rounded-xl border borda bg-superficie p-5">
      <div className="flex items-start gap-2">
        <h2 className="text-base font-semibold text-tinta">Perfil do eleitorado</h2>
        <Nota titulo="De onde vem este dado">
          Cadastro corrente do TSE (não é uma eleição específica) — retrato de
          quem está apto a votar hoje, não de quem votou em cada pleito.
        </Nota>
        <BotaoColapsar aberto={!colapsado} aoAlternar={() => alternar('perfil')} rotulo="Perfil do eleitorado" />
      </div>

      {!colapsado && (
        <div className="mt-5 space-y-5">
          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <div className="rounded-xl bg-realce/10 p-5">
              <div className="text-xs font-medium tracking-wide text-realce uppercase">
                Perfil típico
              </div>
              <p className="mt-2 text-lg leading-relaxed text-tinta">
                O eleitor típico {local} é{' '}
                <strong className="text-realce">{modaGeneroTexto(dm.modaGenero)}</strong>, tem entre{' '}
                <strong className="text-realce">{dm.modaFaixa ?? '—'}</strong> e possui{' '}
                <strong className="text-realce">{dm.modaGrau ? capitaliza(dm.modaGrau) : '—'}</strong>.
              </p>
              <p className="mt-2 text-xs text-tinta-3">
                Baseado nos grupos majoritários {local}. Eleitorado total: {formataInteiro(dm.total)}.
              </p>
            </div>
            <div className="rounded-xl border borda p-5">
              <div className="text-xs font-medium tracking-wide text-tinta-3 uppercase">
                Potencial de renovação
              </div>
              <p className="mt-1 text-xs text-tinta-3">Jovens de 16 e 17 anos (1º voto)</p>
              <div className="mt-2 text-3xl font-semibold tabular-nums text-tinta">
                {formataInteiro(dm.jovens)}
              </div>
              <div className="mt-1 text-sm tabular-nums text-tinta-3">{formataPct(dm.pctJovens, 2)} do eleitorado</div>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Cartao titulo="Gênero">
              <Rosca dados={dm.genero} total={dm.total} />
            </Cartao>
            <Cartao titulo="Faixa etária">
              <BarraVertical dados={dm.faixaEtaria} />
            </Cartao>
            <Cartao titulo="Grau de instrução">
              <BarraHorizontal dados={dm.grauInstrucao} />
            </Cartao>
            <Cartao titulo="Estado civil">
              <BarraHorizontal dados={dm.estadoCivil} />
            </Cartao>
            <Cartao
              titulo="Cor/raça"
              nota={`${formataPct(dm.pctNaoInformadoCorRaca)} do eleitorado não informou cor/raça — o gráfico mostra só quem se autodeclarou (${formataInteiro(dm.informadosCorRaca)} eleitores).`}
            >
              {dm.corRaca.length > 0
                ? <Rosca dados={dm.corRaca} total={dm.informadosCorRaca} />
                : <p className="text-sm text-tinta-3">Sem autodeclaração de cor/raça neste recorte.</p>}
            </Cartao>
            <Cartao
              titulo="Identidade de gênero"
              nota="A maioria do cadastro não informa identidade de gênero — o gráfico mostra só quem se autodeclarou."
            >
              {dm.identidadeGenero.length > 0
                ? <Rosca dados={dm.identidadeGenero} total={dm.informadosIdentidade} />
                : <p className="text-sm text-tinta-3">Sem autodeclaração de identidade de gênero neste recorte.</p>}
            </Cartao>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Indicador rotulo="Quilombola (autodeclarado)" valor={dm.quilomboSim}
              pct={dm.quilomboTotal > 0 ? (dm.quilomboSim / dm.quilomboTotal) * 100 : 0} />
            <Indicador rotulo="Usa intérprete de libras" valor={dm.librasSim}
              pct={dm.librasTotal > 0 ? (dm.librasSim / dm.librasTotal) * 100 : 0} />
          </div>
        </div>
      )}
    </section>
  )
}

function modaGeneroTexto(g: string | null): string {
  if (g === null) return '—'
  return g.toLowerCase()
}