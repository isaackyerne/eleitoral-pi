"""Provas de que a unificação não perdeu voto nem fundiu entidade em silêncio.

Falha é fatal, na mesma convenção dos `consolida_<ano>.py`.
"""

import pandas as pd

from . import esquema, partidos

# Totais conferidos contra os arquivos brutos do TSE em cada ano.
# 2018, 2022 e 2026 incluem Presidente (1º turno), que vem do arquivo nacional do TSE:
# 1.997.932, 2.115.645 e 2.240.883 votos. É um pouco mais que o Governador do mesmo
# estado porque o voto em trânsito deixa eleitor de outra UF votar para Presidente
# numa seção daqui. Os valores sem Presidente eram 9.987.935, 8.456.024 e 11.196.930.
# O 2º turno de Presidente (só o Piauí) soma 1.946.971 votos em 2018 e 2.088.530 em 2022;
# os totais abaixo já o incluem.
VOTOS_POR_ANO = {
    2018: 13_932_838, 2020: 4_593_905, 2022: 12_660_199, 2024: 4_599_674,
    # 2026 sem Presidente = 2.239.386 votantes x 5 votos (Governador, Dep. Federal,
    # Dep. Estadual e 2 de Senador); conferido contra o arquivo de votação por
    # seção, 1º turno. Com Presidente: + 2.240.883.
    2026: 13_437_813,
}
TOTAL_VOTOS = sum(VOTOS_POR_ANO.values())
# 1.421.107 linhas dos 6 cargos + 82.471 de Presidente no 1º turno (33.169 + 24.698 +
# 24.604) + 26.157 no 2º turno (13.215 em 2018 e 12.942 em 2022).
TOTAL_LINHAS = 1_529_735

# Resultados oficiais, em % dos votos válidos na definição legal — que exclui
# votos em candidato com registro indeferido. Em 2022 três candidatos a
# governador estavam inaptos e somaram 30.721 votos: usar o denominador de
# nominais dá 56,72% para Fonteles, contra os 57,62% publicados.
OFICIAIS = [
    (2018, 1, 'Governador', None, 'JOSE WELLINGTON BARROSO DE ARAUJO DIAS', 55.65),
    (2020, 2, 'Prefeito', 12190, 'JOSE PESSOA LEAL', 62.31),
    (2022, 1, 'Governador', None, 'RAFAEL TAJRA FONTELES', 57.62),
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
    # 2026: PMB virou Democrata (mesmo número, decisão do TSE de dez/2025) e o TSE
    # passou a grafar PCDOB — ambos têm de continuar uma entidade só. Já o número 14
    # trocou de dono: era do PTB e hoje é do Missão, partido novo.
    assert sk(2024, 35) == sk(2026, 35), 'PMB e Democrata separados'
    assert sk(2024, 65) == sk(2026, 65), 'PC do B e PCDOB separados'
    assert sk(2022, 14) != sk(2026, 14), 'PTB e Missão fundidos no número 14'


def _sem_fusao_votavel(t):
    dv = t['dim_votavel']
    assert dv['SK_VOTAVEL'].is_unique
    reais = dv[dv['SK_VOTAVEL'] > 0]
    assert reais.groupby('SK_VOTAVEL')['SK_ELEICAO'].nunique().max() == 1, \
        'votável atravessando eleição'
    # Um político não pode aparecer duas vezes na mesma disputa.
    comp = reais[reais['SK_POLITICO'].notna()]
    dup = comp.groupby(['SK_POLITICO', 'SK_ELEICAO', 'CD_MUNICIPIO_UE', 'CD_CARGO']).size()
    if not (dup <= 1).all():
        chaves = dup[dup > 1].index
        quem = comp.set_index(['SK_POLITICO', 'SK_ELEICAO', 'CD_MUNICIPIO_UE', 'CD_CARGO']).loc[chaves]
        cols = [c for c in ['SK_VOTAVEL', 'NR_VOTAVEL', 'NM_VOTAVEL', 'SQ_CANDIDATO', 'TP_VOTO'] if c in quem.columns]
        raise AssertionError(
            f'{len(chaves)} políticos repetidos na mesma disputa:\n{quem[cols].to_string()}')


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

    # Senador com 2 vagas (2018 e 2026): o total é o dobro, e QT_VOTOS_NORM corrige.
    sen = dec[(dec['DS_CARGO'] == 'Senador') & (dec['QT_VOTOS_POR_ELEITOR'] == 2)]
    for _, s in sen.iterrows():
        sk_e, cd = int(s['SK_ELEICAO']), int(s['CD_CARGO'])
        m = fv[(fv['SK_ELEICAO'] == sk_e) & (fv['CD_CARGO'] == cd)]
        comp = fl[fl['SK_ELEICAO'] == sk_e]['QT_COMPARECIMENTO'].sum()
        assert int(m['QT_VOTOS'].sum()) == 2 * int(comp), f'Senador (eleição {sk_e}) não é 2x o comparecimento'
        assert abs(m['QT_VOTOS_NORM'].sum() - comp) < 1, f'QT_VOTOS_NORM não normaliza Senador (eleição {sk_e})'


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
        # Candidato com registro indeferido não compõe os votos válidos.
        escopo = escopo[~escopo['FL_CANDIDATURA_APTA'].eq(False).fillna(False)]
        votos = fv[fv['SK_VOTAVEL'].isin(escopo['SK_VOTAVEL'])]
        validos = votos['QT_VOTOS'].sum()
        dele = votos[votos['SK_VOTAVEL'] == int(alvo['SK_VOTAVEL'].iloc[0])]['QT_VOTOS'].sum()
        obtido = round(dele / validos * 100, 2)
        assert abs(obtido - pct) < 0.02, f'{nome} ({ano}): {obtido}% != oficial {pct}%'


def _prefeituras(t):
    """Prefeituras por sigla canônica — pega uma fusão PSC/Podemos na hora.

    Conta um prefeito por município e ano, em qualquer turno: Teresina foi ao 2º
    turno em 2020, então o vencedor de lá não aparece entre os eleitos do 1º.
    Entram também as suplementares, que prevalecem sobre a ordinária — em São
    Lourenço do Piauí (2020) o eleito da ordinária teve o registro anulado e o
    prefeito é o da suplementar; em Muricí dos Portelas a mais votada da ordinária
    foi anulada e a prefeita saiu da suplementar.
    """
    de, dv, dp = t['dim_eleicao'], t['dim_votavel'], t['dim_partido']
    sigla = dp.set_index('SK_PARTIDO')['SG_PARTIDO']
    for ano, esperado in PREFEITURAS.items():
        sks = set(de[de['ANO_ELEICAO'] == ano]['SK_ELEICAO'])
        eleitos = dv[dv['SK_ELEICAO'].isin(sks).fillna(False)
                     & dv['DS_CARGO'].eq('Prefeito').fillna(False)
                     & dv['FL_ELEITO'].fillna(False).astype(bool)]
        eleitos = eleitos.sort_values('SK_ELEICAO').drop_duplicates('CD_MUNICIPIO_UE', keep='last')
        contagem = eleitos['SK_PARTIDO'].map(sigla).value_counts()
        for sg, qt in esperado.items():
            assert int(contagem.get(sg, 0)) == qt, \
                f'{ano}: {sg} com {int(contagem.get(sg, 0))} prefeituras, esperado {qt}'


def _contra_oficial(t):
    """Confere a base contra os agregados publicados pelo TSE.

    Aptos, comparecimento e votos por cargo têm de bater exatamente. O total de
    votos válidos é derivado (o TSE não publica a anulação por local), então
    aceita-se um resíduo pequeno, travado aqui para que qualquer piora falhe.
    """
    if 'fato_oficial_munzona' not in t:
        return
    o = t['fato_oficial_munzona']
    fl, flc = t['fato_local'], t['fato_local_cargo']

    por_eleicao = o.drop_duplicates(['SK_ELEICAO', 'CD_MUNICIPIO', 'NR_ZONA', 'CD_CARGO'])
    um_cargo = por_eleicao.sort_values('CD_CARGO').drop_duplicates(
        ['SK_ELEICAO', 'CD_MUNICIPIO', 'NR_ZONA'])
    ofi = um_cargo.groupby('SK_ELEICAO')[['QT_APTOS', 'QT_COMPARECIMENTO']].sum()
    base = fl.groupby('SK_ELEICAO')[['QT_APTOS', 'QT_COMPARECIMENTO']].sum()
    # Suplementares ficam de fora: o cadastro de eleitorado disponível é o de
    # 2020 e não o da data em que ocorreram, então a base não tem seus aptos.
    ordinarias = set(t['dim_eleicao'].loc[~t['dim_eleicao']['FL_SUPLEMENTAR'], 'SK_ELEICAO'])
    for sk in [x for x in ofi.index.intersection(base.index) if x in ordinarias]:
        dif = abs(int(base.loc[sk, 'QT_COMPARECIMENTO']) - int(ofi.loc[sk, 'QT_COMPARECIMENTO']))
        assert dif == 0, f'eleição {sk}: comparecimento difere do TSE em {dif}'

    # Válidos: resíduo tolerado, por cargo, em pontos-base do total.
    ov = o.groupby(['SK_ELEICAO', 'CD_CARGO'])['QT_VOTOS_VALIDOS'].sum()
    bv = flc.groupby(['SK_ELEICAO', 'CD_CARGO'])['QT_VOTOS_VALIDOS_OFICIAL'].sum()
    for k in ov.index.intersection(bv.index):
        tse, base_v = int(ov[k]), int(bv[k])
        erro = abs(base_v - tse) / max(tse, 1)
        assert erro <= 0.004, \
            f'eleição {k[0]} cargo {k[1]}: válidos divergem {erro*100:.2f}% do TSE ({base_v:,} x {tse:,})'


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
    _contra_oficial(t)
    print('  todas as verificações passaram')
