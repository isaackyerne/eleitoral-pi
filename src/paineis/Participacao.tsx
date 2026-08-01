import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Participacao as Dado } from '../dados/consultas'
import { useTema } from '../estado/tema'
import { SLOTS, TINTA, formataInteiro, formataPct } from '../viz/paleta'

/**
 * Comparecimento por eleição.
 *
 * Barra, não linha: são quatro pleitos discretos, alternando esfera estadual e
 * municipal — uma linha sugeriria continuidade que não existe entre eles.
 *
 * A esfera é a única categoria, então bastam dois tons. Percentual de
 * comparecimento é comparável entre esferas; volume de voto não seria.
 */



function Dica({ active, payload }: { active?: boolean; payload?: { payload: Dado }[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border borda bg-superficie px-3 py-2 text-sm shadow-lg">
      <div className="font-medium text-tinta">
        {d.ANO_ELEICAO} · {d.TP_ESFERA}
      </div>
      <dl className="mt-1 space-y-0.5 text-tinta-2 tabular-nums">
        <div className="flex gap-3">
          <dt className="w-28">Comparecimento</dt>
          <dd>{formataPct(d.PCT_COMPARECIMENTO, 2)}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-28">Compareceram</dt>
          <dd>{formataInteiro(d.QT_COMPARECIMENTO)}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-28">Aptos</dt>
          <dd>{formataInteiro(d.QT_APTOS)}</dd>
        </div>
      </dl>
    </div>
  )
}

export function Participacao({ dados }: { dados: Dado[] }) {
  const modo = useTema()
  const t = TINTA[modo]
  const COR = { Estadual: SLOTS[modo][0], Municipal: SLOTS[modo][1] } as const
  return (
    <section className="rounded-xl border borda bg-superficie p-5">
      <h2 className="text-base font-semibold text-tinta">Comparecimento por eleição</h2>
      <p className="mt-1 text-sm text-tinta-2">
        Percentual dos aptos que compareceram. Anos pares alternam entre eleição
        estadual e municipal — o percentual é comparável entre as duas, o volume
        de votos não.
      </p>

      <div className="mt-5 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 20, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid stroke={t.grade} vertical={false} />
            <XAxis
              dataKey="ANO_ELEICAO"
              tickLine={false}
              axisLine={{ stroke: t.eixo }}
              tick={{ fill: t.suave, fontSize: 12 }}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickLine={false}
              axisLine={false}
              width={38}
              tick={{ fill: t.suave, fontSize: 12 }}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip content={<Dica />} cursor={{ fill: 'color-mix(in srgb, currentColor 4%, transparent)' }} />
            <Bar dataKey="PCT_COMPARECIMENTO" radius={[4, 4, 0, 0]} maxBarSize={72}>
              {dados.map((d) => (
                <Cell key={d.ANO_ELEICAO} fill={COR[d.TP_ESFERA as keyof typeof COR]} />
              ))}
              {/* Rótulo direto: é o alívio exigido pelos slots de baixo contraste. */}
              <LabelList
                dataKey="PCT_COMPARECIMENTO"
                position="top"
                offset={8}
                formatter={(v) => (typeof v === 'number' ? formataPct(v) : '')}
                style={{ fill: t.secundaria, fontSize: 12 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-4 flex gap-4 text-sm text-tinta-2">
        {(['Estadual', 'Municipal'] as const).map((esfera) => (
          <li key={esfera} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ background: COR[esfera] }}
            />
            {esfera}
          </li>
        ))}
      </ul>
    </section>
  )
}
