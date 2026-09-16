"""Agrega o perfil demográfico do eleitorado atual do Piauí.

Fonte: dados/perfil_eleitorado/perfil_eleitor_secao_2026_PI.csv (TSE, ~412 MB,
grão por seção x combinação completa de atributos demográficos — cada eleitor
aparece em exatamente uma linha, na combinação que tem). `AA_ELEICAO` traz um
valor só (o ano da geração do arquivo, não uma eleição real): isto não é uma
série por eleição, é uma fotografia do cadastro no dia em que o TSE gerou o
arquivo, daí viver fora do star schema por ano em vez de virar mais uma
dimensão de `unifica.py`.

Duas colunas têm nome diferente do arquivo da Bahia, mesmo conteúdo:
`DS_GRAU_ESCOLARIDADE` (lá, `DS_GRAU_INSTRUCAO`) e `DS_RACA_COR` (lá,
`DS_COR_RACA`). O nome interno da dimensão (`GRAU_INSTRUCAO`, `COR_RACA`)
fica igual ao da Bahia de propósito — é o que o painel React consome, e
mantê-lo estável entre estados evita duplicar `PerfilEleitorado.tsx`.

O arquivo é grande demais pra pandas puro sem chunking; o DuckDB agrega em
streaming sem carregar tudo na memória.

Granularidade de local: o arquivo já traz `NR_LOCAL_VOTACAO`/`NM_LOCAL_VOTACAO`
por seção, então dá pra descer o perfil até o local sem baixar mais nada — só
não passa por `SK_LOCAL` (a identidade resolvida em `locais.py` pro star
schema por eleição), porque essa resolução existe pra casar local através de
anos com numeração diferente, e aqui só existe UM retrato (o atual): a chave
natural (CD_MUNICIPIO, NR_ZONA, NR_LOCAL_VOTACAO) já é suficiente e evita
herdar a complexidade de renumeração que não se aplica a uma fonte sem série
temporal.

Saída:
  - fato_perfil_eleitorado.parquet: formato "longo" (uma linha por local x
    dimensão x categoria) em vez de uma coluna por atributo — mantém o
    arquivo pequeno independente de quantas dimensões existam, e o painel
    escolhe a dimensão a exibir com um único filtro de igualdade em vez de
    uma coluna fixa por gráfico. Sem o nome do local — fica só a chave
    numérica, o nome vive em `dim_local_perfil` pra não repetir a string em
    toda linha do fato.
  - dim_local_perfil.parquet: (CD_MUNICIPIO, NR_ZONA, NR_LOCAL_VOTACAO,
    NM_LOCAL_VOTACAO, NM_BAIRRO) distintos — pra popular os seletores de
    bairro e de local no painel. `NM_BAIRRO` não vem do arquivo de perfil (que
    não tem essa coluna) — é casado de `dim_local` (o cadastro de local do
    star schema, que tem bairro desde sempre) pela chave natural, priorizando
    o ano mais recente por local: como as duas fontes são "situação atual",
    a numeração de zona/local já bate direto, sem precisar da resolução de
    `SK_LOCAL`.

Uso:  python scripts/perfil_eleitorado.py
"""
import os
import sys

import duckdb
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eleitoral import esquema  # noqa: E402

CAMINHO_BRUTO = os.path.join(esquema.DIR_DADOS, 'perfil_eleitorado',
                              'perfil_eleitor_secao_2026_PI.csv')
CAMINHO_DIM_LOCAL = os.path.join(esquema.DIR_UNIFICADO, 'dim_local.parquet')
SAIDA_FATO = os.path.join(esquema.DIR_UNIFICADO, 'fato_perfil_eleitorado.parquet')
SAIDA_LOCAL = os.path.join(esquema.DIR_UNIFICADO, 'dim_local_perfil.parquet')

# Nome da dimensão (o que o painel mostra, igual ao usado na Bahia) -> coluna
# de origem no CSV do TSE (nomes próprios deste arquivo, ver docstring).
DIMENSOES = {
    'GENERO': 'DS_GENERO',
    'ESTADO_CIVIL': 'DS_ESTADO_CIVIL',
    'FAIXA_ETARIA': 'DS_FAIXA_ETARIA',
    'GRAU_INSTRUCAO': 'DS_GRAU_ESCOLARIDADE',
    'COR_RACA': 'DS_RACA_COR',
    'IDENTIDADE_GENERO': 'DS_IDENTIDADE_GENERO',
    'QUILOMBOLA': 'DS_QUILOMBOLA',
    'INTERPRETE_LIBRAS': 'DS_INTERPRETE_LIBRAS',
}

CHAVE_LOCAL = ['CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO']


def main():
    print('lendo o bruto (~412 MB, uma passada só)...')
    con = duckdb.connect()
    # Materializa numa TABLE: só as colunas usadas, lidas uma vez. Uma VIEW sobre
    # read_csv() reabriria e reparseria o arquivo inteiro a cada um dos 8 SELECTs
    # abaixo.
    colunas = CHAVE_LOCAL + ['NM_LOCAL_VOTACAO', 'AA_ELEICAO', 'QT_ELEITORES'] + list(DIMENSOES.values())
    con.execute(f"""
        CREATE TABLE bruto AS
        SELECT {', '.join(colunas)}
        FROM read_csv('{CAMINHO_BRUTO}', delim=';', encoding='latin-1', header=true, quote='"')
    """)
    print(f'  {con.execute("SELECT COUNT(*) FROM bruto").fetchone()[0]:,} linhas')

    total_geral = con.execute('SELECT SUM(QT_ELEITORES) FROM bruto').fetchone()[0]
    assert con.execute("SELECT COUNT(DISTINCT AA_ELEICAO) FROM bruto").fetchone()[0] == 1, \
        'esperava um só AA_ELEICAO — é a data de geração do arquivo, não uma eleição real'

    print('agregando por dimensão (grão: local de votação)...')
    # Uma consulta por dimensão, não um UNION ALL das 8: o DuckDB 1.5.5 trava
    # (sem erro, sem uso de CPU) ao paralelizar 8 agregações unidas na mesma
    # consulta contra esta tabela — cada uma isolada roda rápido. Concatena
    # em pandas em vez de deixar o SQL juntar.
    chave_sql = ', '.join(CHAVE_LOCAL)
    partes = []
    for dimensao, coluna in DIMENSOES.items():
        parte = con.execute(f"""
            SELECT {chave_sql}, '{dimensao}' AS DIMENSAO,
                   {coluna} AS CATEGORIA, SUM(QT_ELEITORES) AS QT_ELEITORES
            FROM bruto GROUP BY {', '.join(str(i) for i in range(1, len(CHAVE_LOCAL) + 3))}
        """).fetchdf()
        partes.append(parte)
        print(f'  {dimensao}: {len(parte):,} linhas')
    agregado = pd.concat(partes, ignore_index=True)

    agregado['CD_MUNICIPIO'] = agregado['CD_MUNICIPIO'].astype('int32')
    agregado['NR_ZONA'] = agregado['NR_ZONA'].astype('int32')
    agregado['NR_LOCAL_VOTACAO'] = agregado['NR_LOCAL_VOTACAO'].astype('int32')
    agregado['DIMENSAO'] = agregado['DIMENSAO'].astype('string')
    agregado['CATEGORIA'] = agregado['CATEGORIA'].astype('string')
    agregado['QT_ELEITORES'] = agregado['QT_ELEITORES'].astype('int64')

    # Cada dimensão tem de reconstituir o total geral: garante que a soma por
    # local não perdeu nem duplicou eleitor no caminho.
    for dimensao in DIMENSOES:
        soma = agregado.loc[agregado['DIMENSAO'] == dimensao, 'QT_ELEITORES'].sum()
        assert soma == total_geral, \
            f'{dimensao}: soma {soma:,} != total geral {total_geral:,}'

    print('montando o nome dos locais...')
    locais = con.execute(f"""
        SELECT {chave_sql}, ANY_VALUE(NM_LOCAL_VOTACAO) AS NM_LOCAL_VOTACAO
        FROM bruto GROUP BY {chave_sql}
    """).fetchdf()
    locais['CD_MUNICIPIO'] = locais['CD_MUNICIPIO'].astype('int32')
    locais['NR_ZONA'] = locais['NR_ZONA'].astype('int32')
    locais['NR_LOCAL_VOTACAO'] = locais['NR_LOCAL_VOTACAO'].astype('int32')
    locais['NM_LOCAL_VOTACAO'] = locais['NM_LOCAL_VOTACAO'].astype('string')
    assert not locais.duplicated(CHAVE_LOCAL).any(), 'chave de local duplicada'

    print('casando bairro (de dim_local, o mais recente por local)...')
    dim_local = pd.read_parquet(CAMINHO_DIM_LOCAL, columns=CHAVE_LOCAL + ['ANO_ELEICAO', 'NM_BAIRRO'])
    bairro = (dim_local.sort_values('ANO_ELEICAO')
              .drop_duplicates(CHAVE_LOCAL, keep='last')[CHAVE_LOCAL + ['NM_BAIRRO']])
    locais = locais.merge(bairro, on=CHAVE_LOCAL, how='left')
    sem_bairro = locais['NM_BAIRRO'].isna().sum()
    print(f'  {len(locais) - sem_bairro:,}/{len(locais):,} locais com bairro '
          f'({sem_bairro:,} sem correspondência em dim_local)')
    # Sem correspondência vira grupo próprio, não fica invisível pro filtro.
    locais['NM_BAIRRO'] = locais['NM_BAIRRO'].fillna('SEM BAIRRO CADASTRADO')

    os.makedirs(esquema.DIR_UNIFICADO, exist_ok=True)
    agregado.to_parquet(SAIDA_FATO, index=False, compression='zstd')
    locais.to_parquet(SAIDA_LOCAL, index=False, compression='zstd')
    for caminho, df in [(SAIDA_FATO, agregado), (SAIDA_LOCAL, locais)]:
        tam = os.path.getsize(caminho)
        print(f'gravado: {caminho}  ({len(df):,} linhas, {tam/1024:.0f} KB)')
    print(f'  eleitorado total: {total_geral:,.0f}')
    return agregado, locais


if __name__ == '__main__':
    main()
