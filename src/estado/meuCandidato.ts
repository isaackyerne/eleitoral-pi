import { useUser } from '@clerk/react'

export type CandidatoSalvo = {
  skEleicaoBase: number
  skEleicao: number
  cdCargo: number
  skVotavel: number
  rotuloEleicao: string
  rotuloCargo: string
  rotuloCandidato: string
}

declare global {
  interface UserUnsafeMetadata {
    // `null` remove a chave — semântica do próprio `updateMetadata` do Clerk.
    meuCandidato?: CandidatoSalvo | null
  }
}

/**
 * "Meu candidato" — uma escolha por usuário, salva no metadata da conta do
 * Clerk, não no navegador: segue a conta pra qualquer dispositivo em que ela
 * entrar. `unsafeMetadata` é o único campo que o SDK do cliente grava sem
 * backend — o painel não tem um, então é o que sobra (e é exatamente pra
 * isso que o Clerk criou o campo).
 */
export function useMeuCandidato() {
  const { user, isLoaded } = useUser()
  const candidato = user?.unsafeMetadata.meuCandidato ?? null

  async function salvar(c: CandidatoSalvo) {
    if (!user) return
    await user.updateMetadata({ unsafeMetadata: { meuCandidato: c } })
  }

  async function remover() {
    if (!user) return
    await user.updateMetadata({ unsafeMetadata: { meuCandidato: null } })
  }

  return { candidato, salvar, remover, pronto: isLoaded }
}
