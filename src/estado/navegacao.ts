import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const SECOES = [
  { id: 'visao', rotulo: 'Visão geral' },
  { id: 'participacao', rotulo: 'Participação' },
  { id: 'partidos', rotulo: 'Partidos' },
] as const

export type SecaoId = (typeof SECOES)[number]['id']

type Navegacao = {
  secao: SecaoId
  recolhida: boolean
  irPara: (secao: SecaoId) => void
  alternar: () => void
  recolher: (v: boolean) => void
}

export const useNavegacao = create<Navegacao>()(
  persist(
    (set) => ({
      secao: 'visao',
      recolhida: false,
      irPara: (secao) => set({ secao }),
      alternar: () => set((s) => ({ recolhida: !s.recolhida })),
      recolher: (recolhida) => set({ recolhida }),
    }),
    {
      name: 'eleitoral-pi:navegacao',
      // A seção ativa é do momento; só o estado da barra vale guardar.
      partialize: (s) => ({ recolhida: s.recolhida }),
    },
  ),
)
