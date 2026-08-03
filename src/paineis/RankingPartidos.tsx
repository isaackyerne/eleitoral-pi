import { useMemo } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import type { VotoPartido } from '../dados/consultas'
import { useColapso } from '../estado/colapso'
import { useTema } from '../estado/tema'
import { BotaoColapsar } from '../ui/BotaoColapsar'
import { Nota } from '../ui/Nota'
import { SLOTS, OUTROS, TINTA, formataInteiro } from '../viz/paleta'

/**
 * Ranking de partidos num ano.
 *
 * Barra horizontal porque os rótulos são siglas de tamanhos diferentes e o
 * ranking se lê de cima para baixo.
 *
 * A cor vem do mapa fixo por partido, montado no App a partir do total da série
 * inteira. Trocar de ano reordena as barras mas **não** repinta ninguém — é a
 * regra de que cor segue a entidade, nunca a posição.
 */

type Props = {
  dados: VotoPartido[]
  ano: number
  anos: number[]
  aoTrocarAno: (ano: number) => void
  slots: Map<number, number>
}

function Dica({
  active, payload, total,
}: { active?: boolean; payload?: { payload: VotoPartido }[]; total: number }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border borda bg-superficie px-3 py-2 text-sm shadow-lg">
      <div className="font-medium text-tinta">{d.NM_PARTIDO}</div>
      <dl className="mt-1 space-y-0.5 text-tinta-2 tabular-nums">
        <div className="flex gap-3">
          <dt className="w-20">Votos</dt>
          <dd>{formataInteiro(d.VOTOS)}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-20">Share</dt>
          <dd>{((d.VOTOS / total) * 100).toFixed(1)}%</dd>
        </div>
      </dl>
    </div>
  )
}

export function RankingPartidos({ dados, ano, anos, aoTrocarAno, slots }: Props) {
  const modo = useTema()
  const t = TINTA[modo]
  const colapsado = useColapso((s) => s.colapsados['ranking-partidos'] ?? false)
  const alternar = useColapso((s) => s.alternar)
  const { linhas, total } = useMemo(() => {
    const doAno = dados.filter((d) => d.ANO_ELEICAO === ano)
    const total = doAno.reduce((s, d) => s + d.VOTOS, 0)
    return { linhas: [...doAno].sort((a, b) => b.VOTOS - a.VOTOS).slice(0, 10), total }
  }, [dados, ano])

  return (
    <section className="rounded-xl border borda bg-superficie p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-start gap-2">
            <h2 className="text-base font-semibold text-tinta">Partidos mais votados</h2>
            <Nota titulo="O que entra na conta">
              Soma os votos nos candidatos do partido e os votos na legenda.
              Partidos mudam de número entre eleições — a soma acompanha o
              partido, não o número.
            </Nota>
          </div>
          <p className="mt-1 text-sm text-tinta-2">
            Cada partido mantém sua cor ao trocar de ano, então dá para seguir um
            deles pela série.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1" role="group" aria-label="Ano da eleição">
            {anos.map((a) => (
              <button
                key={a}
                onClick={() => aoTrocarAno(a)}
                aria-pressed={a === ano}
                className={`rounded-md px-3 py-1.5 text-sm transition ${
                  a === ano
                    ? 'bg-tinta font-medium text-superficie'
                    : 'text-tinta-2 hover:bg-tinta/5'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          <BotaoColapsar aberto={!colapsado} aoAlternar={() => alternar('ranking-partidos')} rotulo="Partidos mais votados" />
        </div>
      </div>

      {!colapsado && (
        <div className="mt-5" style={{ height: linhas.length * 34 + 32 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={linhas}
              layout="vertical"
              margin={{ top: 4, right: 76, bottom: 4, left: 4 }}
            >
              <CartesianGrid stroke={t.grade} horizontal={false} />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="SG_PARTIDO"
                width={92}
                tickLine={false}
                axisLine={false}
                tick={{ fill: t.secundaria, fontSize: 12 }}
              />
              <Tooltip
                content={<Dica total={total} />}
                cursor={{ fill: 'color-mix(in srgb, currentColor 4%, transparent)' }}
              />
              <Bar dataKey="VOTOS" radius={[0, 4, 4, 0]} barSize={18}>
                {linhas.map((d) => (
                  <Cell key={d.SK_PARTIDO} fill={slots.has(d.SK_PARTIDO) ? SLOTS[modo][slots.get(d.SK_PARTIDO)!] : OUTROS} />
                ))}
                {/* Rótulo direto em todas as barras: alívio de contraste. */}
                <LabelList
                  dataKey="VOTOS"
                  position="right"
                  offset={8}
                  formatter={(v) => (typeof v === 'number' ? formataInteiro(v) : '')}
                  style={{ fill: t.secundaria, fontSize: 12 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}
