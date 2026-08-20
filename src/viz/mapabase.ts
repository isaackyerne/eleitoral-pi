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

/** Centro e zoom padrão do estado da Bahia. */
export const CENTRO_BA: [number, number] = [-12.5, -41.7]
export const ZOOM_BA = 6
