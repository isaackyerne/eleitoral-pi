"""Identidade estável do local de votação ao longo dos anos.

`ID_LOCAL` ("município-zona-local") não serve como chave de painel: a Justiça
Eleitoral reduziu o PI de 82 para 74 zonas entre 2020 e 2022 e renumerou 27
municípios, dois deles indo e voltando (61→77→61→61). Isso quebra 1.180 dos
4.056 ID_LOCAL sem que nenhum local tenha mudado de lugar.

Trocar a chave por (município, número do local) *parece* resolver, mas o número
do local é namespaced por zona: 258-288 locais fisicamente distintos por ano
colidiriam — em Campo Maior 2018, zona 7 local 1031 é o SAAE e zona 96 local
1031 é a Escola Leonardo da Vinci. Fundir os dois é exatamente o erro que este
módulo existe para impedir.

A resolução tem três passos e uma trava:
  1. zona canônica — municípios de zona única em todos os anos ficam com 0, o
     que absorve as renumerações; os multizona mantêm a zona real;
  2. agrupamento por (município, zona canônica, número do local);
  3. união por nome normalizado, **rejeitando qualquer união entre dois grupos
     que coexistam no mesmo ano** — o que torna impossível, por construção,
     fundir dois locais distintos.
"""

import os

import pandas as pd

from . import canon, esquema


def _zona_canonica(locais):
    """Município de zona única em todos os anos → 0; multizona mantém a zona.

    Persistido em `referencia/zonas_crosswalk.csv` para ser revisável, em vez de
    re-derivado silenciosamente a cada execução.
    """
    # Multizona é quem tem duas zonas **no mesmo ano** — aí a zona faz parte da
    # identidade do local. Municípios que apenas trocaram de zona entre anos
    # continuam sendo de zona única e é justamente isso que a canonização
    # precisa absorver.
    por_mun_ano = locais.groupby(['CD_MUNICIPIO', 'ANO_ELEICAO'])['NR_ZONA'].nunique()
    multizona = set(por_mun_ano[por_mun_ano > 1].index.get_level_values('CD_MUNICIPIO'))

    zonas_por_ano = (locais.groupby(['CD_MUNICIPIO', 'ANO_ELEICAO'])['NR_ZONA']
                     .apply(lambda s: ','.join(map(str, sorted(s.unique())))).unstack())
    zonas_por_ano['FL_MULTIZONA'] = zonas_por_ano.index.isin(multizona)
    # Renumerado = o conjunto de zonas do município mudou entre anos.
    distintos = zonas_por_ano[esquema.ANOS].nunique(axis=1)
    zonas_por_ano['FL_ZONA_RENUMERADA'] = distintos > 1

    locais = locais.copy()
    locais['ZONA_CANON'] = locais['NR_ZONA'].where(
        locais['CD_MUNICIPIO'].isin(multizona), 0)
    return locais, zonas_por_ano.reset_index()


class _UnionFind:
    def __init__(self, itens):
        self.pai = {i: i for i in itens}

    def raiz(self, x):
        while self.pai[x] != x:
            self.pai[x] = self.pai[self.pai[x]]
            x = self.pai[x]
        return x

    def unir(self, a, b):
        ra, rb = self.raiz(a), self.raiz(b)
        if ra == rb:
            return False
        # Une sempre para a menor raiz, para o resultado não depender da ordem.
        if rb < ra:
            ra, rb = rb, ra
        self.pai[rb] = ra
        return True


def _une_por_nome(grupos):
    """Une grupos de mesmo nome no mesmo município, vetando coexistência anual.

    `grupos` traz uma linha por (grupo, nome, anos). Devolve o mapa de união e a
    lista de uniões rejeitadas, que vira material de revisão humana.
    """
    uf = _UnionFind(sorted(grupos['GRUPO'].unique()))
    anos = dict(zip(grupos['GRUPO'], grupos['ANOS']))
    rejeitadas = []

    candidatos = (grupos[grupos['NM_CHAVE'].notna()]
                  .groupby(['CD_MUNICIPIO', 'NM_CHAVE'])['GRUPO']
                  .apply(lambda s: sorted(s.unique())))
    for (cd_mun, nome), lista in sorted(candidatos.items()):
        if len(lista) < 2:
            continue
        for outro in lista[1:]:
            base = uf.raiz(lista[0])
            r_outro = uf.raiz(outro)
            if base == r_outro:
                continue
            if anos[base] & anos[r_outro]:
                rejeitadas.append({
                    'CD_MUNICIPIO': cd_mun, 'NM_CHAVE': nome,
                    'GRUPO_A': base, 'GRUPO_B': r_outro,
                    'ANOS_A': ','.join(map(str, sorted(anos[base]))),
                    'ANOS_B': ','.join(map(str, sorted(anos[r_outro]))),
                    'DS_MOTIVO': 'coexistem no mesmo ano',
                })
                continue
            uf.unir(base, r_outro)
            nova = uf.raiz(base)
            anos[nova] = anos[base] | anos[r_outro]

    return {g: uf.raiz(g) for g in uf.pai}, pd.DataFrame(rejeitadas)


def resolver(locais):
    """Atribui SK_LOCAL.

    `locais` precisa ter uma linha por (ANO_ELEICAO, CD_MUNICIPIO, NR_ZONA,
    NR_LOCAL_VOTACAO) com NM_LOCAL_VOTACAO. Devolve (locais+SK_LOCAL,
    zonas_crosswalk, uniões rejeitadas).
    """
    locais, zonas = _zona_canonica(locais)
    locais['NM_CHAVE'] = canon.chave(locais['NM_LOCAL_VOTACAO'])

    # Passo 2 — grupo por número, dentro da zona canônica.
    chave_num = ['CD_MUNICIPIO', 'ZONA_CANON', 'NR_LOCAL_VOTACAO']
    locais['GRUPO'] = (locais[chave_num].astype(str).agg('-'.join, axis=1))

    # Passo 3 — união por nome, com veto de coexistência.
    resumo = (locais.groupby('GRUPO')
              .agg(CD_MUNICIPIO=('CD_MUNICIPIO', 'first'),
                   ANOS=('ANO_ELEICAO', lambda s: set(s)),
                   NM_CHAVE=('NM_CHAVE', canon.moda))
              .reset_index())
    mapa, rejeitadas = _une_por_nome(resumo)
    locais['GRUPO_FINAL'] = locais['GRUPO'].map(mapa)
    locais['TP_VINCULO'] = pd.Series(
        ['nome' if g != gf else 'numero'
         for g, gf in zip(locais['GRUPO'], locais['GRUPO_FINAL'])], index=locais.index)
    # O tipo de vínculo é do local inteiro, não da linha-ano.
    por_sk = locais.groupby('GRUPO_FINAL')['TP_VINCULO'].transform(
        lambda s: 'nome' if (s == 'nome').any() else 'numero')
    locais['TP_VINCULO'] = por_sk

    # SK atribuído pela ordem do grupo final, nunca por ordem de encontro.
    ordem = sorted(locais['GRUPO_FINAL'].unique(),
                   key=lambda g: tuple(int(x) for x in g.split('-')))
    sk = {g: i for i, g in enumerate(ordem, start=1)}
    locais['SK_LOCAL'] = locais['GRUPO_FINAL'].map(sk).astype('int32')

    zonas = zonas.merge(
        locais.groupby('CD_MUNICIPIO')['SK_LOCAL'].nunique().rename('QT_LOCAIS').reset_index(),
        on='CD_MUNICIPIO', how='left')

    _verifica(locais)
    return locais, zonas, rejeitadas


def _verifica(locais):
    """Nenhum SK_LOCAL pode conter dois locais distintos no mesmo ano."""
    conflito = (locais.groupby(['SK_LOCAL', 'ANO_ELEICAO'])
                .agg(n=('NR_LOCAL_VOTACAO', lambda s: len(set(zip(s.index, s)))))
                )
    por_ano = locais.drop_duplicates(['SK_LOCAL', 'ANO_ELEICAO', 'NR_ZONA', 'NR_LOCAL_VOTACAO'])
    dup = por_ano.groupby(['SK_LOCAL', 'ANO_ELEICAO']).size()
    n = int((dup > 1).sum())
    assert n == 0, f'{n} SK_LOCAL contêm dois locais distintos no mesmo ano'
    assert locais.groupby('SK_LOCAL')['CD_MUNICIPIO'].nunique().max() == 1, \
        'SK_LOCAL atravessando município'


def salvar_referencia(zonas, rejeitadas):
    os.makedirs(esquema.DIR_REFERENCIA, exist_ok=True)
    zonas.to_csv(os.path.join(esquema.DIR_REFERENCIA, 'zonas_crosswalk.csv'),
                 index=False, encoding='utf-8')
    rejeitadas.to_csv(os.path.join(esquema.DIR_REFERENCIA, 'locais_unioes_rejeitadas.csv'),
                      index=False, encoding='utf-8')
