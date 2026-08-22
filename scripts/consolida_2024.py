"""
Consolida os dados eleitorais municipais da Bahia de 2024 (TSE) em um único CSV analítico.

Fontes (dados/2024/):
  - votacao_secao_2024_BA.csv        : votos por seção x cargo x votável
  - eleitorado_local_votacao_2024.csv: cadastro de seções/locais (nacional, filtrado para BA)

Saída: dados/processados/eleicoes_ba_2024.csv
Granularidade: eleição x turno x local de votação x cargo x votável.

Diferenças relevantes em relação a 2020 (ver consolida_2020.py):
  - Mesma estrutura de fonte (votacao_secao), não o Boletim de Urna Web que o
    Piauí usou pra 2024 — a Bahia não tinha esse arquivo baixado, então o
    pipeline segue o mesmo formato usado de 2018 a 2022.
  - Eleição ordinária tem dois códigos (CD_ELEICAO), um por turno: 619 (1º
    turno, Vereador e Prefeito, 06/10/2024) e 620 (2º turno, só Prefeito,
    27/10/2024) — ao contrário de 2020, onde os dois turnos de Teresina
    compartilhavam o mesmo CD_ELEICAO. Diferente de 2020 também: a Bahia tem
    vários municípios grandes o bastante pra 2º turno (Salvador entre eles),
    não só a capital.
  - Uma eleição suplementar embutida no arquivo: Ruy Barbosa (06/04/2025,
    CD_ELEICAO 6081), sinalizada por FL_ELEICAO_SUPLEMENTAR e sem dados de
    eleitorado (o cadastro disponível é o de 2024).
"""

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eleitoral import esquema  # noqa: E402

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dados')
BRUTO = os.path.join(BASE, '2024')
SAIDA_DIR = os.path.join(BASE, 'processados')
SAIDA = os.path.join(SAIDA_DIR, 'eleicoes_ba_2024.csv')

CHAVE_SECAO = ['NR_TURNO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO']
CHAVE_LOCAL = ['NR_TURNO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO']

# Os dois turnos da eleição municipal ordinária de 2024 — ao contrário de
# 2020, cada turno tem o seu próprio CD_ELEICAO.
ELEICAO_ORDINARIA = {'619', '620'}

# Partidos que não receberam voto de legenda em nenhum município e por isso não
# aparecem no dicionário extraído dos próprios dados. Preenchido conforme o
# assert de `sem_nome` apontar — vazio até a primeira rodada confirmar.
PARTIDOS_EXTRA = {}


def carrega_votacao():
    df = pd.read_csv(
        os.path.join(BRUTO, 'votacao_secao_2024_BA.csv'),
        sep=';', encoding='latin1', quotechar='"', dtype=str,
        na_values=esquema.NA_TSE,
    )
    df.columns = [c.strip() for c in df.columns]
    df['QT_VOTOS'] = pd.to_numeric(df['QT_VOTOS'])
    return df


def carrega_eleitorado():
    """Lê o arquivo nacional em blocos, mantendo apenas o BA."""
    partes = []
    leitor = pd.read_csv(
        os.path.join(BRUTO, 'eleitorado_local_votacao_2024.csv'),
        sep=';', encoding='latin1', quotechar='"', dtype=str,
        na_values=esquema.NA_TSE, chunksize=200_000,
    )
    for bloco in leitor:
        partes.append(bloco[bloco['SG_UF'] == 'BA'])
    df = pd.concat(partes, ignore_index=True)
    for c in ['QT_ELEITOR_SECAO', 'QT_ELEITOR_ELEICAO_MUNICIPAL']:
        df[c] = pd.to_numeric(df[c])
    return df


def aptos_por_secao(el):
    """Aptos a votar em cada seção principal, por turno.

    QT_ELEITOR_ELEICAO_MUNICIPAL já consolida na seção principal os eleitores das
    seções agregadas e das distribuídas de ofício. O fallback (soma manual) só entra
    caso o campo venha zerado.
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
    pr['QT_APTOS'] = np.where(pr['QT_ELEITOR_ELEICAO_MUNICIPAL'] > 0,
                              pr['QT_ELEITOR_ELEICAO_MUNICIPAL'], fallback)
    pr['FL_APTOS_ESTIMADO'] = pr['QT_ELEITOR_ELEICAO_MUNICIPAL'] == 0
    pr['QT_SECOES_AGREGADAS'] = np.where(pr['QT_VINCULADAS'] > 0, 1, 0)
    return pr


def cadastro_locais(pr):
    """Colapsa as seções principais em uma linha por local de votação e turno."""
    lat = pd.to_numeric(pr['NR_LATITUDE'], errors='coerce')
    lon = pd.to_numeric(pr['NR_LONGITUDE'], errors='coerce')
    valido = lat.between(-19.0, -8.0) & lon.between(-47.0, -37.0)
    pr = pr.assign(LATITUDE=lat.where(valido), LONGITUDE=lon.where(valido))

    vazio = ['-1', '0', '00000000', '000000000']
    pr = pr.assign(
        NR_TELEFONE_LOCAL=pr['NR_TELEFONE_LOCAL'].where(~pr['NR_TELEFONE_LOCAL'].isin(vazio)),
        NR_CEP=pr['NR_CEP'].where(~pr['NR_CEP'].isin(vazio)),
        FL_LOCAL_REMANEJADO=pr['NR_LOCAL_VOTACAO'] != pr['NR_LOCAL_VOTACAO_ORIGINAL'],
    )
    pr = pr.drop(columns=['NR_LOCAL_VOTACAO']).rename(columns={
        'NR_LOCAL_VOTACAO_ORIGINAL': 'NR_LOCAL_VOTACAO',
        'NM_LOCAL_VOTACAO_ORIGINAL': 'NM_LOCAL_VOTACAO_EPOCA',
        'DS_ENDERECO_LOCVT_ORIGINAL': 'DS_ENDERECO_EPOCA',
    })

    prim = lambda s: s.dropna().iloc[0] if s.notna().any() else pd.NA
    moda = lambda s: s.mode().iloc[0] if not s.dropna().empty else pd.NA
    return pr.groupby(CHAVE_LOCAL, as_index=False).agg(
        NM_MUNICIPIO=('NM_MUNICIPIO', 'first'),
        NM_LOCAL_VOTACAO=('NM_LOCAL_VOTACAO_EPOCA', moda),
        DS_TIPO_LOCAL=('DS_TIPO_LOCAL', moda),
        DS_ENDERECO=('DS_ENDERECO_EPOCA', moda),
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
    # 97 é código reservado do TSE pra "voto anulado e apurado em separado"
    # (achado em Salvador/2018) — não é número de partido, mesmo em cargo
    # proporcional.
    if nr_votavel == '97':
        return 'Nulo'
    # Voto de legenda existe só no cargo proporcional. Em Prefeito o número do
    # candidato também tem 2 dígitos, por isso o cargo precisa entrar na regra.
    if cargo == 'Vereador' and len(nr_votavel) == 2:
        return 'Legenda'
    return 'Nominal'


def main():
    print('lendo votação...')
    vt = carrega_votacao()
    print('lendo eleitorado (filtrando BA)...')
    el = carrega_eleitorado()

    pr = aptos_por_secao(el)
    locais = cadastro_locais(pr)

    # Comparecimento por turno: total de votos em Prefeito, que é de voto único.
    comp = (
        vt[vt['DS_CARGO'] == 'Prefeito']
        .groupby(['CD_ELEICAO'] + CHAVE_LOCAL, as_index=False)['QT_VOTOS'].sum()
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
    nominal_ou_legenda = votos['TP_VOTO'].isin(['Nominal', 'Legenda'])
    votos['NR_PARTIDO'] = votos['NR_VOTAVEL'].str[:2].where(nominal_ou_legenda)

    # O nome de cada partido é extraído das próprias linhas de voto de legenda.
    legenda = votos[votos['TP_VOTO'] == 'Legenda'][['NR_VOTAVEL', 'NM_VOTAVEL']].drop_duplicates()
    mapa_partido = dict(zip(legenda['NR_VOTAVEL'], legenda['NM_VOTAVEL']))
    mapa_partido.update(PARTIDOS_EXTRA)
    votos['NM_PARTIDO'] = votos['NR_PARTIDO'].map(mapa_partido)
    sem_nome = votos[votos['NR_PARTIDO'].notna() & votos['NM_PARTIDO'].isna()]['NR_PARTIDO'].unique()
    assert len(sem_nome) == 0, f'partidos sem nome: {sorted(sem_nome)}'

    votos['SQ_CANDIDATO'] = votos['SQ_CANDIDATO'].where(~votos['SQ_CANDIDATO'].isin(['-1', '-3']))

    df = votos.merge(locais, on=CHAVE_LOCAL, how='left', validate='many_to_one')
    df = df.merge(comp, on=['CD_ELEICAO'] + CHAVE_LOCAL, how='left', validate='many_to_one')

    df['FL_ELEICAO_SUPLEMENTAR'] = ~df['CD_ELEICAO'].isin(ELEICAO_ORDINARIA)
    orfaos = df[~df['FL_ELEICAO_SUPLEMENTAR'] & df['NM_LOCAL_VOTACAO'].isna()]
    assert len(orfaos) == 0, f'{len(orfaos)} linhas da eleição ordinária sem cadastro de local'
    # A suplementar de Ruy Barbosa ocorreu em 2025; o cadastro de eleitorado é o
    # de 2024, então seus indicadores de participação não são comparáveis.
    df.loc[df['FL_ELEICAO_SUPLEMENTAR'], ['QT_APTOS', 'QT_COMPARECIMENTO']] = np.nan

    # Denominadores por eleição x local x cargo, para percentuais prontos no dashboard.
    grupo = ['CD_ELEICAO'] + CHAVE_LOCAL + ['CD_CARGO']
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

    df['ANO_ELEICAO'] = 2024
    df['SG_UF'] = 'BA'
    df['DT_ELEICAO'] = pd.to_datetime(df['DT_ELEICAO'], format='%d/%m/%Y').dt.strftime('%Y-%m-%d')
    df['ID_LOCAL'] = df['CD_MUNICIPIO'] + '-' + df['NR_ZONA'] + '-' + df['NR_LOCAL_VOTACAO']

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
    df = df[colunas].sort_values(
        ['CD_ELEICAO', 'NR_TURNO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO', 'CD_CARGO', 'QT_VOTOS'],
        ascending=[True, True, True, True, True, True, False],
    )

    assert df['QT_VOTOS'].sum() == vt['QT_VOTOS'].sum(), 'perda de votos na consolidação'
    assert not df.duplicated(subset=['CD_ELEICAO', 'NR_TURNO', 'ID_LOCAL', 'CD_CARGO', 'NR_VOTAVEL']).any()
    locais_unicos = df.drop_duplicates(['CD_ELEICAO', 'NR_TURNO', 'ID_LOCAL'])
    excesso = locais_unicos[locais_unicos['QT_COMPARECIMENTO'] > locais_unicos['QT_APTOS']]
    if len(excesso):
        print(f'  aviso: {len(excesso)} locais com comparecimento acima dos aptos')

    os.makedirs(SAIDA_DIR, exist_ok=True)
    df.to_csv(SAIDA, index=False, encoding='utf-8', sep=',', decimal='.')
    print(f'gravado: {SAIDA}  ({len(df):,} linhas x {len(df.columns)} colunas)')
    return df


if __name__ == '__main__':
    main()
