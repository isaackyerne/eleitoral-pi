"""Provas de que a unificação não perdeu voto nem fundiu entidade em silêncio.

Falha é fatal, na mesma convenção dos `consolida_<ano>.py`.
"""

import pandas as pd

from . import esquema, partidos

# Totais conferidos contra os arquivos brutos do TSE em cada ano.
VOTOS_POR_ANO = {2018: 9_987_935, 2020: 4_593_905, 2022: 8_456_024, 2024: 4_599_674}
TOTAL_VOTOS = sum(VOTOS_POR_ANO.values())
TOTAL_LINHAS = 1_093_619

# Resultados oficiais, em % dos votos válidos do respectivo recorte.
OFICIAIS = [
    (2018, 1, 'Governador', None, 'JOSE WELLINGTON BARROSO DE ARAUJO DIAS', 55.65),
    (2020, 2, 'Prefeito', 12190, 'JOSE PESSOA LEAL', 62.31),
    (2022, 1, 'Governador', None, 'RAFAEL TAJRA FONTELES', 56.72),
    (2024, 1, 'Prefeito', 12190, 'SILVIO MENDES DE OLIVEIRA FILHO', 52.19),
]

# Prefeituras conquistadas por partido, pela sigla canônica. Vêm do campo
# oficial DS_SIT_TOT_TURNO do TSE, não de "quem teve mais voto": em Teresina
# 2020 o vencedor só foi definido no 2º turno, e há municípios em que o mais
# votado não tomou posse.
PREFEITURAS = {
    2020: {'PP': 83, 'PSD': 40, 'MDB': 36, 'PT': 23},
    2024: {'PSD': 65, 'MDB': 57, 'PT': 50, 'PP': 34},
}


def _conservacao(t, bronze):
    fv = t['fato_votos']
    assert len(fv) == TOTAL_LINHAS, f'fato_votos tem {len(fv):,}, esperado {TOTAL_LINHAS:,}'
    assert int(fv['QT_VOTOS'].sum()) == TOTAL_VOTOS, 'total de votos divergente'

    ano = t['dim_eleicao'].set_index('SK_ELEICAO')['ANO_ELEICAO']
    por_ano = fv.assign(ANO=fv['SK_ELEICAO'].map(ano)).groupby('ANO')['QT_VOTOS'].sum()
    for a, esperado in VOTOS_POR_ANO.items():
        assert int(por_ano[a]) == esperado, f'{a}: {int(por_ano[a]):,} != {esperado:,}'

    # Nenhuma chave estrangeira nula — é assim que fan-out duplica voto sem avisar.
    for col in ['SK_ELEICAO', 'SK_LOCAL', 'SK_VOTAVEL', 'CD_CARGO']:
        assert fv[col].notna().all(), f'fato_votos.{col} com nulo'


def _sem_fusao_local(t):
    dl = t['dim_local']
    assert not dl.duplicated(subset=['SK_LOCAL', 'SK_ELEICAO']).any(), \
        'dim_local com (SK_LOCAL, SK_ELEICAO) repetido'
    assert dl.groupby('SK_LOCAL')['CD_MUNICIPIO'].nunique().max() == 1, \
        'SK_LOCAL atravessando município'
    # O que a chave antiga não conseguia: um local por ano dentro de cada SK.
    por_ano = dl.drop_duplicates(['SK_LOCAL', 'ANO_ELEICAO', 'NR_ZONA', 'NR_LOCAL_VOTACAO'])
    dup = por_ano.groupby(['SK_LOCAL', 'ANO_ELEICAO']).size()
    assert (dup <= 1).all(), f'{int((dup > 1).sum())} SK_LOCAL com dois locais no mesmo ano'


def _sem_fusao_partido(t):
    dpa = t['dim_partido_ano']
    assert dpa.groupby(['ANO_ELEICAO', 'NR_PARTIDO'])['SK_PARTIDO'].nunique().max() == 1
    assert t['dim_partido'].groupby('SK_PARTIDO')['SG_PARTIDO'].nunique().max() == 1

    sk = lambda a, n: partidos.sk_de(dpa, a, n)  # noqa: E731
    # Números que trocaram de dono — agrupar por número os fundiria.
    assert sk(2022, 20) != sk(2024, 20), 'PSC e Podemos fundidos no número 20'
    assert sk(2018, 44) != sk(2022, 44), 'PRP e União Brasil fundidos no número 44'
    assert sk(2018, 25) != sk(2024, 25), 'DEM e PRD fundidos no número 25'
    # E o inverso: o Podemos migrou de número e precisa continuar sendo um só.
    assert sk(2022, 19) == sk(2024, 20), 'Podemos partido em dois pelo número'
    # Renomeações não podem virar entidades diferentes.
    assert sk(2018, 10) == sk(2024, 10), 'PRB/Republicanos separados'
    assert sk(2018, 22) == sk(2024, 22), 'PR/PL separados'
    assert sk(2018, 36) == sk(2024, 36), 'PTC/AGIR separados'


def _sem_fusao_votavel(t):
    dv = t['dim_votavel']
    assert dv['SK_VOTAVEL'].is_unique
    reais = dv[dv['SK_VOTAVEL'] > 0]
    assert reais.groupby('SK_VOTAVEL')['SK_ELEICAO'].nunique().max() == 1, \
        'votável atravessando eleição'
    # Um político não pode aparecer duas vezes na mesma disputa.
    comp = reais[reais['SK_POLITICO'].notna()]
    dup = comp.groupby(['SK_POLITICO', 'SK_ELEICAO', 'CD_MUNICIPIO_UE', 'CD_CARGO']).size()
    assert (dup <= 1).all(), f'{int((dup > 1).sum())} políticos repetidos na mesma disputa'


def _coerencia(t):
    fl = t['fato_local']
    tem = fl['QT_APTOS'].notna()
    soma = fl.loc[tem, 'QT_COMPARECIMENTO'] + fl.loc[tem, 'QT_ABSTENCAO']
    assert (fl.loc[tem, 'QT_APTOS'] == soma).all(), 'aptos != comparecimento + abstenção'
    assert (fl.loc[tem, 'QT_COMPARECIMENTO'] <= fl.loc[tem, 'QT_APTOS']).all(), \
        'comparecimento acima dos aptos'

    # As únicas linhas sem eleitorado são as suplementares de 2020, cujo
    # cadastro é o de 2020 e não o da data em que ocorreram.
    supl = t['dim_eleicao'].set_index('SK_ELEICAO')['FL_SUPLEMENTAR']
    sem = fl[fl['QT_APTOS'].isna()]
    assert sem['SK_ELEICAO'].map(supl).all(), 'eleição ordinária sem eleitorado'

    flc = t['fato_local_cargo']
    assert (flc['QT_VOTOS_TOTAL'] == flc['QT_VOTOS_VALIDOS'] + flc['QT_VOTOS_BRANCO']
            + flc['QT_VOTOS_NULO']).all(), 'total != válidos + branco + nulo'

    # O fato agregado tem de bater com a soma do fato detalhado.
    conf = (t['fato_votos'].groupby(['SK_ELEICAO', 'SK_LOCAL', 'CD_CARGO'])['QT_VOTOS'].sum()
            .rename('detalhe').reset_index()
            .merge(flc[['SK_ELEICAO', 'SK_LOCAL', 'CD_CARGO', 'QT_VOTOS_TOTAL']],
                   on=['SK_ELEICAO', 'SK_LOCAL', 'CD_CARGO']))
    assert (conf['detalhe'] == conf['QT_VOTOS_TOTAL']).all(), \
        'fato_local_cargo não fecha com fato_votos'


def _comparecimento(t):
    """Votos do cargo de voto único têm de igualar o comparecimento."""
    de, dec = t['dim_eleicao'], t['dim_eleicao_cargo']
    fv, fl = t['fato_votos'], t['fato_local']
    for _, e in de[~de['FL_SUPLEMENTAR']].iterrows():
        cargo = esquema.CARGO_COMPARECIMENTO[e['TP_ESFERA']]
        alvo = dec[(dec['SK_ELEICAO'] == e['SK_ELEICAO']) & (dec['DS_CARGO'] == cargo)]
        if not len(alvo):
            continue
        cd = int(alvo['CD_CARGO'].iloc[0])
        votos = fv[(fv['SK_ELEICAO'] == e['SK_ELEICAO']) & (fv['CD_CARGO'] == cd)]['QT_VOTOS'].sum()
        comp = fl[fl['SK_ELEICAO'] == e['SK_ELEICAO']]['QT_COMPARECIMENTO'].sum()
        assert int(votos) == int(comp), \
            f'eleição {e["SK_ELEICAO"]}: votos em {cargo} ({votos:,}) != comparecimento ({comp:,})'

    # Senador 2018 teve 2 vagas: o total é o dobro, e QT_VOTOS_NORM corrige.
    sen = dec[(dec['DS_CARGO'] == 'Senador') & (dec['QT_VOTOS_POR_ELEITOR'] == 2)]
    if len(sen):
        sk_e = int(sen['SK_ELEICAO'].iloc[0])
        cd = int(sen['CD_CARGO'].iloc[0])
        m = fv[(fv['SK_ELEICAO'] == sk_e) & (fv['CD_CARGO'] == cd)]
        comp = fl[fl['SK_ELEICAO'] == sk_e]['QT_COMPARECIMENTO'].sum()
        assert int(m['QT_VOTOS'].sum()) == 2 * int(comp), 'Senador 2018 não é 2x o comparecimento'
        assert abs(m['QT_VOTOS_NORM'].sum() - comp) < 1, 'QT_VOTOS_NORM não normaliza Senador 2018'


def _regressao_oficial(t):
    """Os resultados publicados pelo TSE têm de sair da base."""
    de, dv, fv = t['dim_eleicao'], t['dim_votavel'], t['fato_votos']
    for ano, turno, cargo, municipio, nome, pct in OFICIAIS:
        e = de[(de['ANO_ELEICAO'] == ano) & (de['NR_TURNO'] == turno) & (~de['FL_SUPLEMENTAR'])]
        sk_e = int(e['SK_ELEICAO'].iloc[0])
        alvo = dv[dv['SK_ELEICAO'].eq(sk_e).fillna(False)
                  & dv['NM_VOTAVEL_CHAVE'].eq(nome).fillna(False)]
        assert len(alvo) == 1, f'{nome} ({ano}) não encontrado ou ambíguo: {len(alvo)}'
        cd_cargo = int(alvo['CD_CARGO'].iloc[0])

        escopo = dv[dv['SK_ELEICAO'].eq(sk_e).fillna(False)
                    & dv['CD_CARGO'].eq(cd_cargo).fillna(False)
                    & dv['TP_VOTO'].eq('Nominal').fillna(False)]
        if municipio is not None:
            escopo = escopo[escopo['CD_MUNICIPIO_UE'].eq(municipio).fillna(False)]
        votos = fv[fv['SK_VOTAVEL'].isin(escopo['SK_VOTAVEL'])]
        validos = votos['QT_VOTOS'].sum()
        dele = votos[votos['SK_VOTAVEL'] == int(alvo['SK_VOTAVEL'].iloc[0])]['QT_VOTOS'].sum()
        obtido = round(dele / validos * 100, 2)
        assert abs(obtido - pct) < 0.02, f'{nome} ({ano}): {obtido}% != oficial {pct}%'


def _prefeituras(t):
    """Prefeituras por sigla canônica — pega uma fusão PSC/Podemos na hora.

    Conta o eleito em qualquer turno da eleição ordinária: Teresina foi ao 2º
    turno em 2020, então o vencedor de lá não aparece entre os eleitos do 1º.
    """
    de, dv, dp = t['dim_eleicao'], t['dim_votavel'], t['dim_partido']
    sigla = dp.set_index('SK_PARTIDO')['SG_PARTIDO']
    for ano, esperado in PREFEITURAS.items():
        sks = set(de[(de['ANO_ELEICAO'] == ano) & (~de['FL_SUPLEMENTAR'])]['SK_ELEICAO'])
        eleitos = dv[dv['SK_ELEICAO'].isin(sks).fillna(False)
                     & dv['DS_CARGO'].eq('Prefeito').fillna(False)
                     & dv['FL_ELEITO'].fillna(False).astype(bool)]
        contagem = eleitos['SK_PARTIDO'].map(sigla).value_counts()
        for sg, qt in esperado.items():
            assert int(contagem.get(sg, 0)) == qt, \
                f'{ano}: {sg} com {int(contagem.get(sg, 0))} prefeituras, esperado {qt}'


def rodar(tabelas, bronze):
    t = dict(tabelas)
    # DS_CARGO ajuda os testes; vem de dim_eleicao_cargo.
    cargo = t['dim_eleicao_cargo'].drop_duplicates(['CD_CARGO'])[['CD_CARGO', 'DS_CARGO']]
    t['dim_votavel'] = t['dim_votavel'].merge(cargo, on='CD_CARGO', how='left')

    _conservacao(t, bronze)
    _sem_fusao_local(t)
    _sem_fusao_partido(t)
    _sem_fusao_votavel(t)
    _coerencia(t)
    _comparecimento(t)
    _regressao_oficial(t)
    _prefeituras(t)
    print('  todas as verificações passaram')
