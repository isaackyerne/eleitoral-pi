export type ColunaExcel = {
  titulo: string
  tipo?: 'texto' | 'inteiro' | 'percentual'
  largura?: number
}

const FORMATOS: Record<string, string> = { inteiro: '#,##0', percentual: '0.0%' }

/**
 * Exporta linhas como planilha .xlsx pronta para abrir: cabeçalho em negrito,
 * largura de coluna e formato numérico (milhar, percentual) por tipo — ao
 * contrário do CSV cru, não exige que o usuário configure nada na mão.
 *
 * `exceljs` é importado sob demanda: só quem exporta paga o custo do bundle.
 */
export async function exportarExcel(
  nomeArquivo: string,
  colunas: ColunaExcel[],
  linhas: (string | number | null)[][],
  opcoes?: { aba?: string; observacao?: string },
) {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Isaac Kyerne — IKGeo'
  wb.created = new Date()

  const ws = wb.addWorksheet(opcoes?.aba ?? 'Dados')
  ws.columns = colunas.map((c) => ({ width: c.largura ?? 16 }))

  if (opcoes?.observacao) {
    const linhaObs = ws.addRow([opcoes.observacao])
    linhaObs.getCell(1).font = { italic: true, color: { argb: 'FF767672' } }
    ws.mergeCells(1, 1, 1, colunas.length)
  }

  const cabecalho = ws.addRow(colunas.map((c) => c.titulo))
  cabecalho.eachCell((cel) => {
    cel.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
    cel.alignment = { vertical: 'middle' }
  })
  ws.views = [{ state: 'frozen', ySplit: cabecalho.number }]

  for (const linha of linhas) {
    const valores = linha.map((v, i) =>
      colunas[i].tipo === 'percentual' && typeof v === 'number' ? v / 100 : v,
    )
    const r = ws.addRow(valores)
    linha.forEach((_, i) => {
      const formato = colunas[i].tipo && FORMATOS[colunas[i].tipo!]
      if (formato) r.getCell(i + 1).numFmt = formato
    })
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  a.click()
  URL.revokeObjectURL(url)
}
