/**
 * Projeção para o mapa do Piauí.
 *
 * Equirretangular com correção de cosseno na longitude — no recorte de um
 * estado (5,7° de longitude, 8,2° de latitude) a distorção é imperceptível, e
 * evita trazer uma biblioteca de projeção só para isso.
 *
 * Sem tiles de propósito: o mapa desenha em SVG e herda as cores do tema. A
 * referência sofre justamente disso — tiles claros dentro de um painel escuro.
 */

export type Caixa = { x0: number; y0: number; x1: number; y1: number }

export type Projecao = {
  ponto: (lon: number, lat: number) => [number, number]
  caminho: (coords: Anel[] | Anel[][], tipo: 'Polygon' | 'MultiPolygon') => string
}

type Anel = [number, number][]

export function projeta(caixa: Caixa, largura: number, altura: number, margem = 8): Projecao {
  const latMedia = ((caixa.y0 + caixa.y1) / 2) * (Math.PI / 180)
  const k = Math.cos(latMedia)

  const lx = (caixa.x1 - caixa.x0) * k
  const ly = caixa.y1 - caixa.y0
  const escala = Math.min((largura - margem * 2) / lx, (altura - margem * 2) / ly)

  const deslocX = (largura - lx * escala) / 2
  const deslocY = (altura - ly * escala) / 2

  const ponto = (lon: number, lat: number): [number, number] => [
    deslocX + (lon - caixa.x0) * k * escala,
    // y cresce para baixo no SVG, e a latitude cresce para cima
    deslocY + (caixa.y1 - lat) * escala,
  ]

  function anel(a: Anel): string {
    let d = ''
    for (let i = 0; i < a.length; i++) {
      const [x, y] = ponto(a[i][0], a[i][1])
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    }
    return `${d}Z`
  }

  return {
    ponto,
    caminho: (coords, tipo) =>
      tipo === 'Polygon'
        ? (coords as Anel[]).map(anel).join('')
        : (coords as Anel[][]).flatMap((p) => p.map(anel)).join(''),
  }
}

/** Caixa que contém todas as feições. */
export function caixaDe(features: { geometry: { type: string; coordinates: unknown } }[]): Caixa {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const visita = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as [number, number]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      return
    }
    if (Array.isArray(c)) c.forEach(visita)
  }
  features.forEach((f) => visita(f.geometry.coordinates))
  return { x0, y0, x1, y1 }
}

/**
 * Rampa sequencial azul, do claro ao escuro.
 *
 * Uma cor só, variando em luminosidade — nunca arco-íris. É a regra para
 * magnitude contínua, que é o caso do comparecimento.
 */
const RAMPA = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']

export function corSequencial(v: number, min: number, max: number): string {
  if (!Number.isFinite(v) || max <= min) return RAMPA[0]
  const t = Math.min(1, Math.max(0, (v - min) / (max - min)))
  return RAMPA[Math.min(RAMPA.length - 1, Math.floor(t * RAMPA.length))]
}

export const RAMPA_PASSOS = RAMPA
