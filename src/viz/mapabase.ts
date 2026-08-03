import type { Modo } from '../estado/tema'

/**
 * Tiles CARTO (raster, grátis, sem chave) — Positron no tema claro, Dark
 * Matter no escuro, para o mapa-base não destoar do resto do painel.
 */
export function urlTilesCarto(modo: Modo): string {
  const estilo = modo === 'escuro' ? 'dark_all' : 'light_all'
  return `https://{s}.basemaps.cartocdn.com/${estilo}/{z}/{x}/{y}{r}.png`
}

export const ATRIBUICAO_CARTO =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>'

/** Centro e zoom padrão do estado do Piauí. */
export const CENTRO_PI: [number, number] = [-7.4, -42.9]
export const ZOOM_PI = 6
