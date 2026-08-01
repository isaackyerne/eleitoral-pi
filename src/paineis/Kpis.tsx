import type { Kpis as Dados } from '../dados/consultas'
import { formataInteiro } from '../viz/paleta'

/**
 * Números do recorte.
 *
 * Sem gráfico: são valores únicos, e a forma certa para um valor único é o
 * próprio número. O votos usa `QT_VOTOS_NORM`, então continua somável mesmo
 * quando o recorte inclui o Senador de 2018, que teve duas vagas.
 */

const ICONES = {
  votos: <path d="M9 12l2 2 4-4M4 6h16v12H4z" />,
  municipios: <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />,
  locais: <><path d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  zonas: <><circle cx="12" cy="12" r="8" /><path d="M12 4v16M4 12h16" /></>,
  votaveis: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0112 0M16 11h5M18.5 8.5v5" /></>,
}

function Tile({
  rotulo, valor, icone,
}: { rotulo: string; valor: string; icone: keyof typeof ICONES }) {
  return (
    <div className="rounded-xl border borda bg-superficie px-4 py-3">
      <div className="flex items-center gap-2 text-tinta-3">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor"
          strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {ICONES[icone]}
        </svg>
        <span className="truncate text-xs font-medium">{rotulo}</span>
      </div>
      <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-tinta">
        {valor}
      </div>
    </div>
  )
}

export function Kpis({ dados }: { dados: Dados | null }) {
  const v = (n: number | undefined) => (n === undefined ? '—' : formataInteiro(n))
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Tile rotulo="Total de votos" valor={v(dados?.QT_VOTOS)} icone="votos" />
      <Tile rotulo="Municípios" valor={v(dados?.QT_MUNICIPIOS)} icone="municipios" />
      <Tile rotulo="Locais de votação" valor={v(dados?.QT_LOCAIS)} icone="locais" />
      <Tile rotulo="Zonas eleitorais" valor={v(dados?.QT_ZONAS)} icone="zonas" />
      <Tile rotulo="Candidatos" valor={v(dados?.QT_VOTAVEIS)} icone="votaveis" />
    </div>
  )
}
