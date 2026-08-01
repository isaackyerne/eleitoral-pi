import { useEffect, type ReactNode } from 'react'
import { useFiltros } from '../estado/filtros'
import { SECOES, useNavegacao, type SecaoId } from '../estado/navegacao'
import { AlternadorTema } from './AlternadorTema'

/**
 * Barra lateral retrátil.
 *
 * Dois comportamentos, conforme a largura:
 *  - a partir de `md`, ocupa espaço no fluxo e encolhe para uma faixa de ícones;
 *  - abaixo disso, vira gaveta sobreposta com fundo escurecido, porque 64px de
 *    ícones tirariam um pedaço grande de uma tela estreita.
 *
 * O estado recolhido é persistido; a seção ativa não, porque é do momento.
 */

const ICONES: Record<SecaoId, ReactNode> = {
  visao: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  participacao: (
    <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M3 20h18" /></>
  ),
  partidos: <><path d="M4 6h10" /><path d="M4 12h16" /><path d="M4 18h6" /></>,
}

function Icone({ id }: { id: SecaoId }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONES[id]}
    </svg>
  )
}

const ROTULO_FILTRO: Record<string, string> = {
  skEleicao: 'Eleição',
  cdCargo: 'Cargo',
  cdMunicipio: 'Município',
  skPartido: 'Partido',
}

export function Sidebar() {
  const { secao, recolhida, irPara, alternar, recolher } = useNavegacao()
  const filtros = useFiltros()
  const ativos = filtros.ativos()

  // Na gaveta do mobile, Esc fecha.
  useEffect(() => {
    if (recolhida) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && window.matchMedia('(max-width: 767px)').matches) recolher(true)
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [recolhida, recolher])

  const esconde = recolhida ? 'md:pointer-events-none md:opacity-0' : 'opacity-100'

  return (
    <>
      {!recolhida && (
        <button type="button" aria-label="Fechar menu" onClick={() => recolher(true)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden" />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r borda bg-superficie
          transition-[width,transform] duration-200 ease-out
          md:sticky md:top-0 md:h-dvh md:translate-x-0
          ${recolhida ? 'w-64 -translate-x-full md:w-16' : 'w-64 translate-x-0'}`}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b borda px-3">
          <div aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-realce text-sm font-semibold text-white">
            PI
          </div>
          <span className={`truncate font-semibold text-tinta transition-opacity duration-150 ${esconde}`}>
            Eleições do Piauí
          </span>
        </div>

        <nav aria-label="Seções" className="p-2">
          <ul className="space-y-1">
            {SECOES.map((s) => {
              const ativa = s.id === secao
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      irPara(s.id)
                      if (window.matchMedia('(max-width: 767px)').matches) recolher(true)
                    }}
                    aria-current={ativa ? 'page' : undefined}
                    title={recolhida ? s.rotulo : undefined}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition ${
                      ativa ? 'bg-realce/10 font-medium text-realce' : 'text-tinta-2 hover:bg-tinta/5'
                    }`}
                  >
                    <Icone id={s.id} />
                    <span className={`truncate transition-opacity duration-150 ${esconde}`}>
                      {s.rotulo}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Filtros ativos: o usuário precisa ver o recorte em que está. */}
        <div className={`min-h-0 flex-1 overflow-y-auto border-t borda p-3 ${recolhida ? 'md:hidden' : ''}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium tracking-wide text-tinta-3 uppercase">
              Filtros ativos
            </h2>
            {ativos.length > 0 && (
              <button type="button" onClick={filtros.limpar}
                className="text-xs text-realce transition hover:underline">
                Limpar
              </button>
            )}
          </div>

          {ativos.length === 0 ? (
            <p className="mt-2 text-sm text-tinta-3 italic">Nenhum filtro selecionado</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {ativos.map((a) => (
                <li key={a.chave}
                  className="flex items-start gap-2 rounded-lg bg-tinta/5 px-2.5 py-1.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-tinta-3">{ROTULO_FILTRO[a.chave]}</div>
                    <div className="truncate text-tinta">{a.rotulo}</div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remover filtro ${ROTULO_FILTRO[a.chave]}`}
                    onClick={() => {
                      filtros.definir(a.chave, null)
                      filtros.definirRotulo(a.chave, null)
                    }}
                    className="mt-0.5 text-tinta-3 transition hover:text-tinta"
                  >
                    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 space-y-2 border-t borda p-2">
          <div className={recolhida ? 'md:hidden' : ''}>
            <AlternadorTema />
          </div>
          <button
            type="button"
            onClick={alternar}
            aria-expanded={!recolhida}
            aria-controls="conteudo"
            title={recolhida ? 'Expandir menu' : 'Recolher menu'}
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-tinta-2 transition hover:bg-tinta/5"
          >
            <span className="grid size-5 shrink-0 place-items-center">
              <svg viewBox="0 0 24 24"
                className={`size-4 transition-transform duration-200 ${recolhida ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden>
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </span>
            <span className={`truncate transition-opacity duration-150 ${esconde}`}>Recolher</span>
          </button>
        </div>
      </aside>
    </>
  )
}

/** Abre a gaveta no mobile — some assim que a barra cabe no fluxo. */
export function BotaoMenu() {
  const recolher = useNavegacao((s) => s.recolher)
  return (
    <button type="button" onClick={() => recolher(false)} aria-label="Abrir menu"
      className="rounded-lg border borda bg-superficie p-2 text-tinta-2 transition hover:bg-tinta/5 md:hidden">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor"
        strokeWidth="1.75" strokeLinecap="round" aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  )
}
