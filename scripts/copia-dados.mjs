// Copia os parquets do star schema e o geojson dos municípios para public/dados/,
// de onde o Vite os serve estaticamente. Em Node puro (fs.cpSync) para funcionar
// igual em Windows, Linux e macOS — `cp` do shell não existe no Windows.
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DESTINO = 'public/dados'

mkdirSync(DESTINO, { recursive: true })

function copiaPorExtensao(origem, extensao) {
  for (const arquivo of readdirSync(origem)) {
    if (arquivo.endsWith(extensao)) {
      cpSync(join(origem, arquivo), join(DESTINO, arquivo))
    }
  }
}

copiaPorExtensao('dados/processados/unificado', '.parquet')
copiaPorExtensao('dados/geo', '.geojson')
