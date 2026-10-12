"""Gera `fato_votos_secao.parquet`: votos nominais por seção eleitoral.

`fato_votos` tem grão de local de votação — o que a base unificada precisava
para comparar anos. A seção só existe nos arquivos brutos do TSE, e é o nível
que o painel "Votação por bairro" abre dentro de cada escola.

Reaproveita os leitores de `consolida_<ano>.py`, de modo que cada ano chega
aqui pelo mesmo caminho que levou ao bronze (inclusive o local ATUAL da seção
em 2026), e liga tudo às chaves da base unificada:

  - SK_ELEICAO  por (ano, CD_ELEICAO, turno);
  - SK_LOCAL    por (eleição, município, zona, nº do local);
  - SK_VOTAVEL  por (eleição, UE, cargo, nº do votável).

Só entram votos NOMINAIS de eleições da série principal: branco, nulo e
legenda não têm candidato a comparar, e as suplementares/2º turno de 2020 não
aparecem no painel. A medida é `QT_VOTOS_NORM` (mesma de `fato_votos`), então
o Senador de 2018/2026 continua somável.

A conferência final soma as seções de volta ao local e exige igualdade com
`fato_votos` — se uma seção caísse no local errado, ou um voto se perdesse, o
script para aqui.

Uso:  python scripts/votos_secao.py        (depois de unifica.py)
"""

import importlib
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eleitoral import esquema  # noqa: E402

SAIDA = os.path.join(esquema.DIR_UNIFICADO, 'fato_votos_secao.parquet')
ESFERA = esquema.ESFERA_POR_ANO


def ler(nome):
    return pd.read_parquet(os.path.join(esquema.DIR_UNIFICADO, f'{nome}.parquet'))


def secoes_do_ano(ano):
    """Votos por seção de um ano, com as colunas já como inteiros/strings limpos."""
    mod = importlib.import_module(f'consolida_{ano}')
    vt = mod.carrega_votacao()
    if ano == 2026:
        # Mesmo vínculo de consolida_2026.main: o local da seção vem do cadastro
        # atual, não do arquivo de votos (que traz o local original, defasado).
        pr = mod.aptos_por_secao(mod.carrega_eleitorado())
        secoes = pr[mod.CHAVE_SECAO + ['NR_LOCAL_VOTACAO']]
        vt = vt.merge(secoes, on=mod.CHAVE_SECAO, how='left', validate='many_to_one')
        assert vt['NR_LOCAL_VOTACAO'].notna().all(), 'seção de 2026 fora do cadastro'
    if ano == 2024:
        vt = vt[vt['TP_VOTO'] == 'Nominal']
    for c in ['NR_TURNO', 'CD_ELEICAO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO',
              'NR_LOCAL_VOTACAO', 'CD_CARGO']:
        vt[c] = pd.to_numeric(vt[c]).astype('int64')
    vt['ANO_ELEICAO'] = ano
    return vt[['ANO_ELEICAO', 'NR_TURNO', 'CD_ELEICAO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO',
               'NR_LOCAL_VOTACAO', 'CD_CARGO', 'NR_VOTAVEL', 'QT_VOTOS']]


def main():
    de = ler('dim_eleicao')
    dl = ler('dim_local')
    dv = ler('dim_votavel')
    dec = ler('dim_eleicao_cargo')
    fv = ler('fato_votos')

    principal = set(de.loc[de['FL_SERIE_PRINCIPAL'], 'SK_ELEICAO'])
    vpe = dec.set_index(['SK_ELEICAO', 'CD_CARGO'])['QT_VOTOS_POR_ELEITOR']
    nominal = dv[(dv['TP_VOTO'] == 'Nominal') & dv['SK_ELEICAO'].isin(principal)]
    chave_v = ['SK_ELEICAO', 'CD_MUNICIPIO_UE', 'CD_CARGO', 'NR_VOTAVEL']
    assert not nominal.duplicated(chave_v).any()

    partes = []
    for ano in esquema.ANOS:
        print(f'{ano}: lendo seções...')
        s = secoes_do_ano(ano)
        s = s.merge(de[['ANO_ELEICAO', 'CD_ELEICAO', 'NR_TURNO', 'SK_ELEICAO']],
                    on=['ANO_ELEICAO', 'CD_ELEICAO', 'NR_TURNO'], how='left', validate='many_to_one')
        assert s['SK_ELEICAO'].notna().all(), f'{ano}: eleição fora de dim_eleicao'
        s = s[s['SK_ELEICAO'].isin(principal)]

        s['CD_MUNICIPIO_UE'] = s['CD_MUNICIPIO'] if ESFERA[ano] == 'Municipal' else 0
        s = s.merge(nominal[chave_v + ['SK_VOTAVEL']], on=chave_v, how='inner', validate='many_to_one')

        s = s.merge(dl[['SK_ELEICAO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO', 'SK_LOCAL']],
                    on=['SK_ELEICAO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO'],
                    how='left', validate='many_to_one')
        assert s['SK_LOCAL'].notna().all(), f'{ano}: seção sem local na base'

        g = (s.groupby(['SK_ELEICAO', 'SK_LOCAL', 'NR_SECAO', 'SK_VOTAVEL', 'CD_CARGO'], as_index=False)
             ['QT_VOTOS'].sum())
        idx = pd.MultiIndex.from_arrays([g['SK_ELEICAO'], g['CD_CARGO']])
        g['QT_VOTOS_NORM'] = g['QT_VOTOS'].values / vpe.reindex(idx).values
        partes.append(g.drop(columns=['CD_CARGO', 'QT_VOTOS']))
        print(f'  {len(g):,} linhas')

    f = pd.concat(partes, ignore_index=True)

    # Conferência: seções somadas de volta ao local têm de igualar fato_votos.
    chave = ['SK_ELEICAO', 'SK_LOCAL', 'SK_VOTAVEL']
    a = f.groupby(chave)['QT_VOTOS_NORM'].sum()
    b = (fv[fv['SK_ELEICAO'].isin(principal) & fv['SK_VOTAVEL'].isin(nominal['SK_VOTAVEL'])]
         .groupby(chave)['QT_VOTOS_NORM'].sum())
    j = pd.concat([a.rename('secao'), b.rename('local')], axis=1).fillna(0)
    dif = j[~np.isclose(j['secao'], j['local'], atol=1e-3)]
    assert dif.empty, f'{len(dif)} (local, votável) com soma de seções diferente do local:\n{dif.head(10)}'
    print(f'conferido: {len(j):,} pares (local, votável) idênticos a fato_votos')

    f = f.astype({'SK_ELEICAO': 'int16', 'SK_LOCAL': 'int32', 'NR_SECAO': 'int16',
                  'SK_VOTAVEL': 'int32', 'QT_VOTOS_NORM': 'float32'})
    f = f.sort_values(['SK_ELEICAO', 'SK_LOCAL', 'NR_SECAO', 'SK_VOTAVEL']).reset_index(drop=True)
    f.to_parquet(SAIDA, index=False, compression='zstd', row_group_size=200_000)
    print(f'gravado: {SAIDA}  ({len(f):,} linhas, {os.path.getsize(SAIDA) / 1e6:.2f} MB)')


if __name__ == '__main__':
    main()
