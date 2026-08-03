import * as duckdb from '@duckdb/duckdb-wasm'

/**
 * Acesso à base unificada direto no navegador.
 *
 * Os parquets do star schema somam 5,5 MB e o fato tem 1,09 milhão de linhas —
 * volume que o DuckDB-Wasm consulta sem esforço, o que dispensa backend e
 * dispensa pré-agregar. Como o modelo foi desenhado para JOIN, vale usar SQL
 * de verdade em vez de manipular arrays no cliente.
 */

const TABELAS = [
  'fato_votos', 'fato_local_cargo', 'fato_local', 'fato_oficial_munzona',
  'dim_eleicao', 'dim_eleicao_cargo', 'dim_cargo', 'dim_municipio',
  'dim_local', 'dim_local_atual', 'dim_partido', 'dim_partido_ano',
  'dim_votavel', 'dim_politico',
] as const

export type Tabela = (typeof TABELAS)[number]

let conexao: Promise<duckdb.AsyncDuckDBConnection> | null = null

async function inicia(): Promise<duckdb.AsyncDuckDBConnection> {
  const pacotes = duckdb.getJsDelivrBundles()
  const bundle = await duckdb.selectBundle(pacotes)

  // O worker vem de um blob para não depender de cross-origin no jsDelivr.
  const url = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker!}");`], {
      type: 'text/javascript',
    }),
  )
  const worker = new Worker(url)
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker)
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
  URL.revokeObjectURL(url)

  const con = await db.connect()
  // Registra cada parquet como uma view, para o SQL falar em nomes de tabela.
  await Promise.all(
    TABELAS.map(async (t) => {
      const resposta = await fetch(`${import.meta.env.BASE_URL}dados/${t}.parquet`)
      if (!resposta.ok) throw new Error(`parquet ausente: ${t}`)
      await db.registerFileBuffer(`${t}.parquet`, new Uint8Array(await resposta.arrayBuffer()))
    }),
  )
  for (const t of TABELAS) {
    await con.query(`CREATE VIEW ${t} AS SELECT * FROM read_parquet('${t}.parquet')`)
  }
  return con
}

/** Conexão única, criada na primeira consulta. */
export function conecta(): Promise<duckdb.AsyncDuckDBConnection> {
  conexao ??= inicia()
  return conexao
}

// Duas consultas com o mesmo texto disparadas no mesmo instante (comum
// quando vários seletores independentes nascem com o mesmo cargo/eleição
// padrão, como no Cruzamento) precisam compartilhar a mesma promise — pedir
// a mesma query duas vezes em paralelo à mesma AsyncDuckDBConnection faz uma
// das duas voltar vazia.
const emVoo = new Map<string, Promise<Record<string, unknown>[]>>()

/** Roda SQL e devolve as linhas já como objetos JS. */
export function consulta<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const existente = emVoo.get(sql)
  if (existente) return existente as Promise<T[]>

  const pedido = (async () => {
    const con = await conecta()
    const resultado = await con.query(sql)
    return resultado.toArray().map((linha) => {
      const obj = linha.toJSON() as Record<string, unknown>
      // O Arrow devolve inteiros grandes como BigInt, que quebra o Recharts.
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'bigint') obj[k] = Number(v)
      }
      return obj
    })
  })()
  emVoo.set(sql, pedido)
  pedido.finally(() => emVoo.delete(sql))
  return pedido as Promise<T[]>
}
