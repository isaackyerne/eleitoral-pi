import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // O DuckDB-Wasm carrega o bundle wasm e o worker em runtime; tirá-lo do
  // pre-bundle evita o Vite reescrever esses caminhos em dev.
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  worker: { format: 'es' },
})
