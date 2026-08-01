/**
 * Paleta categórica validada.
 *
 * A ordem dos slots é o mecanismo de segurança para daltonismo, não escolha
 * estética — foi verificada com o validador nos dois modos:
 *   pior par adjacente CVD ΔE 9,1 (claro) / 8,4 (escuro), alvo ≥ 8
 *   pior par adjacente visão normal ΔE 19,6 (claro) / 19,3 (escuro), piso ≥ 15
 *
 * Três slots do modo claro (aqua, amarelo, magenta) ficam abaixo de 3:1 contra
 * a superfície. Isso obriga alívio: os gráficos daqui trazem rótulo direto no
 * valor, então a identidade nunca depende só da cor.
 */

export const SLOTS_CLARO = [
  '#2a78d6', // 1 azul
  '#eb6834', // 2 laranja
  '#1baf7a', // 3 aqua
  '#eda100', // 4 amarelo
  '#e87ba4', // 5 magenta
  '#008300', // 6 verde
  '#4a3aa7', // 7 violeta
  '#e34948', // 8 vermelho
] as const

export const SLOTS_ESCURO = [
  '#3987e5', '#d95926', '#199e70', '#c98500',
  '#d55181', '#008300', '#9085e9', '#e66767',
] as const

/** Cinza para a categoria "Outros" — nunca um nono tom gerado. */
export const OUTROS_CLARO = '#898781'
export const OUTROS_ESCURO = '#898781'

export const TINTA = {
  claro: {
    superficie: '#fcfcfb',
    plano: '#f9f9f7',
    primaria: '#0b0b0b',
    secundaria: '#52514e',
    suave: '#898781',
    grade: '#e1e0d9',
    eixo: '#c3c2b7',
  },
  escuro: {
    superficie: '#1a1a19',
    plano: '#0d0d0d',
    primaria: '#ffffff',
    secundaria: '#c3c2b7',
    suave: '#898781',
    grade: '#2c2c2a',
    eixo: '#383835',
  },
} as const

/**
 * Atribui uma cor fixa a cada partido.
 *
 * A regra que não pode ser quebrada: **a cor segue o partido, nunca a posição
 * no ranking**. Se o usuário filtrar um ano e o PT sair do top 8, os demais não
 * podem trocar de cor. Por isso o mapa é montado uma vez, a partir do total de
 * votos em toda a série, e nunca é recalculado por recorte.
 */
export function mapaDeCores(
  partidosPorVotoTotal: number[],
  modo: 'claro' | 'escuro' = 'claro',
): Map<number, string> {
  const slots = modo === 'claro' ? SLOTS_CLARO : SLOTS_ESCURO
  const mapa = new Map<number, string>()
  partidosPorVotoTotal.slice(0, slots.length).forEach((sk, i) => mapa.set(sk, slots[i]))
  return mapa
}

export function corDoPartido(
  mapa: Map<number, string>,
  sk: number,
  modo: 'claro' | 'escuro' = 'claro',
): string {
  return mapa.get(sk) ?? (modo === 'claro' ? OUTROS_CLARO : OUTROS_ESCURO)
}

export function formataInteiro(n: number): string {
  return n.toLocaleString('pt-BR')
}

export function formataPct(n: number, casas = 1): string {
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`
}
