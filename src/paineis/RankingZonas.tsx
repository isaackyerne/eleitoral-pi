import { useMemo } from 'react'
import {
  Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { LinhaTabela } from '../dados/consultas'
import { useColapso } from '../estado/colapso'
import { useTema } from '../estado/tema'
import { BotaoColapsar } from '../ui/BotaoColapsar'
import { Nota } from '../ui/Nota'
import { TINTA, formataInteiro } from '../viz/paleta'

/**
 * Ranking de zonas eleitorais do recorte.
 *
 * Mesmo dado da Tabela em granularidade "zona", só que em barra — leitura
 * mais rápida de onde o voto se concentra. Sem cor por entidade: zona não é
 * uma série que atravessa recorte como partido, então uma cor sólida basta.
 */
function Dica({ active, payload }: { active?: boolean; payload?: { payload: LinhaTabela }[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border borda bg-superficie px-3 py-2 text-sm shadow-lg">
      <div className="font-medium text-tinta">{d.NOME}</div>
      {d.DETALHE && <div className="text-tinta-2">{d.DETALHE}</div>}
      <div className="tabular mt-1 text-tinta-2">{formataInteiro(d.VOTOS)} votos</div>
    </div>
  )
}

export function RankingZonas({
  dados, carregando,
}: {
  dados: LinhaTabela[]
  carregando: boolean
}) {
  const modo = useTema()
  const t = TINTA[modo]
  const colapsado = useColapso((s) => s.colapsados['ranking-zonas'] ?? false)
  const alternar = useColapso((s) => s.alternar)
  const top = useMemo(() => [...dados].sort((a, b) => b.VOTOS - a.VOTOS).slice(0, 15), [dados])

  return (
    <section className="rounded-xl border borda bg-superficie p-5">
      <div className="flex items-start gap-2">
        <h2 className="text-base font-semibold text-tinta">Zonas eleitorais mais votadas</h2>
        <Nota titulo="O que entra na conta">
          As 15 zonas com mais votos no recorte atual. Uma zona pode cobrir
          mais de um município — o detalhe mostra qual.
        </Nota>
        <BotaoColapsar aberto={!colapsado} aoAlternar={() => alternar('ranking-zonas')} rotulo="Zonas eleitorais mais votadas" />
      </div>

      {!colapsado && (
        carregando ? (
          <p className="mt-5 py-10 text-center text-sm text-tinta-3">Carregando…</p>
        ) : !top.length ? (
          <p className="mt-5 py-10 text-center text-sm text-tinta-3">
            Nada encontrado com esses filtros.
          </p>
        ) : (
          <div className="mt-5" style={{ height: top.length * 32 + 32 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top} layout="vertical" margin={{ top: 4, right: 68, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={t.grade} horizontal={false} />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="NOME"
                  width={110}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: t.secundaria, fontSize: 12 }}
                />
                <Tooltip content={<Dica />} cursor={{ fill: 'color-mix(in srgb, currentColor 4%, transparent)' }} />
                <Bar dataKey="VOTOS" fill={t.realce} radius={[0, 4, 4, 0]} barSize={16}>
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
        )
      )}
    </section>
  )
}
