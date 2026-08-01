import { useEffect, useRef, useState } from 'react'

/**
 * Ressalva atrás de um ⓘ.
 *
 * O subtítulo do painel explica **como ler o gráfico**. Ressalva metodológica é
 * outra coisa: importa para quem for citar o número, mas atrapalha quem só quer
 * ler. Fica aqui, a um clique — não some, mas não ocupa a tela.
 */
export function Nota({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const [aberta, setAberta] = useState(false)
  const caixa = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!aberta) return
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberta(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberta(false)
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberta])

  return (
    <span ref={caixa} className="relative inline-block align-middle">
      <button
        type="button"
        onClick={() => setAberta((a) => !a)}
        aria-expanded={aberta}
        aria-label={`Sobre este número: ${titulo}`}
        className="grid size-4 place-items-center rounded-full border borda text-[10px] leading-none text-tinta-3 transition hover:text-tinta"
      >
        i
      </button>

      {aberta && (
        <span
          role="note"
          className="absolute left-0 z-30 mt-1.5 block w-72 rounded-lg border borda bg-superficie p-3 text-sm shadow-lg"
        >
          <span className="block font-medium text-tinta">{titulo}</span>
          <span className="mt-1 block text-tinta-2">{children}</span>
        </span>
      )}
    </span>
  )
}
