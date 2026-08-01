import { useEffect, useId, useRef, useState } from 'react'

/** Rótulo em cima, controle embaixo — o par que a barra de filtros repete. */
export function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-tinta-3">{rotulo}</span>
      {children}
    </label>
  )
}

const CONTROLE =
  'h-9 w-full rounded-lg border borda bg-superficie px-2.5 text-sm text-tinta ' +
  'outline-none transition focus-visible:ring-2 focus-visible:ring-realce/40'

export function Seletor<T extends string | number>({
  valor, aoMudar, opcoes, vazio = 'Todos',
}: {
  valor: T | null
  aoMudar: (v: T | null) => void
  opcoes: { valor: T; rotulo: string }[]
  vazio?: string
}) {
  return (
    <select
      className={CONTROLE}
      value={valor ?? ''}
      onChange={(e) => {
        const v = e.target.value
        aoMudar(v === '' ? null : (typeof opcoes[0]?.valor === 'number' ? Number(v) : v) as T)
      }}
    >
      <option value="">{vazio}</option>
      {opcoes.map((o) => (
        <option key={String(o.valor)} value={String(o.valor)}>
          {o.rotulo}
        </option>
      ))}
    </select>
  )
}

/**
 * Combobox com busca.
 *
 * Um `<select>` nativo com 224 municípios é inutilizável — daí a busca. Segue o
 * padrão de combobox da WAI: setas navegam, Enter escolhe, Esc fecha, e a opção
 * ativa é anunciada por `aria-activedescendant`.
 */
export function Busca<T extends string | number>({
  valor, aoMudar, opcoes, vazio = 'Todos', placeholder = 'Buscar…',
}: {
  valor: T | null
  aoMudar: (v: T | null, rotulo: string | null) => void
  opcoes: { valor: T; rotulo: string }[]
  vazio?: string
  placeholder?: string
}) {
  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState('')
  const [ativo, setAtivo] = useState(0)
  const caixa = useRef<HTMLDivElement>(null)
  const id = useId()

  const selecionado = opcoes.find((o) => o.valor === valor)
  const filtradas = termo
    ? opcoes.filter((o) => o.rotulo.toLocaleLowerCase('pt-BR').includes(termo.toLocaleLowerCase('pt-BR')))
    : opcoes

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  function escolher(o: { valor: T; rotulo: string } | null) {
    aoMudar(o?.valor ?? null, o?.rotulo ?? null)
    setAberto(false)
    setTermo('')
  }

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        className={`${CONTROLE} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${selecionado ? '' : 'text-tinta-3'}`}>
          {selecionado?.rotulo ?? vazio}
        </span>
        <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-tinta-3" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {aberto && (
        <div className="absolute z-50 mt-1 w-full min-w-56 rounded-lg border borda bg-superficie shadow-lg">
          <input
            autoFocus
            value={termo}
            placeholder={placeholder}
            onChange={(e) => { setTermo(e.target.value); setAtivo(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((i) => Math.min(i + 1, filtradas.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); escolher(filtradas[ativo] ?? null) }
              else if (e.key === 'Escape') setAberto(false)
            }}
            role="combobox"
            aria-expanded
            aria-controls={id}
            aria-activedescendant={`${id}-${ativo}`}
            className="h-9 w-full rounded-t-lg border-b borda bg-transparent px-2.5 text-sm text-tinta outline-none"
          />
          <ul id={id} role="listbox" className="max-h-64 overflow-y-auto p-1">
            <li>
              <button type="button" onClick={() => escolher(null)}
                className="w-full rounded px-2 py-1.5 text-left text-sm text-tinta-3 hover:bg-tinta/5">
                {vazio}
              </button>
            </li>
            {filtradas.map((o, i) => (
              <li key={String(o.valor)} id={`${id}-${i}`} role="option" aria-selected={o.valor === valor}>
                <button
                  type="button"
                  onMouseEnter={() => setAtivo(i)}
                  onClick={() => escolher(o)}
                  className={`w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                    i === ativo ? 'bg-realce/10 text-realce' : 'text-tinta hover:bg-tinta/5'
                  }`}
                >
                  {o.rotulo}
                </button>
              </li>
            ))}
            {!filtradas.length && (
              <li className="px-2 py-3 text-center text-sm text-tinta-3">Nada encontrado</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
