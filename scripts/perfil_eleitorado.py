"""Agrega o perfil demográfico do eleitorado atual da Bahia.

Fonte: dados/perfil_eleitorado/perfil_eleitor_secao_ATUAL_BA.csv (TSE, ~1,7 GB,
grão por seção x combinação completa de atributos demográficos — cada eleitor
aparece em exatamente uma linha, na combinação que tem). ANO_ELEICAO é sempre
9999 (sentinela do TSE pra "situação atual"): isto não é uma série por
eleição, é uma fotografia do cadastro no dia em que o TSE gerou o arquivo, daí
viver fora do star schema por ano em vez de virar mais uma dimensão de
`unifica.py`.

O arquivo é grande demais pra pandas puro sem chunking; o DuckDB agrega em
streaming sem carregar tudo na memória.

Saída: dados/processados/unificado/fato_perfil_eleitorado.parquet, no formato
"longo" (uma linha por município x zona x dimensão x categoria) em vez de uma
coluna por atributo — mantém o arquivo pequeno independente de quantas
dimensões existam, e o painel escolhe a dimensão a exibir com um único filtro
de igualdade em vez de uma coluna fixa por gráfico.

Uso:  python scripts/perfil_eleitorado.py
"""
import os
import sys

import duckdb
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eleitoral import esquema  # noqa: E402

CAMINHO_BRUTO = os.path.join(esquema.DIR_DADOS, 'perfil_eleitorado',
                              'perfil_eleitor_secao_ATUAL_BA.csv')
SAIDA = os.path.join(esquema.DIR_UNIFICADO, 'fato_perfil_eleitorado.parquet')

# Nome da dimensão (o que o painel mostra) -> coluna de origem no CSV do TSE.
DIMENSOES = {
    'GENERO': 'DS_GENERO',
    'ESTADO_CIVIL': 'DS_ESTADO_CIVIL',
    'FAIXA_ETARIA': 'DS_FAIXA_ETARIA',
    'GRAU_INSTRUCAO': 'DS_GRAU_INSTRUCAO',
    'COR_RACA': 'DS_COR_RACA',
    'IDENTIDADE_GENERO': 'DS_IDENTIDADE_GENERO',
    'QUILOMBOLA': 'DS_QUILOMBOLA',
    'INTERPRETE_LIBRAS': 'DS_INTERPRETE_LIBRAS',
}


def main():
    print('lendo o bruto (~1,7 GB, uma passada só)...')
    con = duckdb.connect()
    # Materializa numa TABLE: só as colunas usadas, lidas uma vez. Uma VIEW sobre
    # read_csv() reabriria e reparseria o arquivo inteiro a cada um dos 8 SELECTs
    # do UNION ALL abaixo — 8 passadas em vez de 1 no arquivo de 1,7 GB.
    colunas = ['CD_MUNICIPIO', 'NR_ZONA', 'ANO_ELEICAO', 'QT_ELEITORES'] + list(DIMENSOES.values())
    con.execute(f"""
        CREATE TABLE bruto AS
        SELECT {', '.join(colunas)}
        FROM read_csv('{CAMINHO_BRUTO}', delim=';', encoding='latin-1', header=true, quote='"')
    """)
    print(f'  {con.execute("SELECT COUNT(*) FROM bruto").fetchone()[0]:,} linhas')

    total_geral = con.execute('SELECT SUM(QT_ELEITORES) FROM bruto').fetchone()[0]
    assert con.execute("SELECT COUNT(DISTINCT ANO_ELEICAO) FROM bruto").fetchone()[0] == 1, \
        'esperava um só ANO_ELEICAO (sentinela 9999 do TSE)'

    print('agregando por dimensão...')
    # Uma consulta por dimensão, não um UNION ALL das 8: o DuckDB 1.5.5 trava
    # (sem erro, sem uso de CPU) ao paralelizar 8 agregações unidas na mesma
    # consulta contra esta tabela — cada uma isolada roda em ~30ms. Concatena
    # em pandas em vez de deixar o SQL juntar.
    partes = []
    for dimensao, coluna in DIMENSOES.items():
        parte = con.execute(f"""
            SELECT CD_MUNICIPIO, NR_ZONA, '{dimensao}' AS DIMENSAO,
                   {coluna} AS CATEGORIA, SUM(QT_ELEITORES) AS QT_ELEITORES
            FROM bruto GROUP BY 1, 2, 3, 4
        """).fetchdf()
        partes.append(parte)
        print(f'  {dimensao}: {len(parte):,} linhas')
    agregado = pd.concat(partes, ignore_index=True)

    agregado['CD_MUNICIPIO'] = agregado['CD_MUNICIPIO'].astype('int32')
    agregado['NR_ZONA'] = agregado['NR_ZONA'].astype('int32')
    agregado['DIMENSAO'] = agregado['DIMENSAO'].astype('string')
    agregado['CATEGORIA'] = agregado['CATEGORIA'].astype('string')
    agregado['QT_ELEITORES'] = agregado['QT_ELEITORES'].astype('int64')

    # Cada dimensão tem de reconstituir o total geral: garante que a soma por
    # (município, zona, categoria) não perdeu nem duplicou eleitor no caminho.
    for dimensao in DIMENSOES:
        soma = agregado.loc[agregado['DIMENSAO'] == dimensao, 'QT_ELEITORES'].sum()
        assert soma == total_geral, \
            f'{dimensao}: soma {soma:,} != total geral {total_geral:,}'

    os.makedirs(esquema.DIR_UNIFICADO, exist_ok=True)
    agregado.to_parquet(SAIDA, index=False, compression='zstd')
    tam = os.path.getsize(SAIDA)
    print(f'gravado: {SAIDA}  ({len(agregado):,} linhas, {tam/1024:.0f} KB)')
    print(f'  eleitorado total: {total_geral:,.0f}')
    return agregado


if __name__ == '__main__':
    main()
