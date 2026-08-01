import type { VotavelTop } from '../dados/consultas'
import { useTema } from '../estado/tema'
import { Nota } from '../ui/Nota'
import { OUTROS, SLOTS, formataInteiro, formataPct } from '../viz/paleta'

/**
 * Mais votados do recorte.
 *
 * Barra horizontal em HTML, não em biblioteca de gráfico: com até oito linhas e
 * rótulo em cada uma, a marca é um retângulo de largura proporcional — não
 * compensa o peso de um SVG com escala.
 *
 * Branco e nulo entram na lista porque são parte do resultado, mas em cinza:
 * não são entidade, e colori-los como se fossem sugeriria que disputam.
 */
export function TopVotaveis({
  dados, slots, carregando,
}: {
  dados: VotavelTop[]
  slots: Map<number, number>
  carregando: boolean
}) {
  const modo = useTema()
  const maior = dados[0]?.VOTOS ?? 0
  const total = dados.reduce((s, d) => s + d.VOTOS, 0)

  function cor(d: VotavelTop): string {
    if (d.TP_VOTO !== 'Nominal' && d.TP_VOTO !== 'Legenda') return OUTROS
    const i = d.SK_PARTIDO === null ? undefined : slots.get(d.SK_PARTIDO)
    return i === undefined ? OUTROS : SLOTS[modo][i]
  }

  return (
    <section className="rounded-xl border borda bg-superficie p-5">
      <div className="flex items-start gap-2">
        <h2 className="text-base font-semibold text-tinta">Mais votados</h2>
        <Nota titulo="Sobre a contagem">
          Em 2018 cada eleitor votou em dois senadores. Para que os cargos e os
          anos fiquem comparáveis, esses votos são divididos pelo número de
          vagas.
        </Nota>
      </div>
      <p className="mt-1 text-sm text-tinta-2">
        A barra mostra o tamanho de cada um em relação ao primeiro colocado.
        Branco e nulo aparecem na lista para dar a proporção.
      </p>

      {carregando ? (
        <p className="mt-5 text-sm text-tinta-3">Carregando…</p>
      ) : !dados.length ? (
        <p className="mt-5 text-sm text-tinta-3">Nenhum voto com esses filtros.</p>
      ) : (
        <ol className="mt-5 space-y-2.5">
          {dados.map((d) => (
            <li key={d.SK_VOTAVEL}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-tinta">
                  {d.NM_URNA ?? d.NM_VOTAVEL}
                  {d.SG_PARTIDO && (
                    <span className="ml-1.5 text-tinta-3">{d.SG_PARTIDO}</span>
                  )}
                </span>
                <span className="tabular shrink-0 text-tinta-2">
                  {formataInteiro(d.VOTOS)}
                  <span className="ml-1.5 text-tinta-3">
                    {formataPct(total ? (d.VOTOS / total) * 100 : 0)}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-tinta/[0.06]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${maior ? (d.VOTOS / maior) * 100 : 0}%`,
                    background: cor(d),
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
