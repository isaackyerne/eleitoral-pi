"""
Consolida os dados eleitorais municipais do Piauí de 2024 (TSE) em um único CSV analítico.

Fontes (dados/2024/):
  - bweb_1t_PI_091020241636.csv      : Boletim de Urna Web, 1º turno
  - eleitorado_local_votacao_2024.csv: cadastro de seções/locais (nacional, filtrado para PI)

Saída: dados/processados/eleicoes_pi_2024.csv
Granularidade: local de votação x cargo x votável.

O arquivo de votação de 2024 é o Boletim de Urna Web, formato diferente do
votacao_secao usado de 2018 a 2022, e bem mais completo:
  - QT_APTOS, QT_COMPARECIMENTO e QT_ABSTENCOES vêm prontos por seção, não
    precisam ser derivados do cadastro de eleitorado (e conferem com ele em
    todas as 9.233 seções);
  - NR_PARTIDO, SG_PARTIDO e NM_PARTIDO são nativos, dispensando a derivação
    pelo prefixo do número do votável;
  - DS_TIPO_VOTAVEL já classifica Nominal / Legenda / Branco / Nulo.
Em contrapartida, não traz SQ_CANDIDATO, e NM_VOTAVEL é o nome de urna do
candidato, não o nome completo dos anos anteriores.

Só há 1º turno: Teresina é o único município do estado acima de 200 mil eleitores
e Sílvio Mendes venceu ali com 52,19% dos votos válidos, sem 2º turno.
"""

import os
import numpy as np
import pandas as pd

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dados')
BRUTO = os.path.join(BASE, '2024')
SAIDA_DIR = os.path.join(BASE, 'processados')
SAIDA = os.path.join(SAIDA_DIR, 'eleicoes_pi_2024.csv')

ARQ_BU = 'bweb_1t_PI_091020241636.csv'

CHAVE_SECAO = ['NR_TURNO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO']
CHAVE_LOCAL = ['NR_TURNO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO']


def carrega_votacao():
    df = pd.read_csv(
        os.path.join(BRUTO, ARQ_BU),
        sep=';', encoding='latin1', quotechar='"', dtype=str,
        na_values=['#NULO#', '#NE#'],
    )
    df.columns = [c.strip() for c in df.columns]
    for c in ['QT_VOTOS', 'QT_APTOS', 'QT_COMPARECIMENTO', 'QT_ABSTENCOES',
              'QT_ELEI_BIOM_SEM_HABILITACAO']:
        df[c] = pd.to_numeric(df[c], errors='coerce')
    df = df.rename(columns={
        'CD_CARGO_PERGUNTA': 'CD_CARGO',
        'DS_CARGO_PERGUNTA': 'DS_CARGO',
        'DS_TIPO_VOTAVEL': 'TP_VOTO',
    })
    # No BU Web o partido de voto branco/nulo vem como -1.
    df['NR_PARTIDO'] = df['NR_PARTIDO'].where(df['NR_PARTIDO'] != '-1')
    return df


def carrega_eleitorado():
    """Lê o arquivo nacional em blocos, mantendo apenas o PI."""
    partes = []
    leitor = pd.read_csv(
        os.path.join(BRUTO, 'eleitorado_local_votacao_2024.csv'),
        sep=';', encoding='latin1', quotechar='"', dtype=str,
        na_values=['#NULO#', '#NE#'], chunksize=200_000,
    )
    for bloco in leitor:
        bloco.columns = [c.strip() for c in bloco.columns]
        partes.append(bloco[bloco['SG_UF'] == 'PI'])
    df = pd.concat(partes, ignore_index=True)
    df['QT_ELEITOR_SECAO'] = pd.to_numeric(df['QT_ELEITOR_SECAO'])
    return df


def cadastro_locais(el):
    """Uma linha por local de votação, a partir das seções principais do cadastro.

    Diferente dos outros anos, os aptos NÃO saem daqui: o Boletim de Urna já os
    fornece. O cadastro entra apenas pelos atributos do local (nome, endereço,
    coordenadas, acessibilidade).

    Como em 2018 e 2020, NR_LOCAL_VOTACAO traz o local ATUAL da seção e
    NR_LOCAL_VOTACAO_ORIGINAL o local vigente na eleição — este último é o que casa
    com o boletim (9.233/9.233 seções, contra 8.952 pelo campo atual).
    """
    vinculadas = el[el['DS_TIPO_SECAO_AGREGADA'] != 'Principal']
    soma = (
        vinculadas.groupby(['NR_TURNO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO_PRINCIPAL'])['QT_ELEITOR_SECAO']
        .sum().rename('QT_VINCULADAS').reset_index()
        .rename(columns={'NR_SECAO_PRINCIPAL': 'NR_SECAO'})
    )
    pr = el[el['DS_TIPO_SECAO_AGREGADA'] == 'Principal'].copy()
    pr = pr.merge(soma, on=CHAVE_SECAO, how='left')
    pr['QT_SECOES_AGREGADAS'] = np.where(pr['QT_VINCULADAS'].fillna(0) > 0, 1, 0)

    lat = pd.to_numeric(pr['NR_LATITUDE'], errors='coerce')
    lon = pd.to_numeric(pr['NR_LONGITUDE'], errors='coerce')
    valido = lat.between(-11.5, -2.5) & lon.between(-46.5, -40.0)
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
        QT_SECOES_ACESSIVEIS=('DS_SITU_SECAO_ACESSIBILIDADE',
                              lambda s: (s == 'Com acessibilidade').sum()),
        QT_SECOES_AGREGADAS=('QT_SECOES_AGREGADAS', 'sum'),
        FL_LOCAL_REMANEJADO=('FL_LOCAL_REMANEJADO', 'any'),
    )


def participacao_por_local(vt):
    """Aptos, comparecimento e abstenções por local, somados a partir das seções.

    No boletim esses três valores se repetem em cada linha da seção (uma por
    votável e por cargo), então é preciso reduzir a uma linha por seção antes de
    somar.
    """
    sec = vt.drop_duplicates(CHAVE_SECAO)
    return sec.groupby(CHAVE_LOCAL, as_index=False).agg(
        QT_SECOES=('NR_SECAO', 'nunique'),
        QT_APTOS=('QT_APTOS', 'sum'),
        QT_COMPARECIMENTO=('QT_COMPARECIMENTO', 'sum'),
        QT_ABSTENCAO=('QT_ABSTENCOES', 'sum'),
        QT_ELEITOR_BIOM_SEM_HABILITACAO=('QT_ELEI_BIOM_SEM_HABILITACAO', 'sum'),
    )


def main():
    print('lendo boletim de urna...')
    vt = carrega_votacao()
    print('lendo eleitorado (filtrando PI)...')
    el = carrega_eleitorado()

    locais = cadastro_locais(el)
    participacao = participacao_por_local(vt)

    print('agregando votos por local...')
    votos = vt.groupby(
        ['CD_ELEICAO', 'DS_ELEICAO', 'NM_TIPO_ELEICAO', 'DT_PLEITO'] + CHAVE_LOCAL
        + ['CD_CARGO', 'DS_CARGO', 'TP_VOTO', 'NR_VOTAVEL', 'NM_VOTAVEL',
           'NR_PARTIDO', 'SG_PARTIDO', 'NM_PARTIDO'],
        as_index=False, dropna=False,
    )['QT_VOTOS'].sum()

    df = votos.merge(locais, on=CHAVE_LOCAL, how='left', validate='many_to_one')
    faltando = df['NM_LOCAL_VOTACAO'].isna().sum()
    assert faltando == 0, f'{faltando} linhas de voto sem cadastro de local'
    df = df.merge(participacao, on=CHAVE_LOCAL, how='left', validate='many_to_one')

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

    df['PCT_COMPARECIMENTO'] = np.where(
        df['QT_APTOS'] > 0, (df['QT_COMPARECIMENTO'] / df['QT_APTOS'] * 100).round(4), np.nan)
    df['PCT_ABSTENCAO'] = np.where(
        df['QT_APTOS'] > 0, (df['QT_ABSTENCAO'] / df['QT_APTOS'] * 100).round(4), np.nan)

    df['ANO_ELEICAO'] = 2024
    df['SG_UF'] = 'PI'
    df['DT_ELEICAO'] = pd.to_datetime(df['DT_PLEITO']).dt.strftime('%Y-%m-%d')
    df['ID_LOCAL'] = df['CD_MUNICIPIO'] + '-' + df['NR_ZONA'] + '-' + df['NR_LOCAL_VOTACAO']
    # O boletim de urna não publica SQ_CANDIDATO; a coluna existe para manter o
    # mesmo esquema dos demais anos.
    df['SQ_CANDIDATO'] = pd.NA
    df['FL_ELEICAO_SUPLEMENTAR'] = False
    # Os aptos vêm medidos pela urna, nunca estimados.
    df['FL_APTOS_ESTIMADO'] = False

    for c in ['CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO', 'CD_CARGO', 'NR_TURNO', 'CD_ELEICAO']:
        df[c] = df[c].astype('int64')
    for c in ['QT_SECOES', 'QT_SECOES_AGREGADAS', 'QT_SECOES_ACESSIVEIS', 'QT_APTOS',
              'QT_COMPARECIMENTO', 'QT_ABSTENCAO', 'QT_ELEITOR_BIOM_SEM_HABILITACAO']:
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
        'NR_VOTAVEL', 'NM_VOTAVEL', 'SQ_CANDIDATO', 'NR_PARTIDO', 'SG_PARTIDO', 'NM_PARTIDO',
        'QT_VOTOS', 'QT_VOTOS_VALIDOS_LOCAL_CARGO', 'QT_VOTOS_TOTAL_LOCAL_CARGO',
        'PCT_VOTOS_VALIDOS', 'PCT_VOTOS_TOTAL',
        'QT_APTOS', 'QT_COMPARECIMENTO', 'QT_ABSTENCAO',
        'PCT_COMPARECIMENTO', 'PCT_ABSTENCAO', 'QT_ELEITOR_BIOM_SEM_HABILITACAO',
        'FL_APTOS_ESTIMADO', 'FL_LOCAL_REMANEJADO', 'FL_ELEICAO_SUPLEMENTAR',
    ]
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

    os.makedirs(SAIDA_DIR, exist_ok=True)
    df.to_csv(SAIDA, index=False, encoding='utf-8', sep=',', decimal='.')
    print(f'gravado: {SAIDA}  ({len(df):,} linhas x {len(df.columns)} colunas)')
    return df


if __name__ == '__main__':
    main()
