import { create } from 'zustand'

/**
 * Filtros do painel.
 *
 * `skEleicao` é sempre uma eleição concreta, nunca "todos os anos": misturar
 * eleições de esferas diferentes soma Prefeito com Governador, o que não
 * significa nada. Para comparar anos existem os painéis de série histórica,
 * que usam `QT_VOTOS_NORM` e comparam participação, não volume.
 */

export type Filtros = {
  skEleicao: number | null
  cdCargo: number | null
  cdMunicipio: number | null
  skPartido: number | null
}

type Estado = Filtros & {
  definir: <K extends keyof Filtros>(chave: K, valor: Filtros[K]) => void
  limpar: () => void
  ativos: () => { chave: keyof Filtros; rotulo: string }[]
  rotulos: Partial<Record<keyof Filtros, string>>
  definirRotulo: (chave: keyof Filtros, rotulo: string | null) => void
}

const VAZIO: Filtros = { skEleicao: null, cdCargo: null, cdMunicipio: null, skPartido: null }

export const useFiltros = create<Estado>()((set, get) => ({
  ...VAZIO,
  rotulos: {},
  definir: (chave, valor) =>
    set((s) => {
      const novo: Partial<Estado> = { [chave]: valor }
      // Trocar de eleição pode invalidar o cargo: os códigos de cargo são
      // disjuntos entre esferas ({3,5,6,7} estadual, {11,13} municipal).
      if (chave === 'skEleicao') novo.cdCargo = null
      return { ...s, ...novo }
    }),
  limpar: () => set({ ...VAZIO, rotulos: {} }),
  definirRotulo: (chave, rotulo) =>
    set((s) => {
      const rotulos = { ...s.rotulos }
      if (rotulo === null) delete rotulos[chave]
      else rotulos[chave] = rotulo
      return { rotulos }
    }),
  ativos: () => {
    const s = get()
    return (Object.keys(VAZIO) as (keyof Filtros)[])
      .filter((k) => s[k] !== null)
      .map((k) => ({ chave: k, rotulo: s.rotulos[k] ?? String(s[k]) }))
  },
}))

/** Monta o WHERE do SQL a partir dos filtros. Sempre com a série principal. */
export function clausulas(f: Filtros): string {
  const cond = ['e.FL_SERIE_PRINCIPAL']
  if (f.skEleicao !== null) cond.push(`e.SK_ELEICAO = ${f.skEleicao}`)
  if (f.cdCargo !== null) cond.push(`f.CD_CARGO = ${f.cdCargo}`)
  if (f.cdMunicipio !== null) cond.push(`l.CD_MUNICIPIO = ${f.cdMunicipio}`)
  if (f.skPartido !== null) cond.push(`v.SK_PARTIDO = ${f.skPartido}`)
  return cond.join(' AND ')
}
