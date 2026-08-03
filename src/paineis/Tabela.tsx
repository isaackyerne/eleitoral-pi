import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { exportarExcel } from '../dados/excel'
import type { Granularidade, LinhaTabela } from '../dados/consultas'
import { useColapso } from '../estado/colapso'
import { BotaoColapsar } from '../ui/BotaoColapsar'
import { formataInteiro, formataPct } from '../viz/paleta'

/**
 * Tabela do recorte, em três granularidades.
 *
 * Virtualizada porque "por local" chega a 3.400 linhas e "por seção" chegaria a
 * milhares — renderizar tudo trava o scroll.
 *
 * Os números ficam em tinta comum, nunca coloridos por entidade: cor de série
 * em texto pequeno é justamente onde o contraste falha.
 */

const ABAS: { id: Granularidade; rotulo: string }[] = [
  { id: 'municipio', rotulo: 'Por município' },
  { id: 'zona', rotulo: 'Por zona' },
  { id: 'local', rotulo: 'Por local' },
]

export function Tabela({
  linhas, grao, aoTrocarGrao, carregando,
}: {
  linhas: LinhaTabela[]
  grao: Granularidade
  aoTrocarGrao: (g: Granularidade) => void
  carregando: boolean
}) {
  const [busca, setBusca] = useState('')
  const corpo = useRef<HTMLDivElement>(null)
  const colapsado = useColapso((s) => s.colapsados.tabela ?? false)
  const alternar = useColapso((s) => s.alternar)

  const visiveis = useMemo(() => {
    if (!busca) return linhas
    const t = busca.toLocaleLowerCase('pt-BR')
    return linhas.filter(
      (l) =>
        l.NOME?.toLocaleLowerCase('pt-BR').includes(t) ||
        l.DETALHE?.toLocaleLowerCase('pt-BR').includes(t),
    )
  }, [linhas, busca])

  const virtual = useVirtualizer({
    count: visiveis.length,
    getScrollElement: () => corpo.current,
    estimateSize: () => 40,
    overscan: 12,
  })

  function exportar() {
    const ROTULO_GRAO: Record<Granularidade, string> = {
      municipio: 'Por município', zona: 'Por zona', local: 'Por local',
    }
    exportarExcel(
      `eleitoral-pi-${grao}.xlsx`,
      [
        { titulo: 'Nome', tipo: 'texto', largura: 32 },
        { titulo: 'Detalhe', tipo: 'texto', largura: 24 },
        { titulo: 'Votos', tipo: 'inteiro', largura: 14 },
        { titulo: 'Aptos', tipo: 'inteiro', largura: 14 },
        { titulo: 'Comparecimento', tipo: 'inteiro', largura: 16 },
        { titulo: '% Comparecimento', tipo: 'percentual', largura: 16 },
      ],
      visiveis.map((l) => [l.NOME, l.DETALHE, l.VOTOS, l.APTOS, l.COMPARECIMENTO, l.PCT_COMPARECIMENTO]),
      { aba: 'Tabela', observacao: `Granularidade: ${ROTULO_GRAO[grao]}` },
    )
  }

  return (
    <section className="rounded-xl border borda bg-superficie">
      <div className="flex flex-wrap items-center gap-2 border-b borda p-3">
        <div role="tablist" aria-label="Nível de detalhe" className="flex gap-1">
          {ABAS.map((a) => (
            <button
              key={a.id}
              role="tab"
              aria-selected={a.id === grao}
              onClick={() => aoTrocarGrao(a.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                a.id === grao
                  ? 'bg-realce/10 font-medium text-realce'
                  : 'text-tinta-2 hover:bg-tinta/5'
              }`}
            >
              {a.rotulo}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Filtrar na tabela…"
            aria-label="Filtrar linhas da tabela"
            className="h-9 w-44 rounded-lg border borda bg-superficie px-2.5 text-sm text-tinta outline-none transition focus-visible:ring-2 focus-visible:ring-realce/40"
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

        <BotaoColapsar aberto={!colapsado} aoAlternar={() => alternar('tabela')} rotulo="Tabela" />
      </div>

      {!colapsado && (
        <>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b borda px-4 py-2 text-xs font-medium text-tinta-3">
            <span>Nome</span>
            <span className="w-24 text-right">Votos</span>
            <span className="w-24 text-right">Aptos</span>
            <span className="w-20 text-right">Compar.</span>
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
                      key={l.CHAVE}
                      className="absolute inset-x-0 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 border-b borda px-4 text-sm hover:bg-tinta/[0.03]"
                      style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-tinta">{l.NOME}</div>
                        {l.DETALHE && (
                          <div className="truncate text-xs text-tinta-3">{l.DETALHE}</div>
                        )}
                      </div>
                      <span className="tabular w-24 text-right text-tinta">
                        {formataInteiro(l.VOTOS)}
                      </span>
                      <span className="tabular w-24 text-right text-tinta-2">
                        {l.APTOS === null ? '—' : formataInteiro(l.APTOS)}
                      </span>
                      <span className="tabular w-20 text-right text-tinta-2">
                        {l.PCT_COMPARECIMENTO === null ? '—' : formataPct(l.PCT_COMPARECIMENTO)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <p className="border-t borda px-4 py-2 text-xs text-tinta-3">
            {formataInteiro(visiveis.length)} linhas
            {busca && ` de ${formataInteiro(linhas.length)}`}
          </p>
        </>
      )}
    </section>
  )
}
