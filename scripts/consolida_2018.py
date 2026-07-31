"""
Consolida os dados eleitorais do Piauí de 2018 (TSE) em um único CSV analítico.

Fontes (dados/2018/):
  - votacao_secao_2018_PI.csv        : votos por seção x cargo x votável (1º turno, PI)
  - eleitorado_local_votacao_2018.csv: cadastro de seções/locais (nacional, filtrado para PI)

Saída: dados/processados/eleicoes_pi_2018.csv
Granularidade: local de votação x cargo x votável.
"""

import os
import numpy as np
import pandas as pd

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dados')
BRUTO = os.path.join(BASE, '2018')
SAIDA_DIR = os.path.join(BASE, 'processados')
SAIDA = os.path.join(SAIDA_DIR, 'eleicoes_pi_2018.csv')

CHAVE_SECAO = ['CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO']
CHAVE_LOCAL = ['CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO']

# O arquivo de eleitorado foi gerado em 2024 e traz em NR_LOCAL_VOTACAO o local
# ATUAL da seção, já com remanejamentos posteriores a 2018; o local vigente na
# eleição está em NR_LOCAL_VOTACAO_ORIGINAL, que é o que casa com a votação
# (8.930/8.930 seções). 180 seções foram remanejadas depois — para elas as
# colunas de contato/geo descrevem o local de destino, o que é sinalizado por
# FL_LOCAL_REMANEJADO.


def carrega_votacao():
    df = pd.read_csv(
        os.path.join(BRUTO, 'votacao_secao_2018_PI.csv'),
        sep=';', encoding='latin1', quotechar='"', dtype=str,
        na_values=['#NULO#', '#NE#'],
    )
    df['QT_VOTOS'] = pd.to_numeric(df['QT_VOTOS'])
    return df


def carrega_eleitorado():
    """Lê o arquivo nacional em blocos, mantendo apenas o PI, 1º turno."""
    partes = []
    leitor = pd.read_csv(
        os.path.join(BRUTO, 'eleitorado_local_votacao_2018.csv'),
        sep=';', encoding='latin1', quotechar='"', dtype=str,
        na_values=['#NULO#', '#NE#'], chunksize=200_000,
    )
    for bloco in leitor:
        partes.append(bloco[(bloco['SG_UF'] == 'PI') & (bloco['NR_TURNO'] == '1')])
    df = pd.concat(partes, ignore_index=True)
    for c in ['QT_ELEITOR_SECAO', 'QT_ELEITOR_ELEICAO_ESTADUAL']:
        df[c] = pd.to_numeric(df[c])
    return df


def aptos_por_secao(el):
    """Aptos a votar em cada seção principal.

    QT_ELEITOR_ELEICAO_ESTADUAL já consolida os eleitores das seções agregadas na
    seção principal, mas vem zerado em 37 seções (7 zonas). Nesses casos usa-se o
    fallback: eleitores da própria seção + eleitores das agregadas vinculadas a ela.
    """
    agregadas = el[el['DS_TIPO_SECAO_AGREGADA'] == 'Agregada']
    soma_ag = (
        agregadas.groupby(['CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO_PRINCIPAL'])['QT_ELEITOR_SECAO']
        .sum().rename('QT_AGREGADAS').reset_index()
        .rename(columns={'NR_SECAO_PRINCIPAL': 'NR_SECAO'})
    )

    pr = el[el['DS_TIPO_SECAO_AGREGADA'] == 'Principal'].copy()
    pr = pr.merge(soma_ag, on=CHAVE_SECAO, how='left')
    pr['QT_AGREGADAS'] = pr['QT_AGREGADAS'].fillna(0)

    fallback = pr['QT_ELEITOR_SECAO'] + pr['QT_AGREGADAS']
    pr['QT_APTOS'] = np.where(pr['QT_ELEITOR_ELEICAO_ESTADUAL'] > 0,
                              pr['QT_ELEITOR_ELEICAO_ESTADUAL'], fallback)
    pr['FL_APTOS_ESTIMADO'] = pr['QT_ELEITOR_ELEICAO_ESTADUAL'] == 0
    pr['QT_SECOES_AGREGADAS'] = np.where(pr['QT_AGREGADAS'] > 0, 1, 0)
    return pr


def cadastro_locais(pr):
    """Colapsa as seções principais em uma linha por local de votação de 2018."""
    lat = pd.to_numeric(pr['NR_LATITUDE'], errors='coerce')
    lon = pd.to_numeric(pr['NR_LONGITUDE'], errors='coerce')
    # -1 é sentinela do TSE para coordenada ausente; o bbox descarta pontos fora do PI
    valido = lat.between(-11.5, -2.5) & lon.between(-46.5, -40.0)
    pr = pr.assign(LATITUDE=lat.where(valido), LONGITUDE=lon.where(valido))

    vazio = ['-1', '0', '00000000', '000000000']
    pr = pr.assign(
        NR_TELEFONE_LOCAL=pr['NR_TELEFONE_LOCAL'].where(~pr['NR_TELEFONE_LOCAL'].isin(vazio)),
        NR_CEP=pr['NR_CEP'].where(~pr['NR_CEP'].isin(vazio)),
        FL_LOCAL_REMANEJADO=pr['NR_LOCAL_VOTACAO'] != pr['NR_LOCAL_VOTACAO_ORIGINAL'],
    )
    # A identidade do local passa a ser a de 2018.
    pr = pr.drop(columns=['NR_LOCAL_VOTACAO']).rename(columns={
        'NR_LOCAL_VOTACAO_ORIGINAL': 'NR_LOCAL_VOTACAO',
        'NM_LOCAL_VOTACAO_ORIGINAL': 'NM_LOCAL_VOTACAO_2018',
        'DS_ENDERECO_LOCVT_ORIGINAL': 'DS_ENDERECO_2018',
    })

    prim = lambda s: s.dropna().iloc[0] if s.notna().any() else pd.NA
    moda = lambda s: s.mode().iloc[0] if not s.dropna().empty else pd.NA
    return pr.groupby(CHAVE_LOCAL, as_index=False).agg(
        NM_MUNICIPIO=('NM_MUNICIPIO', 'first'),
        NM_LOCAL_VOTACAO=('NM_LOCAL_VOTACAO_2018', moda),
        DS_TIPO_LOCAL=('DS_TIPO_LOCAL', moda),
        DS_ENDERECO=('DS_ENDERECO_2018', moda),
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
    # Legenda existe só nos cargos proporcionais: nesses, o número do partido (2
    # dígitos) aparece sozinho como votável.
    if cargo in ('Deputado Federal', 'Deputado Estadual') and len(nr_votavel) == 2:
        return 'Legenda'
    return 'Nominal'


def main():
    print('lendo votação...')
    vt = carrega_votacao()
    print('lendo eleitorado (filtrando PI)...')
    el = carrega_eleitorado()

    pr = aptos_por_secao(el)
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
    votos['NR_PARTIDO'] = votos['NR_VOTAVEL'].str[:2].where(votos['TP_VOTO'] != 'Branco')
    votos['NR_PARTIDO'] = votos['NR_PARTIDO'].where(votos['TP_VOTO'] != 'Nulo')

    # O nome de cada partido é extraído das próprias linhas de voto de legenda.
    legenda = votos[votos['TP_VOTO'] == 'Legenda'][['NR_VOTAVEL', 'NM_VOTAVEL']].drop_duplicates()
    mapa_partido = dict(zip(legenda['NR_VOTAVEL'], legenda['NM_VOTAVEL']))
    votos['NM_PARTIDO'] = votos['NR_PARTIDO'].map(mapa_partido)
    votos['SQ_CANDIDATO'] = votos['SQ_CANDIDATO'].where(votos['SQ_CANDIDATO'] != '-3')

    df = votos.merge(locais, on=CHAVE_LOCAL, how='left', validate='many_to_one')
    faltando = df['NM_LOCAL_VOTACAO'].isna().sum()
    assert faltando == 0, f'{faltando} linhas de voto sem cadastro de local'
    df = df.merge(comp, on=CHAVE_LOCAL, how='left', validate='many_to_one')

    # Denominadores por local x cargo, para percentuais prontos no dashboard.
    validos = (
        df[df['TP_VOTO'].isin(['Nominal', 'Legenda'])]
        .groupby(CHAVE_LOCAL + ['CD_CARGO'], as_index=False)['QT_VOTOS'].sum()
        .rename(columns={'QT_VOTOS': 'QT_VOTOS_VALIDOS_LOCAL_CARGO'})
    )
    df = df.merge(validos, on=CHAVE_LOCAL + ['CD_CARGO'], how='left')
    df['QT_VOTOS_VALIDOS_LOCAL_CARGO'] = df['QT_VOTOS_VALIDOS_LOCAL_CARGO'].fillna(0).astype('int64')

    df['PCT_VOTOS_VALIDOS'] = np.where(
        df['TP_VOTO'].isin(['Nominal', 'Legenda']) & (df['QT_VOTOS_VALIDOS_LOCAL_CARGO'] > 0),
        (df['QT_VOTOS'] / df['QT_VOTOS_VALIDOS_LOCAL_CARGO'] * 100).round(4), np.nan)

    # Senador tinha 2 vagas: cada eleitor votou duas vezes, então o total do cargo
    # é o dobro do comparecimento e não serve de denominador comum.
    df['QT_VOTOS_TOTAL_LOCAL_CARGO'] = df.groupby(CHAVE_LOCAL + ['CD_CARGO'])['QT_VOTOS'].transform('sum')
    df['PCT_VOTOS_TOTAL'] = np.where(
        df['QT_VOTOS_TOTAL_LOCAL_CARGO'] > 0,
        (df['QT_VOTOS'] / df['QT_VOTOS_TOTAL_LOCAL_CARGO'] * 100).round(4), np.nan)

    df['QT_ABSTENCAO'] = df['QT_APTOS'] - df['QT_COMPARECIMENTO']
    df['PCT_COMPARECIMENTO'] = np.where(
        df['QT_APTOS'] > 0, (df['QT_COMPARECIMENTO'] / df['QT_APTOS'] * 100).round(4), np.nan)
    df['PCT_ABSTENCAO'] = np.where(
        df['QT_APTOS'] > 0, (df['QT_ABSTENCAO'] / df['QT_APTOS'] * 100).round(4), np.nan)

    df['ANO_ELEICAO'] = 2018
    df['NR_TURNO'] = 1
    df['SG_UF'] = 'PI'
    df['DT_ELEICAO'] = pd.to_datetime(df['DT_ELEICAO'], format='%d/%m/%Y').dt.strftime('%Y-%m-%d')
    df['ID_LOCAL'] = df['CD_MUNICIPIO'] + '-' + df['NR_ZONA'] + '-' + df['NR_LOCAL_VOTACAO']
    # 2018 não teve eleição suplementar no PI; a coluna existe para alinhar o
    # esquema com os demais anos.
    df['FL_ELEICAO_SUPLEMENTAR'] = False

    for c in ['CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO', 'CD_CARGO', 'CD_ELEICAO']:
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
    df = df[colunas].sort_values(
        ['CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO', 'CD_CARGO', 'QT_VOTOS'],
        ascending=[True, True, True, True, False],
    )

    assert df['QT_VOTOS'].sum() == vt['QT_VOTOS'].sum(), 'perda de votos na consolidação'
    assert not df.duplicated(subset=['ID_LOCAL', 'CD_CARGO', 'NR_VOTAVEL']).any()
    excesso = df.drop_duplicates('ID_LOCAL').query('QT_COMPARECIMENTO > QT_APTOS')
    if len(excesso):
        print(f'  aviso: {len(excesso)} locais com comparecimento acima dos aptos')

    os.makedirs(SAIDA_DIR, exist_ok=True)
    df.to_csv(SAIDA, index=False, encoding='utf-8', sep=',', decimal='.')
    print(f'gravado: {SAIDA}  ({len(df):,} linhas x {len(df.columns)} colunas)')
    return df


if __name__ == '__main__':
    main()
