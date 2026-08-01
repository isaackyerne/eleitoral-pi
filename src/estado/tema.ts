import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Preferencia = 'sistema' | 'claro' | 'escuro'
export type Modo = 'claro' | 'escuro'

type Tema = {
  preferencia: Preferencia
  definir: (p: Preferencia) => void
}

export const useTemaStore = create<Tema>()(
  persist(
    (set) => ({ preferencia: 'sistema', definir: (preferencia) => set({ preferencia }) }),
    { name: 'eleitoral-pi:tema' },
  ),
)

function doSistema(): Modo {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'
}

/**
 * Modo em vigor e sincronização do atributo no `<html>`.
 *
 * O CSS resolve as cores por `data-tema`; os gráficos precisam do valor em JS,
 * porque o Recharts recebe cor como propriedade, não como classe. Daí o hook
 * devolver o modo além de aplicá-lo.
 */
export function useTema(): Modo {
  const preferencia = useTemaStore((s) => s.preferencia)
  const modo: Modo = preferencia === 'sistema' ? doSistema() : preferencia

  useEffect(() => {
    const raiz = document.documentElement
    if (preferencia === 'sistema') raiz.removeAttribute('data-tema')
    else raiz.setAttribute('data-tema', preferencia)
  }, [preferencia])

  // Com 'sistema', mudar a preferência do SO precisa repintar os gráficos.
  useEffect(() => {
    if (preferencia !== 'sistema') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const aoMudar = () => useTemaStore.setState({ preferencia: 'sistema' })
    mq.addEventListener('change', aoMudar)
    return () => mq.removeEventListener('change', aoMudar)
  }, [preferencia])

  return modo
}
