/**
 * Mapa-base: Esri "Light Gray Canvas" (raster, sem chave) — base cinza clara
 * mais uma camada transparente só com os rótulos, que fica por cima do
 * coroplético pra nomes de cidade e rua continuarem legíveis.
 *
 * Os tiles CARTO (Positron) que o painel usava passaram a devolver, pra
 * qualquer pedido sem chave, uma imagem "API KEY REQUIRED" no lugar do mapa.
 * A Esri serve o mesmo tipo de base neutra sem exigir cadastro. Atenção à
 * ordem na URL: é {z}/{y}/{x}, não {z}/{x}/{y}.
 */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas'

export const URL_TILES_BASE = `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`
export const URL_TILES_ROTULOS = `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`

/** Zoom máximo em que a Esri tem tile; acima disso o Leaflet só amplia. */
export const ZOOM_NATIVO_MAX = 16

export const ATRIBUICAO_MAPA =
  'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; ' +
  'Esri, DeLorme, NAVTEQ, OpenStreetMap contributors'

/** Centro e zoom padrão do estado do Piauí. */
export const CENTRO_PI: [number, number] = [-7.4, -42.9]
export const ZOOM_PI = 6
