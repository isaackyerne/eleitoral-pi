"""
Consolida os dados eleitorais estaduais do Piauí de 2026 (TSE) em um único CSV analítico.

Fontes (dados/2026/):
  - votacao_secao_2026_PI.csv          : votos por seção x cargo x votável
  - eleitorado_local_votacao_2026_PI.csv: cadastro de seções/locais (já por UF)

Saída: dados/processados/eleicoes_pi_2026.csv
Granularidade: local de votação x cargo x votável.

Diferenças relevantes em relação a 2022:
  - Senador volta a ter 2 vagas (como em 2018): o total de votos do cargo é o dobro do
    comparecimento. `VAGAS`/`VOTOS_POR_ELEITOR` em `esquema.py` cuidam da normalização.
  - Só há 1º turno nos arquivos publicados até aqui.
  - O arquivo de votação já traz nome e endereço do local, mas o **número** do local que ele
    traz é o antigo para as seções remanejadas (veja abaixo).

Local de votação — seções remanejadas e agregadas:
  - O cadastro tem duas numerações por seção: `NR_LOCAL_VOTACAO` (o local atual) e
    `NR_LOCAL_VOTACAO_ORIGINAL` (onde a seção estava antes do remanejamento). Em 2026, 357
    das 10.225 seções principais do Piauí foram remanejadas. No arquivo de votação o número
    do local é sempre o ORIGINAL (casa 100% com ele), mas o NOME e o ENDEREÇO são os do local
    ATUAL (99,7% nas remanejadas) — ou seja, a votação aconteceu no local novo, com o número
    antigo carimbado. Em 59 casos o número antigo é hoje o código de OUTRO local existente,
    então casar votos e cadastro pelo número do local misturaria locais diferentes.
  - Por isso o voto é ligado ao local pela SEÇÃO (município, zona, seção — chave única, 100%
    de casamento nos dois arquivos), e o local passa a ser o ATUAL do cadastro. Isto é
    diferente dos anos anteriores, que usam o ORIGINAL; ali os dois coincidiam com o local em
    vigor na eleição, e aqui o ORIGINAL aponta pra onde a seção NÃO votou.
    `FL_LOCAL_REMANEJADO` marca os locais que receberam alguma seção remanejada.
  - Seções agregadas (1.036) não têm votos próprios: os eleitores delas votam na seção
    principal, e o arquivo de votação só traz a principal. `QT_ELEITOR_ELEICAO_ESTADUAL` da
    principal já consolida os aptos das agregadas; o fallback (soma manual) só entra se
    o campo vier zerado.
"""

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eleitoral import esquema, presidente  # noqa: E402

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dados')
BRUTO = os.path.join(BASE, '2026')
SAIDA_DIR = os.path.join(BASE, 'processados')
SAIDA = os.path.join(SAIDA_DIR, 'eleicoes_pi_2026.csv')

CHAVE_SECAO = ['NR_TURNO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO']
CHAVE_LOCAL = ['NR_TURNO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO']

CARGOS = {
    'PRESIDENTE': 'Presidente',
    'GOVERNADOR': 'Governador',
    'SENADOR': 'Senador',
    'DEPUTADO FEDERAL': 'Deputado Federal',
    'DEPUTADO ESTADUAL': 'Deputado Estadual',
}
CARGOS_PROPORCIONAIS = {'Deputado Federal', 'Deputado Estadual'}

# Partidos que lançaram candidato mas não receberam nenhum voto de legenda no Piauí, e por
# isso não têm o nome extraído das próprias linhas de voto. Nome conforme o consulta_cand de
# 2026 (o arquivo grafa "SOCIALISTA  DOS" com dois espaços; aqui vai normalizado).
# 21 e 28 são partidos com candidato a Presidente (nomes do consulta_cand nacional).
PARTIDOS_EXTRA = {
    '16': 'PARTIDO SOCIALISTA DOS TRABALHADORES UNIFICADO',
    '21': 'PARTIDO COMUNISTA BRASILEIRO',
    '28': 'PARTIDO RENOVADOR TRABALHISTA BRASILEIRO',
}

# Colunas do local que vêm do arquivo de votação e são descartadas: o local certo sai do
# cadastro, ligado pela seção (ver docstring).
LOCAL_DA_VOTACAO = ['NR_LOCAL_VOTACAO', 'NM_LOCAL_VOTACAO', 'DS_LOCAL_VOTACAO_ENDERECO']


def carrega_votacao():
    df = pd.read_csv(
        os.path.join(BRUTO, 'votacao_secao_2026_PI.csv'),
        sep=';', encoding='latin1', quotechar='"', dtype=str,
        na_values=esquema.NA_TSE,
    )
    df.columns = [c.strip() for c in df.columns]
    # Presidente só existe no arquivo nacional do TSE; ver eleitoral/presidente.py.
    df = presidente.anexa(df, 2026)
    df['QT_VOTOS'] = pd.to_numeric(df['QT_VOTOS'])
    # A caixa do texto varia entre exportações do TSE.
    df['DS_CARGO'] = df['DS_CARGO'].str.upper().map(CARGOS)
    assert df['DS_CARGO'].notna().all(), 'cargo desconhecido no arquivo de votação'
    for c in ['DS_ELEICAO', 'NM_TIPO_ELEICAO']:
        df[c] = df[c].str.title()
    return df.drop(columns=LOCAL_DA_VOTACAO)


def carrega_eleitorado():
    """Lê o cadastro do PI (o arquivo de 2026 já vem por UF)."""
    df = pd.read_csv(
        os.path.join(BRUTO, 'eleitorado_local_votacao_2026_PI.csv'),
        sep=';', encoding='latin1', quotechar='"', dtype=str,
        na_values=esquema.NA_TSE,
    )
    df.columns = [c.strip() for c in df.columns]
    df = df[df['SG_UF'] == 'PI']
    for c in ['QT_ELEITOR_SECAO', 'QT_ELEITOR_ELEICAO_ESTADUAL']:
        df[c] = pd.to_numeric(df[c])
    return df.reset_index(drop=True)


def aptos_por_secao(el):
    """Aptos a votar em cada seção principal.

    QT_ELEITOR_ELEICAO_ESTADUAL já consolida na principal os eleitores das seções
    agregadas. O fallback (soma manual) cobre o caso de o campo vir zerado.
    """
    vinculadas = el[el['DS_TIPO_SECAO_AGREGADA'] != 'Principal']
    soma = (
        vinculadas.groupby(['NR_TURNO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO_PRINCIPAL'])['QT_ELEITOR_SECAO']
        .sum().rename('QT_VINCULADAS').reset_index()
        .rename(columns={'NR_SECAO_PRINCIPAL': 'NR_SECAO'})
    )

    pr = el[el['DS_TIPO_SECAO_AGREGADA'] == 'Principal'].copy()
    pr = pr.merge(soma, on=CHAVE_SECAO, how='left')
    pr['QT_VINCULADAS'] = pr['QT_VINCULADAS'].fillna(0)

    fallback = pr['QT_ELEITOR_SECAO'] + pr['QT_VINCULADAS']
    pr['QT_APTOS'] = np.where(pr['QT_ELEITOR_ELEICAO_ESTADUAL'] > 0,
                              pr['QT_ELEITOR_ELEICAO_ESTADUAL'], fallback)
    pr['FL_APTOS_ESTIMADO'] = pr['QT_ELEITOR_ELEICAO_ESTADUAL'] == 0
    pr['QT_SECOES_AGREGADAS'] = np.where(pr['QT_VINCULADAS'] > 0, 1, 0)
    return pr


def cadastro_locais(pr):
    """Colapsa as seções principais em uma linha por local de votação ATUAL."""
    lat = pd.to_numeric(pr['NR_LATITUDE'].str.replace(',', '.'), errors='coerce')
    lon = pd.to_numeric(pr['NR_LONGITUDE'].str.replace(',', '.'), errors='coerce')
    valido = lat.between(-11.5, -2.5) & lon.between(-46.5, -40.0)
    pr = pr.assign(LATITUDE=lat.where(valido), LONGITUDE=lon.where(valido))

    vazio = ['-1', '0', '00000000', '000000000']
    pr = pr.assign(
        NR_TELEFONE_LOCAL=pr['NR_TELEFONE_LOCAL'].where(~pr['NR_TELEFONE_LOCAL'].isin(vazio)),
        NR_CEP=pr['NR_CEP'].where(~pr['NR_CEP'].isin(vazio)),
        FL_LOCAL_REMANEJADO=pr['NR_LOCAL_VOTACAO'] != pr['NR_LOCAL_VOTACAO_ORIGINAL'],
    )

    prim = lambda s: s.dropna().iloc[0] if s.notna().any() else pd.NA
    moda = lambda s: s.mode().iloc[0] if not s.dropna().empty else pd.NA
    return pr.groupby(CHAVE_LOCAL, as_index=False).agg(
        NM_MUNICIPIO=('NM_MUNICIPIO', 'first'),
        NM_LOCAL_VOTACAO=('NM_LOCAL_VOTACAO', moda),
        DS_TIPO_LOCAL=('DS_TIPO_LOCAL', moda),
        DS_ENDERECO=('DS_ENDERECO', moda),
        NM_BAIRRO=('NM_BAIRRO', moda),
        NR_CEP=('NR_CEP', prim),
        NR_TELEFONE_LOCAL=('NR_TELEFONE_LOCAL', prim),
        LATITUDE=('LATITUDE', prim),
        LONGITUDE=('LONGITUDE', prim),
        DS_SITU_LOCAL_VOTACAO=('DS_SITU_LOCAL_VOTACAO', moda),
        QT_SECOES=('NR_SECAO', 'nunique'),
        QT_SECOES_ACESSIVEIS=('DS_SITU_SECAO_ACESSIBILIDADE',
                              lambda s: (s == 'Com acessibilidade').sum()),
        QT_SECOES_AGREGADAS=('QT_SECOES_AGREGADAS', 'sum'),
        QT_APTOS=('QT_APTOS', 'sum'),
        FL_APTOS_ESTIMADO=('FL_APTOS_ESTIMADO', 'any'),
        FL_LOCAL_REMANEJADO=('FL_LOCAL_REMANEJADO', 'any'),
    )


def classifica_voto(cargo, nr_votavel):
    if nr_votavel == '95':
        return 'Branco'
    if nr_votavel == '96':
        return 'Nulo'
    # 97 é código reservado do TSE pra "voto anulado e apurado em separado" — não é
    # número de partido, mesmo em cargo proporcional.
    if nr_votavel == '97':
        return 'Nulo'
    # Legenda existe só nos cargos proporcionais: nesses, o número do partido (2
    # dígitos) aparece sozinho como votável.
    if cargo in CARGOS_PROPORCIONAIS and len(nr_votavel) == 2:
        return 'Legenda'
    return 'Nominal'


def main():
    print('lendo votação...')
    vt = carrega_votacao()
    print('lendo eleitorado...')
    el = carrega_eleitorado()

    pr = aptos_por_secao(el)

    # Local da votação = local ATUAL da seção, ligado pela seção (ver docstring).
    secoes = pr[CHAVE_SECAO + ['NR_LOCAL_VOTACAO']]
    assert not secoes.duplicated(CHAVE_SECAO).any(), 'seção principal repetida no cadastro'
    vt = vt.merge(secoes, on=CHAVE_SECAO, how='left', validate='many_to_one')
    sem_local = vt['NR_LOCAL_VOTACAO'].isna().sum()
    assert sem_local == 0, f'{sem_local} linhas de voto em seção que não está no cadastro'

    locais = cadastro_locais(pr)

    # Comparecimento: total de votos de um cargo de voto único (Governador).
    comp = (
        vt[vt['DS_CARGO'] == 'Governador']
        .groupby(CHAVE_LOCAL, as_index=False)['QT_VOTOS'].sum()
        .rename(columns={'QT_VOTOS': 'QT_COMPARECIMENTO'})
    )

    print('agregando votos por local...')
    votos = vt.groupby(
        ['CD_ELEICAO', 'DS_ELEICAO', 'NM_TIPO_ELEICAO', 'DT_ELEICAO'] + CHAVE_LOCAL
        + ['CD_CARGO', 'DS_CARGO', 'NR_VOTAVEL', 'NM_VOTAVEL', 'SQ_CANDIDATO'],
        as_index=False,
    )['QT_VOTOS'].sum()

    votos['TP_VOTO'] = [classifica_voto(c, n)
                        for c, n in zip(votos['DS_CARGO'], votos['NR_VOTAVEL'])]
    votos['NR_PARTIDO'] = votos['NR_VOTAVEL'].str[:2].where(
        votos['TP_VOTO'].isin(['Nominal', 'Legenda']))

    # O nome de cada partido é extraído das próprias linhas de voto de legenda.
    legenda = votos[votos['TP_VOTO'] == 'Legenda'][['NR_VOTAVEL', 'NM_VOTAVEL']].drop_duplicates()
    mapa_partido = dict(zip(legenda['NR_VOTAVEL'], legenda['NM_VOTAVEL']))
    mapa_partido.update(PARTIDOS_EXTRA)
    votos['NM_PARTIDO'] = votos['NR_PARTIDO'].map(mapa_partido)
    sem_nome = votos[votos['NR_PARTIDO'].notna() & votos['NM_PARTIDO'].isna()]['NR_PARTIDO'].unique()
    assert len(sem_nome) == 0, f'partidos sem nome: {sorted(sem_nome)}'

    votos['SQ_CANDIDATO'] = votos['SQ_CANDIDATO'].where(~votos['SQ_CANDIDATO'].isin(['-1', '-3']))

    df = votos.merge(locais, on=CHAVE_LOCAL, how='left', validate='many_to_one')
    assert df['NM_LOCAL_VOTACAO'].notna().all(), 'voto sem cadastro de local'
    df = df.merge(comp, on=CHAVE_LOCAL, how='left', validate='many_to_one')

    # Denominadores por local x cargo, para percentuais prontos no dashboard.
    grupo = CHAVE_LOCAL + ['CD_CARGO']
    validos = (
        df[df['TP_VOTO'].isin(['Nominal', 'Legenda'])]
        .groupby(grupo, as_index=False)['QT_VOTOS'].sum()
        .rename(columns={'QT_VOTOS': 'QT_VOTOS_VALIDOS_LOCAL_CARGO'})
    )
    df = df.merge(validos, on=grupo, how='left')
    df['QT_VOTOS_VALIDOS_LOCAL_CARGO'] = df['QT_VOTOS_VALIDOS_LOCAL_CARGO'].fillna(0).astype('int64')
    df['QT_VOTOS_TOTAL_LOCAL_CARGO'] = df.groupby(grupo)['QT_VOTOS'].transform('sum')

    df['PCT_VOTOS_VALIDOS'] = np.where(
        df['TP_VOTO'].isin(['Nominal', 'Legenda']) & (df['QT_VOTOS_VALIDOS_LOCAL_CARGO'] > 0),
        (df['QT_VOTOS'] / df['QT_VOTOS_VALIDOS_LOCAL_CARGO'] * 100).round(4), np.nan)
    df['PCT_VOTOS_TOTAL'] = np.where(
        df['QT_VOTOS_TOTAL_LOCAL_CARGO'] > 0,
        (df['QT_VOTOS'] / df['QT_VOTOS_TOTAL_LOCAL_CARGO'] * 100).round(4), np.nan)

    df['QT_ABSTENCAO'] = df['QT_APTOS'] - df['QT_COMPARECIMENTO']
    df['PCT_COMPARECIMENTO'] = np.where(
        df['QT_APTOS'] > 0, (df['QT_COMPARECIMENTO'] / df['QT_APTOS'] * 100).round(4), np.nan)
    df['PCT_ABSTENCAO'] = np.where(
        df['QT_APTOS'] > 0, (df['QT_ABSTENCAO'] / df['QT_APTOS'] * 100).round(4), np.nan)

    df['ANO_ELEICAO'] = 2026
    df['SG_UF'] = 'PI'
    df['DT_ELEICAO'] = pd.to_datetime(df['DT_ELEICAO'], format='%d/%m/%Y').dt.strftime('%Y-%m-%d')
    df['ID_LOCAL'] = df['CD_MUNICIPIO'] + '-' + df['NR_ZONA'] + '-' + df['NR_LOCAL_VOTACAO']
    df['FL_ELEICAO_SUPLEMENTAR'] = False

    for c in ['CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO', 'CD_CARGO', 'NR_TURNO', 'CD_ELEICAO']:
        df[c] = df[c].astype('int64')
    for c in ['QT_SECOES', 'QT_SECOES_AGREGADAS', 'QT_SECOES_ACESSIVEIS',
              'QT_APTOS', 'QT_COMPARECIMENTO', 'QT_ABSTENCAO']:
        df[c] = df[c].astype('Int64')
    for c in ['FL_APTOS_ESTIMADO', 'FL_LOCAL_REMANEJADO']:
        df[c] = df[c].fillna(False).astype(bool)

    colunas = [
        'ANO_ELEICAO', 'CD_ELEICAO', 'DS_ELEICAO', 'NM_TIPO_ELEICAO', 'NR_TURNO', 'DT_ELEICAO', 'SG_UF',
        'CD_MUNICIPIO', 'NM_MUNICIPIO', 'NR_ZONA',
        'ID_LOCAL', 'NR_LOCAL_VOTACAO', 'NM_LOCAL_VOTACAO', 'DS_TIPO_LOCAL',
        'DS_ENDERECO', 'NM_BAIRRO', 'NR_CEP', 'NR_TELEFONE_LOCAL',
        'LATITUDE', 'LONGITUDE', 'DS_SITU_LOCAL_VOTACAO',
        'QT_SECOES', 'QT_SECOES_AGREGADAS', 'QT_SECOES_ACESSIVEIS',
        'CD_CARGO', 'DS_CARGO', 'TP_VOTO',
        'NR_VOTAVEL', 'NM_VOTAVEL', 'SQ_CANDIDATO', 'NR_PARTIDO', 'NM_PARTIDO',
        'QT_VOTOS', 'QT_VOTOS_VALIDOS_LOCAL_CARGO', 'QT_VOTOS_TOTAL_LOCAL_CARGO',
        'PCT_VOTOS_VALIDOS', 'PCT_VOTOS_TOTAL',
        'QT_APTOS', 'QT_COMPARECIMENTO', 'QT_ABSTENCAO',
        'PCT_COMPARECIMENTO', 'PCT_ABSTENCAO',
        'FL_APTOS_ESTIMADO', 'FL_LOCAL_REMANEJADO', 'FL_ELEICAO_SUPLEMENTAR',
    ]
    assert colunas == esquema.bronze_colunas(2026), 'colunas divergem de esquema.BRONZE_COLUNAS'
    df = df[colunas].sort_values(
        ['NR_TURNO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO', 'CD_CARGO', 'QT_VOTOS'],
        ascending=[True, True, True, True, True, False],
    )

    assert df['QT_VOTOS'].sum() == vt['QT_VOTOS'].sum(), 'perda de votos na consolidação'
    assert not df.duplicated(subset=['NR_TURNO', 'ID_LOCAL', 'CD_CARGO', 'NR_VOTAVEL']).any()
    locais_unicos = df.drop_duplicates(['NR_TURNO', 'ID_LOCAL'])
    excesso = locais_unicos[locais_unicos['QT_COMPARECIMENTO'] > locais_unicos['QT_APTOS']]
    if len(excesso):
        print(f'  aviso: {len(excesso)} locais com comparecimento acima dos aptos')
    print(f'  {df["FL_LOCAL_REMANEJADO"].mul(1).groupby(df["ID_LOCAL"]).max().sum()} locais com '
          f'seção remanejada, {int(locais_unicos["QT_SECOES_AGREGADAS"].sum())} seções principais '
          f'recebendo agregadas')

    os.makedirs(SAIDA_DIR, exist_ok=True)
    df.to_csv(SAIDA, index=False, encoding='utf-8', sep=',', decimal='.')
    print(f'gravado: {SAIDA}  ({len(df):,} linhas x {len(df.columns)} colunas)')
    return df


if __name__ == '__main__':
    main()
