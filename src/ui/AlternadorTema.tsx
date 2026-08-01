import { useTemaStore, type Preferencia } from '../estado/tema'

const OPCOES: { id: Preferencia; rotulo: string; icone: React.ReactNode }[] = [
  {
    id: 'claro', rotulo: 'Claro',
    icone: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></>,
  },
  {
    id: 'sistema', rotulo: 'Sistema',
    icone: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  },
  {
    id: 'escuro', rotulo: 'Escuro',
    icone: <path d="M20 13.5A8 8 0 1110.5 4a6.5 6.5 0 009.5 9.5z" />,
  },
]

/** Três estados, porque "seguir o sistema" é uma escolha distinta de claro/escuro. */
export function AlternadorTema({ compacto = false }: { compacto?: boolean }) {
  const { preferencia, definir } = useTemaStore()
  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={`flex gap-0.5 rounded-lg border borda p-0.5 ${compacto ? '' : 'w-full'}`}
    >
      {OPCOES.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={preferencia === o.id}
          title={o.rotulo}
          onClick={() => definir(o.id)}
          className={`flex flex-1 items-center justify-center rounded-md py-1.5 transition ${
            preferencia === o.id ? 'bg-realce/10 text-realce' : 'text-tinta-3 hover:bg-tinta/5'
          }`}
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor"
            strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {o.icone}
          </svg>
          <span className="sr-only">{o.rotulo}</span>
        </button>
      ))}
    </div>
  )
}
