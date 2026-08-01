import type { Modo } from '../estado/tema'

/**
 * Paleta categórica validada.
 *
 * A ordem dos slots é o mecanismo de segurança para daltonismo, não escolha
 * estética — verificada com o validador nos dois modos:
 *   pior par adjacente CVD ΔE 9,1 (claro) / 8,4 (escuro), alvo ≥ 8
 *   pior par adjacente visão normal ΔE 19,6 (claro) / 19,3 (escuro), piso ≥ 15
 *
 * Três slots do modo claro (aqua, amarelo, magenta) ficam abaixo de 3:1 contra
 * a superfície. Isso obriga alívio: os gráficos daqui trazem rótulo direto no
 * valor, então a identidade nunca depende só da cor.
 *
 * As duas colunas são os mesmos oito matizes, cada um degrau na banda da sua
 * superfície — não é inversão automática.
 */

export const SLOTS: Record<Modo, readonly string[]> = {
  claro: [
    '#2a78d6', // 1 azul
    '#eb6834', // 2 laranja
    '#1baf7a', // 3 aqua
    '#eda100', // 4 amarelo
    '#e87ba4', // 5 magenta
    '#008300', // 6 verde
    '#4a3aa7', // 7 violeta
    '#e34948', // 8 vermelho
  ],
  escuro: [
    '#3987e5', '#d95926', '#199e70', '#c98500',
    '#d55181', '#008300', '#9085e9', '#e66767',
  ],
}

/** Cinza para "Outros" — nunca um nono tom gerado. */
export const OUTROS = '#898781'

export const TINTA: Record<Modo, {
  superficie: string; plano: string; primaria: string; secundaria: string
  suave: string; grade: string; eixo: string; realce: string
}> = {
  claro: {
    superficie: '#fcfcfb', plano: '#f9f9f7', primaria: '#0b0b0b',
    secundaria: '#52514e', suave: '#898781', grade: '#e1e0d9',
    eixo: '#c3c2b7', realce: '#2a78d6',
  },
  escuro: {
    superficie: '#1a1a19', plano: '#0d0d0d', primaria: '#ffffff',
    secundaria: '#c3c2b7', suave: '#898781', grade: '#2c2c2a',
    eixo: '#383835', realce: '#3987e5',
  },
}

/**
 * Cor fixa por partido.
 *
 * A regra que não pode ser quebrada: **a cor segue o partido, nunca a posição
 * no ranking**. Se um filtro tirar o PT do top 8, os demais não podem trocar de
 * cor. Por isso o mapa é montado do total da série inteira e nunca recalculado
 * por recorte — o índice do slot é do partido, e só o hex muda com o tema.
 */
export function mapaDeSlots(partidosPorVotoTotal: number[]): Map<number, number> {
  const mapa = new Map<number, number>()
  partidosPorVotoTotal.slice(0, SLOTS.claro.length).forEach((sk, i) => mapa.set(sk, i))
  return mapa
}

export function corDoPartido(slots: Map<number, number>, sk: number, modo: Modo): string {
  const i = slots.get(sk)
  return i === undefined ? OUTROS : SLOTS[modo][i]
}

export function formataInteiro(n: number): string {
  return n.toLocaleString('pt-BR')
}

export function formataPct(n: number, casas = 1): string {
  return `${n.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`
}

export function formataCompacto(n: number): string {
  return n.toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
}
