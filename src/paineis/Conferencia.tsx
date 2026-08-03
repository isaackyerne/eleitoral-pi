import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { exportarExcel } from '../dados/excel'
import type { LinhaConferencia } from '../dados/consultas'
import { useColapso } from '../estado/colapso'
import { useFiltros } from '../estado/filtros'
import { BotaoColapsar } from '../ui/BotaoColapsar'
import { Nota } from '../ui/Nota'
import { formataInteiro, formataPct } from '../viz/paleta'

/**
 * Conferência candidato × município.
 *
 * Pensada para bater qualquer número contra a totalização oficial do TSE, não
 * para leitura corrida — por isso o número de urna aparece como chave de
 * conferência. Só voto nominal entra por padrão (branco e nulo não têm
 * candidatura pra conferir); o toggle é local a este painel, não um filtro
 * global — nenhum outro painel tem motivo pra incluir branco/nulo do mesmo jeito.
 */
export function Conferencia({
  dados, carregando,
}: {
  dados: LinhaConferencia[]
  carregando: boolean
}) {
  const incluirBrancosNulos = useFiltros((s) => s.incluirBrancosNulos)
  const definir = useFiltros((s) => s.definir)
  const [busca, setBusca] = useState('')
  const corpo = useRef<HTMLDivElement>(null)
  const colapsado = useColapso((s) => s.colapsados.conferencia ?? false)
  const alternar = useColapso((s) => s.alternar)

  const visiveis = useMemo(() => {
    if (!busca) return dados
    const t = busca.toLocaleLowerCase('pt-BR')
    return dados.filter(
      (l) =>
        l.NM_MUNICIPIO.toLocaleLowerCase('pt-BR').includes(t) ||
        l.NM_VOTAVEL.toLocaleLowerCase('pt-BR').includes(t),
    )
  }, [dados, busca])

  const virtual = useVirtualizer({
    count: visiveis.length,
    getScrollElement: () => corpo.current,
    estimateSize: () => 40,
    overscan: 12,
  })

  function exportar() {
    exportarExcel(
      'eleitoral-pi-conferencia.xlsx',
      [
        { titulo: 'Município', tipo: 'texto', largura: 24 },
        { titulo: 'Número', tipo: 'texto', largura: 10 },
        { titulo: 'Candidato', tipo: 'texto', largura: 34 },
        { titulo: 'Partido', tipo: 'texto', largura: 14 },
        { titulo: 'Votos', tipo: 'inteiro', largura: 14 },
        { titulo: '% no Município', tipo: 'percentual', largura: 16 },
      ],
      visiveis.map((l) => [l.NM_MUNICIPIO, l.NR_VOTAVEL, l.NM_VOTAVEL, l.SG_PARTIDO, l.VOTOS, l.PCT_MUNICIPIO]),
      { aba: 'Conferência' },
    )
  }

  return (
    <section className="rounded-xl border borda bg-superficie">
      <div className="flex flex-wrap items-center gap-2 border-b borda p-3">
        <div className="mr-auto flex items-start gap-2">
          <h2 className="text-base font-semibold text-tinta">Conferência por município</h2>
          <Nota titulo="Para que serve">
            Candidato × município, no nível que bate com a totalização oficial
            do TSE. Só voto nominal entra — branco e nulo não têm candidatura
            para conferir. O número é o de urna.
          </Nota>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-tinta-2">
            <input
              type="checkbox"
              checked={incluirBrancosNulos}
              onChange={(e) => definir('incluirBrancosNulos', e.target.checked)}
              className="size-4 rounded border-borda accent-realce"
            />
            Incluir brancos e nulos
          </label>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Filtrar município ou candidato…"
            aria-label="Filtrar linhas da conferência"
            className="h-9 w-56 rounded-lg border borda bg-superficie px-2.5 text-sm text-tinta outline-none transition focus-visible:ring-2 focus-visible:ring-realce/40"
          />
          <button
            type="button"
            onClick={exportar}
            disabled={!visiveis.length}
            className="flex h-9 items-center gap-1.5 rounded-lg border borda px-3 text-sm text-tinta-2 transition hover:bg-tinta/5 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor"
              strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
            </svg>
            Exportar
          </button>
        </div>

        <BotaoColapsar aberto={!colapsado} aoAlternar={() => alternar('conferencia')} rotulo="Conferência por município" />
      </div>

      {!colapsado && (
        <>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b borda px-4 py-2 text-xs font-medium text-tinta-3">
            <span>Município · Candidato</span>
            <span className="w-16 text-right">Nº</span>
            <span className="w-24 text-right">Votos</span>
            <span className="w-16 text-right">% no mun.</span>
          </div>

          <div ref={corpo} className="h-96 overflow-y-auto">
            {carregando ? (
              <p className="p-4 text-sm text-tinta-3">Carregando…</p>
            ) : !visiveis.length ? (
              <p className="p-4 text-sm text-tinta-3">Nada encontrado com esses filtros.</p>
            ) : (
              <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
                {virtual.getVirtualItems().map((item) => {
                  const l = visiveis[item.index]
                  return (
                    <div
                      key={`${l.CD_MUNICIPIO}-${l.SK_VOTAVEL}`}
                      className="absolute inset-x-0 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 border-b borda px-4 text-sm hover:bg-tinta/[0.03]"
                      style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-tinta">{l.NM_VOTAVEL}</div>
                        <div className="truncate text-xs text-tinta-3">
                          {l.NM_MUNICIPIO}{l.SG_PARTIDO && ` · ${l.SG_PARTIDO}`}
                        </div>
                      </div>
                      <span className="tabular w-16 text-right text-tinta-2">{l.NR_VOTAVEL}</span>
                      <span className="tabular w-24 text-right text-tinta">{formataInteiro(l.VOTOS)}</span>
                      <span className="tabular w-16 text-right text-tinta-2">{formataPct(l.PCT_MUNICIPIO)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <p className="border-t borda px-4 py-2 text-xs text-tinta-3">
            {formataInteiro(visiveis.length)} linhas
            {busca && ` de ${formataInteiro(dados.length)}`}
          </p>
        </>
      )}
    </section>
  )
}
