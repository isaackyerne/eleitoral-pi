import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Preferencia = 'sistema' | 'claro' | 'escuro'
export type Modo = 'claro' | 'escuro'

/** Escuro é o padrão do painel; 'sistema' é uma escolha explícita do usuário. */
const PADRAO: Preferencia = 'escuro'

type Tema = {
  preferencia: Preferencia
  definir: (p: Preferencia) => void
}

export const useTemaStore = create<Tema>()(
  persist(
    (set) => ({ preferencia: PADRAO, definir: (preferencia) => set({ preferencia }) }),
    { name: 'eleitoral-pi:tema' },
  ),
)

function doSistema(): Modo {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'claro'
    : 'escuro'
}

/**
 * Modo em vigor e sincronização do atributo no `<html>`.
 *
 * O hook sempre grava um modo concreto — 'sistema' é resolvido aqui, não no
 * CSS. Assim a folha de estilo tem só dois escopos, e o script inline do
 * index.html pode aplicar o mesmo valor antes do primeiro paint sem duplicar
 * regra de media query.
 *
 * O modo também é devolvido em JS porque os gráficos recebem cor como
 * propriedade, não como classe.
 */
export function useTema(): Modo {
  const preferencia = useTemaStore((s) => s.preferencia)
  const modo: Modo = preferencia === 'sistema' ? doSistema() : preferencia

  useEffect(() => {
    document.documentElement.dataset.tema = modo
  }, [modo])

  // Com 'sistema', mudar a preferência do SO precisa repintar os gráficos.
  useEffect(() => {
    if (preferencia !== 'sistema') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const aoMudar = () => useTemaStore.setState({ preferencia: 'sistema' })
    mq.addEventListener('change', aoMudar)
    return () => mq.removeEventListener('change', aoMudar)
  }, [preferencia])

  return modo
}
