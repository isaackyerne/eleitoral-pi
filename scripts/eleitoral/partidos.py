"""Dimensão de partidos, resolvida por entidade jurídica.

O número do partido **não** identifica um partido ao longo do tempo: 20 era PSC
até 2022 e virou Podemos em 2024; 25 era DEM e virou PRD; 44 era PRP e virou
União Brasil. Agrupar por `NR_PARTIDO` funde partidos diferentes em silêncio.

A identidade estável é a **sigla canônica** — obtida aplicando o mapa de
renomeações de `referencia/partidos_pi.csv` sobre a sigla oficial que o
`consulta_cand` traz para cada ano. O crosswalk (ano, número) → SK_PARTIDO cai
fora disso automaticamente.
"""

import os

import pandas as pd

from . import esquema


def _sigla_oficial_por_ano():
    """Matriz (ano, número) → sigla, tirada dos arquivos de candidatura do TSE.

    Essa é a fonte certa: o `consulta_cand` publica NR/SG/NM do partido de cada
    candidato. Antes o nome era raspado das linhas de voto de legenda, o que
    deixava de fora partidos sem legenda e trazia divergência de caixa.
    """
    partes = []
    for ano in esquema.ANOS:
        caminho = os.path.join(esquema.DIR_BRUTOS_TSE, f'consulta_cand_{ano}_PI.csv')
        c = pd.read_csv(caminho, sep=';', encoding='latin1', dtype=str,
                        quotechar='"', na_values=esquema.NA_TSE,
                        usecols=['NR_PARTIDO', 'SG_PARTIDO', 'NM_PARTIDO'])
        c = c.drop_duplicates()
        c['ANO_ELEICAO'] = ano
        partes.append(c)
    m = pd.concat(partes, ignore_index=True)
    conflito = m.groupby(['ANO_ELEICAO', 'NR_PARTIDO'])['SG_PARTIDO'].nunique()
    assert (conflito <= 1).all(), 'mesma (ano, número) com duas siglas no consulta_cand'
    return m


def _mapa_canonico(ref):
    """sigla histórica → sigla canônica, a partir de SG_ANTERIORES."""
    mapa = {}
    for _, r in ref.iterrows():
        mapa[r['SG_PARTIDO']] = r['SG_PARTIDO']
        if isinstance(r['SG_ANTERIORES'], str) and r['SG_ANTERIORES'].strip():
            for antiga in r['SG_ANTERIORES'].split(';'):
                mapa[antiga.strip()] = r['SG_PARTIDO']
    return mapa


def _completa_sem_candidato(observado, vistos, ref):
    """Acrescenta (ano, número) que recebeu voto mas não tem candidatura.

    Um partido pode não lançar candidato num ano e ainda assim receber voto de
    legenda — foi o caso do PSDB no Piauí em 2022, com 1.033 votos para Deputado
    Federal. Como ele não aparece no `consulta_cand` daquele ano, o número
    ficaria sem partido e o votável sem nome.

    A resolução usa o mesmo número nos demais anos, e só é aceita quando aponta
    para uma entidade única — se o número tiver trocado de dono no período, é
    ambíguo e o assert derruba a execução em vez de chutar.
    """
    faltando = sorted(set(vistos) - set(map(tuple, observado[['ANO_ELEICAO', 'NR_PARTIDO']].values)))
    if not faltando:
        return observado
    novas = []
    for ano, nr in faltando:
        candidatos = observado.loc[observado['NR_PARTIDO'] == nr, 'SK_PARTIDO'].unique()
        assert len(candidatos) == 1, \
            f'número {nr} em {ano} sem candidatura e ambíguo entre {len(candidatos)} partidos'
        sk = int(candidatos[0])
        nome = ref.loc[ref['SK_PARTIDO'] == sk, 'NM_PARTIDO'].iloc[0]
        novas.append({'ANO_ELEICAO': ano, 'NR_PARTIDO': nr, 'SK_PARTIDO': sk,
                      'SG_PARTIDO': pd.NA, 'NM_PARTIDO': nome, 'SG_CANONICA': pd.NA})
    return pd.concat([observado, pd.DataFrame(novas)], ignore_index=True)


def resolver(numeros_vistos=None):
    """Devolve (dim_partido, dim_partido_ano).

    `numeros_vistos` é o conjunto de pares (ano, número) que aparecem na votação;
    serve para cobrir partidos que receberam voto sem ter candidato no ano.
    """
    ref = pd.read_csv(os.path.join(esquema.DIR_REFERENCIA, 'partidos_pi.csv'), dtype=str)
    ref['NR_PARTIDO_ATUAL'] = pd.to_numeric(ref['NR_PARTIDO_ATUAL'])

    # SK atribuído pela ordem alfabética da sigla, nunca por ordem de encontro,
    # para que reexecutar produza exatamente os mesmos números.
    ref = ref.sort_values('SG_PARTIDO').reset_index(drop=True)
    ref['SK_PARTIDO'] = range(1, len(ref) + 1)

    observado = _sigla_oficial_por_ano()
    canonico = _mapa_canonico(ref)

    faltando = sorted(set(observado['SG_PARTIDO']) - set(canonico))
    assert not faltando, f'siglas vistas nos dados e ausentes de partidos_pi.csv: {faltando}'

    observado['SG_CANONICA'] = observado['SG_PARTIDO'].map(canonico)
    observado = observado.merge(
        ref[['SG_PARTIDO', 'SK_PARTIDO']].rename(columns={'SG_PARTIDO': 'SG_CANONICA'}),
        on='SG_CANONICA', how='left', validate='many_to_one')

    if numeros_vistos:
        observado = _completa_sem_candidato(observado, numeros_vistos, ref)

    # Um número é "reatribuído" quando, em algum ano anterior, pertenceu a outra
    # entidade — é o sinal que o dashboard mostra ao cruzar essa fronteira.
    observado = observado.sort_values(['NR_PARTIDO', 'ANO_ELEICAO'])
    anterior = observado.groupby('NR_PARTIDO')['SK_PARTIDO'].shift()
    observado['FL_NUMERO_REATRIBUIDO'] = anterior.notna() & (anterior != observado['SK_PARTIDO'])
    # A marca vale para todos os anos do novo dono, não só o primeiro.
    reatribuidos = observado.loc[observado['FL_NUMERO_REATRIBUIDO'], ['NR_PARTIDO', 'SK_PARTIDO']].drop_duplicates()
    chaves = set(map(tuple, reatribuidos.values))
    observado['FL_NUMERO_REATRIBUIDO'] = [
        (nr, sk) in chaves for nr, sk in zip(observado['NR_PARTIDO'], observado['SK_PARTIDO'])]

    dim_partido_ano = observado.rename(columns={'NM_PARTIDO': 'NM_PARTIDO_ORIGEM'})
    dim_partido_ano = esquema.aplica(dim_partido_ano, 'dim_partido_ano').sort_values(
        ['ANO_ELEICAO', 'NR_PARTIDO']).reset_index(drop=True)

    dim_partido = esquema.aplica(ref, 'dim_partido').sort_values('SK_PARTIDO').reset_index(drop=True)

    # Cada (ano, número) aponta para exatamente um partido.
    assert dim_partido_ano.groupby(['ANO_ELEICAO', 'NR_PARTIDO'])['SK_PARTIDO'].nunique().max() == 1
    return dim_partido, dim_partido_ano


def sk_de(dim_partido_ano, ano, nr):
    """Auxiliar de teste: SK do partido em (ano, número)."""
    m = dim_partido_ano[(dim_partido_ano['ANO_ELEICAO'] == ano)
                        & (dim_partido_ano['NR_PARTIDO'] == str(nr))]
    return int(m['SK_PARTIDO'].iloc[0]) if len(m) else None
