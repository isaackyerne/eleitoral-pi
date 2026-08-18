import { ptBR } from '@clerk/localizations'
import { ClerkLoading, ClerkProvider, Show, SignIn, UserButton } from '@clerk/react'
import type { ReactNode } from 'react'
import { useTema, type Modo } from '../estado/tema'
import { AlternadorTema } from './AlternadorTema'

/**
 * Acesso ao painel.
 *
 * O painel é de leitura e não tem backend: os parquets são arquivos estáticos
 * em `/dados/`. O login controla quem **entra na tela**, não quem alcança o
 * arquivo — para restringir o dado seria preciso servi-lo por trás de uma
 * função que valide a sessão. Como a fonte é dado aberto do TSE, a porta aqui
 * é de identificação, não de sigilo.
 *
 * Não há cadastro em lugar nenhum: a instância está em *invite only* e as
 * contas são criadas à mão no painel do Clerk. Por isso `withSignUp={false}` e
 * nenhuma tela de criar conta — quem não tem login não passa daqui.
 *
 * A recuperação de senha é o fluxo completo do próprio `<SignIn/>`: "Esqueceu a
 * senha?" → código no e-mail → nova senha. Ele roda dentro do componente, com
 * `routing="hash"`, que é o que dispensa um roteador nesta SPA.
 */

/**
 * Português do pacote oficial, com três ajustes.
 *
 * O Clerk assina os subtítulos com o nome do app no dashboard ("Eleitoral Pi"),
 * que não é como o painel se chama na tela — e o cabeçalho logo acima do cartão
 * já diz "Eleições do Piauí". Repetir ali seria redundante e inconsistente, então
 * o subtítulo passa a falar do que a tela faz. O resto do pacote fica como está.
 */
const IDIOMA = {
  ...ptBR,
  signIn: {
    ...ptBR.signIn,
    start: { ...ptBR.signIn?.start, subtitle: 'para acessar o painel' },
    password: { ...ptBR.signIn?.password, subtitle: 'para acessar o painel' },
    emailCode: { ...ptBR.signIn?.emailCode, subtitle: 'para acessar o painel' },
  },
}

/**
 * Espelha os tokens de `src/index.css`.
 *
 * O Clerk recebe cor como valor, não como classe, então os dois modos precisam
 * existir aqui em hex — mexeu na paleta de lá, replique aqui.
 */
const CORES: Record<Modo, Record<string, string>> = {
  escuro: {
    colorBackground: '#1a1a19',
    colorForeground: '#ffffff',
    colorMutedForeground: '#c3c2b7',
    colorInput: '#0d0d0d',
    colorInputForeground: '#ffffff',
    colorBorder: 'rgb(255 255 255 / 0.1)',
    colorPrimary: '#3987e5',
    colorPrimaryForeground: '#ffffff',
    colorModalBackdrop: 'rgb(0 0 0 / 0.6)',
  },
  claro: {
    colorBackground: '#fcfcfb',
    colorForeground: '#0b0b0b',
    colorMutedForeground: '#52514e',
    colorInput: '#ffffff',
    colorInputForeground: '#0b0b0b',
    colorBorder: 'rgb(11 11 11 / 0.1)',
    colorPrimary: '#2a78d6',
    colorPrimaryForeground: '#ffffff',
    colorModalBackdrop: 'rgb(0 0 0 / 0.4)',
  },
}

/**
 * Provedor do Clerk já no tema e no idioma do painel.
 *
 * Chama `useTema()` porque precisa do modo em JS para montar a aparência — e,
 * de quebra, é ele que carimba o `data-tema` na tela de login, que fica acima
 * do `App`.
 */
export function ProvedorAcesso({ children }: { children: ReactNode }) {
  const modo = useTema()
  return (
    <ClerkProvider
      afterSignOutUrl="/"
      localization={IDIOMA}
      appearance={{ variables: CORES[modo] }}
    >
      {children}
    </ClerkProvider>
  )
}

/** Enquanto o Clerk carrega, nem o painel nem o login existem ainda. */
function Espera() {
  return (
    <div className="grid min-h-dvh place-items-center bg-plano">
      <p className="text-sm text-tinta-3">Carregando…</p>
    </div>
  )
}

/** Entrada de quem já tem conta, com a recuperação de senha embutida. */
function TelaLogin() {
  return (
    <div className="relative grid min-h-dvh place-items-center bg-plano px-5 py-10">
      <div className="absolute top-4 right-4">
        <AlternadorTema compacto />
      </div>

      <div className="w-full max-w-sm space-y-6">
        <header className="flex items-center gap-3">
          <div aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-realce font-semibold text-white">
            PI
          </div>
          <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-tinta">
            Eleições do Piauí
          </h1>
        </header>

        <SignIn routing="hash" withSignUp={false} fallbackRedirectUrl="/" />

        <p className="text-center text-xs text-tinta-3">
          Acesso restrito. As contas são criadas pela administração do painel —
          se você ainda não tem acesso, peça o cadastro do seu e-mail.
        </p>
      </div>
    </div>
  )
}

/** Mostra o painel a quem entrou; a todo o resto, a tela de login. */
export function Portao({ children }: { children: ReactNode }) {
  return (
    <>
      <ClerkLoading>
        <Espera />
      </ClerkLoading>
      <Show when="signed-out">
        <TelaLogin />
      </Show>
      <Show when="signed-in">{children}</Show>
    </>
  )
}

/**
 * Controle da conta no rodapé da barra lateral: avatar, gerenciar conta e sair.
 * Recolhida, a barra tem 64px — só cabe o avatar.
 */
export function Conta({ recolhida }: { recolhida: boolean }) {
  return (
    <div className={`flex items-center px-1 py-1 ${recolhida ? 'md:justify-center' : ''}`}>
      <UserButton showName={!recolhida} />
    </div>
  )
}
