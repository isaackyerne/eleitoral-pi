"""Verificação da base tendo os ZIPS originais como única fonte da verdade.

Lê de dentro dos zips, sem tocar em `dados/<ano>/` nem na camada intermediária,
reconstrói cada número de forma independente e compara com os parquets. Não usa
nada baixado do TSE — é a prova de que a base reproduz exatamente o material de
origem.

Cobre, nos quatro anos: total de votos; votos por eleição x turno x cargo; votos
por município; votos por tipo (nominal, legenda, branco, nulo); aptos,
comparecimento e abstenções; contagem de municípios, zonas e locais; e a
reconciliação linha a linha no grão local x cargo x votável.

Uso:  python scripts/verifica_zips.py     (sai com código 1 se algo divergir)
"""
import sys
import zipfile

import pandas as pd

R = '/home/dev/Documentos/Trabalho/Pessoais/eleitoral-pi'
U = f'{R}/dados/processados/unificado'
ZIPS = {2018: 'Ano 2018.zip', 2020: 'Ano 2020.zip', 2022: 'Ano 2022.zip', 2024: 'ano2024.zip'}
NA = ['#NULO#', '#NE#', '#NULO', '#NE']

falhas, checagens = [], 0


def ok(desc, esperado, obtido):
    global checagens
    checagens += 1
    if isinstance(esperado, (int, float)):
        bate = int(esperado) == int(obtido)
        txt = f'zip={int(esperado):>12,} base={int(obtido):>12,}'
        if not bate:
            txt += f'  dif={int(obtido)-int(esperado):+,}'
    else:
        bate = esperado == obtido
        txt = f'zip={esperado} base={obtido}'
    print(f'  {"OK   " if bate else "FALHA"} {desc:44} {txt}')
    if not bate:
        falhas.append(desc)


def le(ano, prefixo):
    z = zipfile.ZipFile(f'{R}/{ZIPS[ano]}')
    nome = [n for n in z.namelist() if n.startswith(prefixo)][0]
    with z.open(nome) as fh:
        d = pd.read_csv(fh, sep=';', encoding='latin1', dtype=str, quotechar='"', na_values=NA)
    d.columns = [c.strip() for c in d.columns]
    return d


t = {n: pd.read_parquet(f'{U}/{n}.parquet') for n in
     ['fato_votos', 'fato_local_cargo', 'fato_local', 'dim_eleicao', 'dim_eleicao_cargo',
      'dim_local', 'dim_votavel', 'dim_municipio', 'dim_partido', 'dim_partido_ano']}
de, fv, fl, flc, dl, dv = (t['dim_eleicao'], t['fato_votos'], t['fato_local'],
                           t['fato_local_cargo'], t['dim_local'], t['dim_votavel'])
cargo = t['dim_eleicao_cargo'][['SK_ELEICAO', 'CD_CARGO', 'DS_CARGO']].drop_duplicates()

print('=' * 96)
print('VERIFICAÇÃO — fonte da verdade: os 4 zips originais')
print('=' * 96)

for ano in [2018, 2020, 2022, 2024]:
    e2024 = ano == 2024
    vt = le(ano, 'bweb' if e2024 else 'votacao_secao')
    vt['QT_VOTOS'] = pd.to_numeric(vt['QT_VOTOS'])
    ccargo = 'DS_CARGO_PERGUNTA' if e2024 else 'DS_CARGO'
    ctipo = 'DS_TIPO_VOTAVEL' if e2024 else None
    vt['_turno'] = pd.to_numeric(vt['NR_TURNO'])
    vt['_eleicao'] = pd.to_numeric(vt['CD_ELEICAO'])
    vt['_cargo'] = vt[ccargo].str.title()

    sk_ano = de[de['ANO_ELEICAO'] == ano]
    base_ano = fv.merge(sk_ano[['SK_ELEICAO', 'CD_ELEICAO', 'NR_TURNO']], on='SK_ELEICAO')

    print(f'\n### {ano}  —  {ZIPS[ano]}')
    print(f'  linhas no zip: {len(vt):,}')

    # 1 ── conservação global
    ok('total de votos', vt['QT_VOTOS'].sum(), base_ano['QT_VOTOS'].sum())

    # 2 ── por eleição × turno × cargo
    z = vt.groupby(['_eleicao', '_turno', '_cargo'])['QT_VOTOS'].sum()
    b = (base_ano.merge(cargo, on=['SK_ELEICAO', 'CD_CARGO'])
         .groupby(['CD_ELEICAO', 'NR_TURNO', 'DS_CARGO'])['QT_VOTOS'].sum())
    for k, v in z.items():
        ok(f'  eleição {k[0]} T{k[1]} {k[2]}', v, b.get(k, 0))

    # 3 ── por município (todos os 224), soma de votos
    zm = vt.groupby('CD_MUNICIPIO')['QT_VOTOS'].sum()
    bm = (base_ano.merge(dl[['SK_LOCAL', 'SK_ELEICAO', 'CD_MUNICIPIO']],
                         on=['SK_LOCAL', 'SK_ELEICAO'])
          .groupby('CD_MUNICIPIO')['QT_VOTOS'].sum())
    zm.index = zm.index.astype(int)
    divergentes = [m for m in zm.index if int(zm[m]) != int(bm.get(m, 0))]
    ok('votos idênticos nos 224 municípios', len(zm), len(zm) - len(divergentes))

    # 4 ── por tipo de voto
    if e2024:
        zt = vt.groupby(ctipo)['QT_VOTOS'].sum()
    else:
        def tipo(cg, nr):
            if nr == '95':
                return 'Branco'
            if nr == '96':
                return 'Nulo'
            prop = cg in ('Deputado Federal', 'Deputado Estadual', 'Vereador')
            return 'Legenda' if (prop and len(nr) == 2) else 'Nominal'
        zt = vt.assign(_t=[tipo(c, n) for c, n in zip(vt['_cargo'], vt['NR_VOTAVEL'])]) \
               .groupby('_t')['QT_VOTOS'].sum()
    bt = (base_ano.merge(dv[['SK_VOTAVEL', 'TP_VOTO']], on='SK_VOTAVEL')
          .groupby('TP_VOTO')['QT_VOTOS'].sum())
    for k, v in zt.items():
        ok(f'  tipo {k}', v, bt.get(k, 0))

    # 5 ── eleitorado, direto do zip
    if e2024:
        for c in ['QT_APTOS', 'QT_COMPARECIMENTO', 'QT_ABSTENCOES']:
            vt[c] = pd.to_numeric(vt[c])
        sec = vt.drop_duplicates(['CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO'])
        aptos_z, comp_z, abst_z = (int(sec['QT_APTOS'].sum()),
                                   int(sec['QT_COMPARECIMENTO'].sum()),
                                   int(sec['QT_ABSTENCOES'].sum()))
    else:
        el = le(ano, 'eleitorado_local_votacao')
        el = el[(el['SG_UF'] == 'PI') & (el['NR_TURNO'] == '1')]
        campo = 'QT_ELEITOR_ELEICAO_MUNICIPAL' if ano == 2020 else 'QT_ELEITOR_ELEICAO_ESTADUAL'
        for c in [campo, 'QT_ELEITOR_SECAO']:
            el[c] = pd.to_numeric(el[c])
        pr = el[el['DS_TIPO_SECAO_AGREGADA'] == 'Principal'].copy()
        vinc = el[el['DS_TIPO_SECAO_AGREGADA'] != 'Principal']
        sv = (vinc.groupby(['CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO_PRINCIPAL'])['QT_ELEITOR_SECAO']
              .sum().rename('v').reset_index()
              .rename(columns={'NR_SECAO_PRINCIPAL': 'NR_SECAO'}))
        pr = pr.merge(sv, on=['CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO'], how='left')
        pr['v'] = pr['v'].fillna(0)
        pr['aptos'] = pr[campo].where(pr[campo] > 0, pr['QT_ELEITOR_SECAO'] + pr['v'])
        # só as seções que de fato votaram entram na base
        K = ['CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO']
        com_voto = vt[vt['_eleicao'] == vt['_eleicao'].mode()[0]][K].drop_duplicates()
        pr_v = pr.merge(com_voto, on=K, how='inner')
        aptos_z = int(pr_v['aptos'].sum())
        cargo_unico = 'Prefeito' if ano == 2020 else 'Governador'
        alvo = vt[(vt['_cargo'] == cargo_unico) & (vt['_turno'] == 1)]
        if ano == 2020:
            alvo = alvo[alvo['_eleicao'] == 426]
        comp_z = int(alvo['QT_VOTOS'].sum())
        abst_z = aptos_z - comp_z
        print(f'      (seções principais no cadastro: {len(pr):,}; com voto: {len(pr_v):,};'
              f' aptos de todas: {int(pr["aptos"].sum()):,})')

    sk1 = int(sk_ano[sk_ano['FL_SERIE_PRINCIPAL']]['SK_ELEICAO'].iloc[0])
    b1 = fl[fl['SK_ELEICAO'] == sk1]
    ok('aptos (1º turno)', aptos_z, b1['QT_APTOS'].sum())
    ok('comparecimento (1º turno)', comp_z, b1['QT_COMPARECIMENTO'].sum())
    ok('abstenções (1º turno)', abst_z, b1['QT_ABSTENCAO'].sum())

    # 6 ── estrutura
    ok('municípios', vt['CD_MUNICIPIO'].nunique(), dl[dl['ANO_ELEICAO'] == ano]['CD_MUNICIPIO'].nunique())
    ok('zonas', vt['NR_ZONA'].nunique(), dl[dl['ANO_ELEICAO'] == ano]['NR_ZONA'].nunique())
    nloc = len(vt[['CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO']].drop_duplicates())
    ok('locais distintos', nloc, len(dl[dl['ANO_ELEICAO'] == ano]
                                     [['CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO']].drop_duplicates()))

    # 7 ── votação de cada votável, no grão do zip
    chave = ['_eleicao', '_turno', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO',
             '_cargo', 'NR_VOTAVEL']
    zc = vt.groupby(chave)['QT_VOTOS'].sum()
    bb = (base_ano.merge(dl[['SK_LOCAL', 'SK_ELEICAO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO']],
                         on=['SK_LOCAL', 'SK_ELEICAO'])
          .merge(cargo, on=['SK_ELEICAO', 'CD_CARGO'])
          .merge(dv[['SK_VOTAVEL', 'NR_VOTAVEL', 'TP_VOTO']], on='SK_VOTAVEL'))
    # branco/nulo têm NR_VOTAVEL nulo na dim (linha global): recupera do zip
    bb['NR_VOTAVEL'] = bb['NR_VOTAVEL'].fillna(
        bb['TP_VOTO'].map({'Branco': '95', 'Nulo': '96'}))
    bc = bb.groupby(['CD_ELEICAO', 'NR_TURNO', 'CD_MUNICIPIO', 'NR_ZONA',
                     'NR_LOCAL_VOTACAO', 'DS_CARGO', 'NR_VOTAVEL'])['QT_VOTOS'].sum()
    zc.index = pd.MultiIndex.from_arrays(
        [zc.index.get_level_values(0), zc.index.get_level_values(1),
         zc.index.get_level_values(2).astype(int), zc.index.get_level_values(3).astype(int),
         zc.index.get_level_values(4).astype(int), zc.index.get_level_values(5),
         zc.index.get_level_values(6)])
    juntos = pd.concat([zc.rename('zip'), bc.rename('base')], axis=1).fillna(0)
    iguais = int((juntos['zip'] == juntos['base']).sum())
    ok('linhas voto-a-voto (local×cargo×votável)', len(juntos), iguais)

print('\n' + '=' * 96)
print(f'RESULTADO: {checagens} checagens, {len(falhas)} falha(s)')
if falhas:
    for f in falhas:
        print(f'  - {f}')
print('=' * 96)

sys.exit(1 if falhas else 0)
