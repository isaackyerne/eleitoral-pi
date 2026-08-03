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
  // Eleição "mãe" (sempre o 1º turno) escolhida no seletor — existe só para o
  // seletor de Turno saber a família de `skEleicao` quando este aponta pro 2º
  // turno, que não está na lista de opções (só o 1º turno de cada ordinária
  // entra ali). Nunca vira cláusula de SQL nem aparece como filtro ativo.
  skEleicaoBase: number | null
  cdCargo: number | null
  cdMunicipio: number | null
  skPartido: number | null
  // `dim_votavel` é por eleição, de propósito — um SK_VOTAVEL só existe dentro
  // do (eleição, cargo) em que foi gerado. Trocar qualquer um dos dois invalida
  // a seleção, então o store zera sozinho, como já faz com cdCargo.
  skVotavel: number | null
  // Escopo: só a Conferência usa isso por enquanto. Nasce fora do filtro
  // global de propósito — branco/nulo não faz sentido em Ranking de partidos
  // nem no vencedor do mapa, então não é um recorte que afeta o painel inteiro.
  incluirBrancosNulos: boolean
}

// Chaves que viram badge em "Filtros ativos" — a base de eleição fica de fora.
const CHAVES_FILTRO: (keyof Filtros)[] = ['skEleicao', 'cdCargo', 'cdMunicipio', 'skPartido', 'skVotavel']

type Estado = Filtros & {
  definir: <K extends keyof Filtros>(chave: K, valor: Filtros[K]) => void
  limpar: () => void
  ativos: () => { chave: keyof Filtros; rotulo: string }[]
  rotulos: Partial<Record<keyof Filtros, string>>
  definirRotulo: (chave: keyof Filtros, rotulo: string | null) => void
}

const VAZIO: Filtros = {
  skEleicao: null, skEleicaoBase: null, cdCargo: null, cdMunicipio: null,
  skPartido: null, skVotavel: null, incluirBrancosNulos: false,
}

export const useFiltros = create<Estado>()((set, get) => ({
  ...VAZIO,
  rotulos: {},
  definir: (chave, valor) =>
    set((s) => {
      const novo: Partial<Estado> = { [chave]: valor }
      // Trocar de eleição pode invalidar o cargo: os códigos de cargo são
      // disjuntos entre esferas ({3,5,6,7} estadual, {11,13} municipal).
      if (chave === 'skEleicaoBase') novo.cdCargo = null
      // Limpar a eleição (botão "remover filtro") tem que levar a base junto,
      // senão o seletor de Eleição continua mostrando a opção antiga.
      if (chave === 'skEleicao' && valor === null) novo.skEleicaoBase = null
      // O candidato só existe dentro do (eleição, cargo) em que foi eleito —
      // trocar qualquer um dos dois invalida a seleção.
      if (chave === 'skEleicaoBase' || chave === 'cdCargo') novo.skVotavel = null
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
    return CHAVES_FILTRO
      .filter((k) => s[k] !== null)
      .map((k) => ({ chave: k, rotulo: s.rotulos[k] ?? String(s[k]) }))
  },
}))

/**
 * Guardrail de eleição: uma `SK_ELEICAO` específica já desambigua turno (o 2º
 * turno de 2020 tem `FL_SERIE_PRINCIPAL=false`), então não pode entrar em
 * AND com o filtro de série principal — viraria contradição e zeraria tudo.
 * Sem eleição escolhida, cai no filtro de série principal de sempre.
 */
export function condEleicao(skEleicao: number | null, aliasEleicao = 'e'): string {
  return skEleicao !== null
    ? `${aliasEleicao}.SK_ELEICAO = ${skEleicao}`
    : `${aliasEleicao}.FL_SERIE_PRINCIPAL`
}

/** Monta o WHERE do SQL a partir dos filtros. Sempre com a série principal. */
export function clausulas(f: Filtros): string {
  const cond = [condEleicao(f.skEleicao)]
  if (f.cdCargo !== null) cond.push(`f.CD_CARGO = ${f.cdCargo}`)
  if (f.cdMunicipio !== null) cond.push(`l.CD_MUNICIPIO = ${f.cdMunicipio}`)
  if (f.skPartido !== null) cond.push(`v.SK_PARTIDO = ${f.skPartido}`)
  if (f.skVotavel !== null) cond.push(`v.SK_VOTAVEL = ${f.skVotavel}`)
  return cond.join(' AND ')
}
