import { useEffect, useMemo, useState } from 'react'
import {
  participacaoPorAno, resumo, votosPorPartidoAno,
  type Participacao as DadoParticipacao, type Resumo, type VotoPartido,
} from './dados/consultas'
import { Participacao } from './paineis/Participacao'
import { RankingPartidos } from './paineis/RankingPartidos'
import { formataInteiro, mapaDeCores } from './viz/paleta'

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; participacao: DadoParticipacao[]; partidos: VotoPartido[]; resumo: Resumo }

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-[#fcfcfb] px-4 py-3">
      <div className="text-2xl font-semibold tracking-tight text-[#0b0b0b]">{valor}</div>
      <div className="mt-0.5 text-sm text-[#52514e]">{rotulo}</div>
    </div>
  )
}

export default function App() {
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' })
  const [ano, setAno] = useState(2024)

  useEffect(() => {
    Promise.all([participacaoPorAno(), votosPorPartidoAno(), resumo()])
      .then(([participacao, partidos, [r]]) =>
        setEstado({ fase: 'pronto', participacao, partidos, resumo: r }),
      )
      .catch((e: unknown) =>
        setEstado({ fase: 'erro', mensagem: e instanceof Error ? e.message : String(e) }),
      )
  }, [])

  // Mapa de cores montado do total da série inteira, uma vez. É isso que faz a
  // cor seguir o partido em vez da posição no ranking de cada ano.
  const cores = useMemo(() => {
    if (estado.fase !== 'pronto') return new Map<number, string>()
    const total = new Map<number, number>()
    for (const d of estado.partidos) {
      total.set(d.SK_PARTIDO, (total.get(d.SK_PARTIDO) ?? 0) + d.VOTOS)
    }
    const ordenados = [...total.entries()].sort((a, b) => b[1] - a[1]).map(([sk]) => sk)
    return mapaDeCores(ordenados)
  }, [estado])

  const anos = useMemo(
    () => (estado.fase === 'pronto' ? estado.participacao.map((p) => p.ANO_ELEICAO) : []),
    [estado],
  )

  return (
    <div className="min-h-dvh bg-[#f9f9f7]">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0b0b0b]">
            Eleições do Piauí · 2018-2024
          </h1>
          <p className="mt-1 text-[#52514e]">
            Base unificada lida direto do Parquet, no navegador.
          </p>
        </header>

        {estado.fase === 'carregando' && (
          <p className="mt-10 text-[#52514e]">Carregando a base…</p>
        )}

        {estado.fase === 'erro' && (
          <div className="mt-10 rounded-xl border border-[#d03b3b]/30 bg-[#d03b3b]/5 p-5">
            <h2 className="font-medium text-[#d03b3b]">Não foi possível carregar</h2>
            <p className="mt-1 text-sm text-[#52514e]">{estado.mensagem}</p>
            <p className="mt-2 text-sm text-[#52514e]">
              Os parquets são servidos de <code>public/dados/</code>. Copie-os com{' '}
              <code>npm run dados</code>.
            </p>
          </div>
        )}

        {estado.fase === 'pronto' && (
          <>
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Numero rotulo="Eleições" valor={String(estado.resumo.QT_ELEICOES)} />
              <Numero rotulo="Locais de votação" valor={formataInteiro(estado.resumo.QT_LOCAIS)} />
              <Numero rotulo="Políticos" valor={formataInteiro(estado.resumo.QT_POLITICOS)} />
              <Numero rotulo="Votos" valor={formataInteiro(estado.resumo.QT_VOTOS)} />
            </div>

            <div className="mt-6 space-y-6">
              <Participacao dados={estado.participacao} />
              <RankingPartidos
                dados={estado.partidos}
                ano={ano}
                anos={anos}
                aoTrocarAno={setAno}
                cores={cores}
              />
            </div>

            <footer className="mt-8 text-sm text-[#898781]">
              Fonte: dados abertos do TSE. Série principal apenas — 1º turno de cada
              eleição ordinária, sem as suplementares.
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
