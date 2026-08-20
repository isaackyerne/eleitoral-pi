export function BotaoColapsar({
  aberto, aoAlternar, rotulo,
}: {
  aberto: boolean
  aoAlternar: () => void
  rotulo: string
}) {
  return (
    <button
      type="button"
      onClick={aoAlternar}
      aria-expanded={aberto}
      aria-label={aberto ? `Recolher ${rotulo}` : `Expandir ${rotulo}`}
      className="ml-auto shrink-0 rounded-lg p-1.5 text-tinta-3 transition hover:bg-tinta/5 hover:text-tinta"
    >
      <svg
        viewBox="0 0 24 24"
        className={`size-4 transition-transform ${aberto ? '' : '-rotate-90'}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  )
}
