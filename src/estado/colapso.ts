import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Colapso = {
  colapsados: Record<string, boolean>
  alternar: (id: string) => void
}

// Estado de recolher/expandir por painel, por id. Persistido — se o usuário
// recolhe um painel para deixar a tela mais limpa, isso deve sobreviver a um
// recarregamento, como o `recolhida` da barra lateral em `estado/navegacao.ts`.
export const useColapso = create<Colapso>()(
  persist(
    (set) => ({
      colapsados: {},
      alternar: (id) => set((s) => ({ colapsados: { ...s.colapsados, [id]: !s.colapsados[id] } })),
    }),
    { name: 'eleitoral-pi:colapso' },
  ),
)
