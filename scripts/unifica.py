"""Monta a base unificada 2018-2024 em star schema.

Lê os quatro `dados/processados/eleicoes_pi_<ano>.csv` (camada bronze) e grava
`dados/processados/unificado/*.parquet`.

O ponto do modelo é separar os grãos. Nos CSVs por ano, `QT_APTOS` convive com
`QT_VOTOS` na mesma linha e a documentação precisa avisar "deduplique antes de
somar". Aqui a coluna simplesmente não existe em `fato_votos`: somar a métrica
errada vira erro de coluna inexistente, não número inflado.

Uso:  python scripts/unifica.py
"""

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eleitoral import canon, esquema, locais, partidos, validacao, votaveis  # noqa: E402


def carrega_bronze():
    """Empilha os quatro anos, alinhando o esquema."""
    partes = []
    for ano in esquema.ANOS:
        caminho = os.path.join(esquema.DIR_BRONZE, f'eleicoes_pi_{ano}.csv')
        d = pd.read_csv(caminho, dtype=esquema.BRONZE_DTYPES_LEITURA, low_memory=False)
        faltando = [c for c in esquema.bronze_colunas(ano) if c not in d.columns]
        assert not faltando, f'{ano}: faltam colunas no bronze {faltando}'
        for extra in esquema.BRONZE_EXTRAS_2024:
            if extra not in d.columns:
                d[extra] = pd.NA
        partes.append(d)
    b = pd.concat(partes, ignore_index=True)
    b['TP_ESFERA'] = b['ANO_ELEICAO'].map(esquema.ESFERA_POR_ANO)
    # Unidade eleitoral: o município nas municipais, o estado nas estaduais.
    b['CD_MUNICIPIO_UE'] = b['CD_MUNICIPIO'].where(b['TP_ESFERA'] == 'Municipal', 0)
    return b


def monta_dim_eleicao(b):
    e = (b[['ANO_ELEICAO', 'CD_ELEICAO', 'DS_ELEICAO', 'NM_TIPO_ELEICAO', 'NR_TURNO',
            'DT_ELEICAO', 'TP_ESFERA', 'FL_ELEICAO_SUPLEMENTAR']]
         .drop_duplicates()
         .sort_values(['ANO_ELEICAO', 'CD_ELEICAO', 'NR_TURNO'])
         .reset_index(drop=True))
    e['SK_ELEICAO'] = range(1, len(e) + 1)
    e = e.rename(columns={'FL_ELEICAO_SUPLEMENTAR': 'FL_SUPLEMENTAR'})
    # A série principal é o 1º turno de cada eleição ordinária: um único
    # predicado que exclui as suplementares e o 2º turno de 2020.
    e['FL_SERIE_PRINCIPAL'] = (~e['FL_SUPLEMENTAR']) & e['NR_TURNO'].eq(1)
    return esquema.aplica(e, 'dim_eleicao')


def monta_dim_cargo(b):
    c = b[['CD_CARGO', 'DS_CARGO', 'TP_ESFERA']].drop_duplicates().sort_values('CD_CARGO')
    c['TP_SISTEMA'] = c['DS_CARGO'].map(
        lambda x: 'Proporcional' if x in esquema.CARGOS_PROPORCIONAIS else 'Majoritário')
    return esquema.aplica(c, 'dim_cargo')


def monta_dim_eleicao_cargo(b, dim_eleicao):
    ec = (b[['SK_ELEICAO', 'CD_CARGO', 'DS_CARGO', 'ANO_ELEICAO']]
          .drop_duplicates().sort_values(['SK_ELEICAO', 'CD_CARGO']))
    ec['QT_VAGAS'] = [esquema.VAGAS.get((a, c)) for a, c in zip(ec['ANO_ELEICAO'], ec['DS_CARGO'])]
    # Senador 2018 teve 2 vagas: cada eleitor votou duas vezes, então o total do
    # cargo é o dobro do comparecimento e não é comparável aos demais.
    ec['QT_VOTOS_POR_ELEITOR'] = [esquema.VOTOS_POR_ELEITOR.get((a, c), 1)
                                  for a, c in zip(ec['ANO_ELEICAO'], ec['DS_CARGO'])]
    ec['FL_ACEITA_LEGENDA'] = ec['DS_CARGO'].isin(esquema.CARGOS_PROPORCIONAIS)
    ec['QT_VAGAS'] = ec['QT_VAGAS'].astype('Int16')
    return esquema.aplica(ec, 'dim_eleicao_cargo')


def monta_dim_municipio(b):
    """Nome do município na grafia mais recente.

    Só 2022 perdeu os apóstrofos (BARRA DALCÂNTARA); tomando a grafia do ano
    mais novo em que o município aparece, eles voltam sem regra especial.
    """
    m = (b[['CD_MUNICIPIO', 'NM_MUNICIPIO', 'ANO_ELEICAO']].dropna(subset=['NM_MUNICIPIO'])
         .sort_values('ANO_ELEICAO').drop_duplicates('CD_MUNICIPIO', keep='last'))
    m['NM_MUNICIPIO'] = canon.texto(m['NM_MUNICIPIO'])
    m['NM_MUNICIPIO_CHAVE'] = canon.chave(m['NM_MUNICIPIO'])

    # O código do TSE (5 dígitos) não é o do IBGE (7), e é o do IBGE que casa
    # com a geometria. O de-para foi montado por nome normalizado, com os 224
    # casando exatamente, e vive em referencia/ para ser revisável.
    caminho = os.path.join(esquema.DIR_REFERENCIA, 'municipios_tse_ibge.csv')
    if os.path.exists(caminho):
        de_para = pd.read_csv(caminho, usecols=['CD_MUNICIPIO', 'CD_MUNICIPIO_IBGE'])
        m = m.merge(de_para, on='CD_MUNICIPIO', how='left', validate='one_to_one')
        faltando = m['CD_MUNICIPIO_IBGE'].isna().sum()
        assert faltando == 0, f'{faltando} municípios sem código do IBGE'
    else:
        m['CD_MUNICIPIO_IBGE'] = pd.NA
    return esquema.aplica(m.sort_values('CD_MUNICIPIO'), 'dim_municipio')


def monta_dim_local(b, sk_local, dim_eleicao):
    """SCD por eleição: uma linha por (SK_LOCAL, SK_ELEICAO)."""
    chave_nat = ['ANO_ELEICAO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO']
    atributos = ['SK_ELEICAO'] + chave_nat + [
        'ID_LOCAL', 'NM_LOCAL_VOTACAO', 'DS_TIPO_LOCAL', 'DS_ENDERECO', 'NM_BAIRRO',
        'NR_CEP', 'NR_TELEFONE_LOCAL', 'LATITUDE', 'LONGITUDE', 'DS_SITU_LOCAL_VOTACAO',
        'FL_LOCAL_REMANEJADO', 'FL_APTOS_ESTIMADO']
    d = b[atributos].drop_duplicates(['SK_ELEICAO'] + chave_nat[1:])
    d = d.merge(sk_local[chave_nat + ['SK_LOCAL', 'TP_VINCULO']], on=chave_nat,
                how='left', validate='many_to_one')
    assert d['SK_LOCAL'].notna().all(), 'local sem SK_LOCAL'

    d = d.rename(columns={'ID_LOCAL': 'ID_LOCAL_ANO'})
    # "ATIVO AGUARDANDO PROCESSAMENTO" só existe em 2020; vira flag para o
    # domínio da coluna ser igual nos quatro anos.
    situ = d['DS_SITU_LOCAL_VOTACAO'].astype('string')
    d['FL_SITU_AGUARDANDO_PROC'] = situ.str.contains('AGUARDANDO', na=False)
    d['DS_SITU_LOCAL_VOTACAO'] = canon.titulo_ptbr(
        situ.str.replace(' AGUARDANDO PROCESSAMENTO', '', regex=False))
    # 81 linhas de suplementares de 2020 não têm cadastro de local.
    d['FL_METADADO_AUSENTE'] = d['NM_LOCAL_VOTACAO'].isna()
    for c in ['NM_LOCAL_VOTACAO', 'DS_ENDERECO', 'NM_BAIRRO']:
        d[c] = canon.texto(d[c])
    d['FL_LOCAL_REMANEJADO'] = d['FL_LOCAL_REMANEJADO'].fillna(False)
    d['FL_APTOS_ESTIMADO'] = d['FL_APTOS_ESTIMADO'].fillna(False)
    return esquema.aplica(d, 'dim_local').sort_values(['SK_LOCAL', 'SK_ELEICAO']).reset_index(drop=True)


def monta_dim_local_atual(dim_local, sk_local, zonas):
    """Identidade do local + coordenada de referência.

    As coordenadas divergem entre anos por safra de geocodificação, não por
    mudança física: {2020,2024} batem em 94% e {2018,2022} em 71%, mas cruzado
    cai para 4-9%, com diferença na 4ª-7ª casa decimal. Uma referência única, do
    ano mais recente que tenha coordenada, estabiliza o mapa e aproveita a
    melhor cobertura (2024).
    """
    d = dim_local.sort_values('ANO_ELEICAO')
    geo = d[d['LATITUDE'].notna()].drop_duplicates('SK_LOCAL', keep='last')
    ref = geo.set_index('SK_LOCAL')

    a = (d.groupby('SK_LOCAL')
         .agg(CD_MUNICIPIO=('CD_MUNICIPIO', 'first'),
              NM_LOCAL_REF=('NM_LOCAL_VOTACAO', 'last'),
              ANOS_PRESENTE=('ANO_ELEICAO', lambda s: ','.join(map(str, sorted(set(s))))),
              QT_ANOS=('ANO_ELEICAO', 'nunique'))
         .reset_index())
    a['LATITUDE_REF'] = a['SK_LOCAL'].map(ref['LATITUDE'])
    a['LONGITUDE_REF'] = a['SK_LOCAL'].map(ref['LONGITUDE'])
    a['ANO_GEO_REF'] = a['SK_LOCAL'].map(ref['ANO_ELEICAO']).astype('Int16')
    a['NM_LOCAL_CHAVE'] = canon.chave(a['NM_LOCAL_REF'])
    a['QT_ANOS'] = a['QT_ANOS'].astype('int8')
    a['FL_PAINEL_COMPLETO'] = a['QT_ANOS'].eq(len(esquema.ANOS))

    # Dispersão > ~2 km entre anos indica mudança real de prédio ou geocódigo
    # ruim; sinaliza para revisão em vez de mediar as coordenadas.
    disp = (d.groupby('SK_LOCAL')
            .agg(la=('LATITUDE', 'max'), lb=('LATITUDE', 'min'),
                 oa=('LONGITUDE', 'max'), ob=('LONGITUDE', 'min')))
    graus = ((disp['la'] - disp['lb']).abs() + (disp['oa'] - disp['ob']).abs())
    a['FL_GEO_DIVERGENTE'] = a['SK_LOCAL'].map(graus > 0.018).fillna(False)

    a = a.merge(sk_local[['SK_LOCAL', 'TP_VINCULO']].drop_duplicates('SK_LOCAL'),
                on='SK_LOCAL', how='left')
    renum = set(zonas.loc[zonas['FL_ZONA_RENUMERADA'], 'CD_MUNICIPIO'])
    a['FL_ZONA_RENUMERADA'] = a['CD_MUNICIPIO'].isin(renum)
    return esquema.aplica(a, 'dim_local_atual').sort_values('SK_LOCAL').reset_index(drop=True)


def monta_fatos(b, dim_eleicao_cargo, dim_votavel):
    """fato_votos + os dois fatos agregados, em grãos separados."""
    vpe = dim_eleicao_cargo.set_index(['SK_ELEICAO', 'CD_CARGO'])['QT_VOTOS_POR_ELEITOR']
    idx = pd.MultiIndex.from_arrays([b['SK_ELEICAO'], b['CD_CARGO']])

    fv = b[['SK_ELEICAO', 'SK_LOCAL', 'SK_VOTAVEL', 'CD_CARGO', 'QT_VOTOS']].copy()
    # Medida sempre somável, mesmo com Senador 2018 (2 votos por eleitor).
    fv['QT_VOTOS_NORM'] = b['QT_VOTOS'].values / vpe.reindex(idx).values
    fato_votos = esquema.aplica(fv, 'fato_votos')

    tipos = b.pivot_table(index=['SK_ELEICAO', 'SK_LOCAL', 'CD_CARGO'], columns='TP_VOTO',
                          values='QT_VOTOS', aggfunc='sum', fill_value=0)
    for t in ['Nominal', 'Legenda', 'Branco', 'Nulo']:
        if t not in tipos:
            tipos[t] = 0
    flc = tipos.rename(columns={'Nominal': 'QT_VOTOS_NOMINAIS', 'Legenda': 'QT_VOTOS_LEGENDA',
                                'Branco': 'QT_VOTOS_BRANCO', 'Nulo': 'QT_VOTOS_NULO'}).reset_index()
    flc['QT_VOTOS_VALIDOS'] = flc['QT_VOTOS_NOMINAIS'] + flc['QT_VOTOS_LEGENDA']
    flc['QT_VOTOS_TOTAL'] = flc[['QT_VOTOS_NOMINAIS', 'QT_VOTOS_LEGENDA',
                                 'QT_VOTOS_BRANCO', 'QT_VOTOS_NULO']].sum(axis=1)
    qtd = b.groupby(['SK_ELEICAO', 'SK_LOCAL', 'CD_CARGO']).size().rename('QT_VOTAVEIS').reset_index()
    flc = flc.merge(qtd, on=['SK_ELEICAO', 'SK_LOCAL', 'CD_CARGO'])

    # Denominador na definição legal: o TSE não conta como válido o voto em
    # candidatura anulada. Quem decide isso é FL_VOTO_VALIDO, derivado do
    # arquivo oficial votacao_candidato_munzona — não a situação do registro,
    # que ignora anulações posteriores ao pleito.
    inaptos = set(dim_votavel.loc[dim_votavel['FL_VOTO_VALIDO'].eq(False), 'SK_VOTAVEL'])
    desconto = (b[b['SK_VOTAVEL'].isin(inaptos)]
                .groupby(['SK_ELEICAO', 'SK_LOCAL', 'CD_CARGO'], as_index=False)['QT_VOTOS'].sum()
                .rename(columns={'QT_VOTOS': '_desconto'}))
    flc = flc.merge(desconto, on=['SK_ELEICAO', 'SK_LOCAL', 'CD_CARGO'], how='left')
    flc['QT_VOTOS_VALIDOS_OFICIAL'] = flc['QT_VOTOS_VALIDOS'] - flc['_desconto'].fillna(0)
    fato_local_cargo = esquema.aplica(flc, 'fato_local_cargo')

    # Participação é atributo do local na eleição: uma linha por local.
    fl = (b.drop_duplicates(['SK_ELEICAO', 'SK_LOCAL'])
          [['SK_ELEICAO', 'SK_LOCAL', 'QT_APTOS', 'QT_COMPARECIMENTO', 'QT_ABSTENCAO',
            'QT_SECOES', 'QT_SECOES_AGREGADAS', 'QT_SECOES_ACESSIVEIS',
            'QT_ELEITOR_BIOM_SEM_HABILITACAO']].copy())
    for c in ['QT_APTOS', 'QT_COMPARECIMENTO', 'QT_ABSTENCAO', 'QT_SECOES',
              'QT_SECOES_AGREGADAS', 'QT_SECOES_ACESSIVEIS', 'QT_ELEITOR_BIOM_SEM_HABILITACAO']:
        fl[c] = pd.to_numeric(fl[c], errors='coerce').astype('Int32')
    fl['PCT_COMPARECIMENTO'] = (fl['QT_COMPARECIMENTO'] / fl['QT_APTOS'] * 100).astype('Float32')
    fl['PCT_ABSTENCAO'] = (fl['QT_ABSTENCAO'] / fl['QT_APTOS'] * 100).astype('Float32')
    fato_local = esquema.aplica(fl, 'fato_local')
    return fato_votos, fato_local_cargo, fato_local


def monta_fato_oficial(dim_eleicao):
    """Agregados publicados pelo TSE, sem nenhuma derivação nossa.

    Vêm de `detalhe_votacao_munzona`, no grão município × zona × cargo — mais
    grosso que o da base, que é por local. Servem como referência: qualquer
    número que vá a público deve bater com esta tabela, e é ela que sustenta a
    afirmação de que a base reproduz o oficial.
    """
    # O arquivo do TSE tem pares de colunas com nome parecido (QT_VOTOS_NULOS e
    # QT_TOTAL_VOTOS_NULOS): selecionar antes de renomear evita colisão.
    ren = {
        'QT_TOTAL_VOTOS_VALIDOS': 'QT_VOTOS_VALIDOS',
        'QT_VOTOS_NOMINAIS_VALIDOS': 'QT_VOTOS_NOMINAIS_VALIDOS',
        'QT_TOTAL_VOTOS_LEG_VALIDOS': 'QT_VOTOS_LEGENDA_VALIDOS',
        'QT_TOTAL_VOTOS_ANULADOS': 'QT_VOTOS_ANULADOS',
        'QT_TOTAL_VOTOS_ANUL_SUBJUD': 'QT_VOTOS_ANUL_SUBJUD',
        'QT_VOTOS_BRANCOS': 'QT_VOTOS_BRANCOS',
        'QT_TOTAL_VOTOS_NULOS': 'QT_VOTOS_NULOS',
        'QT_ABSTENCOES': 'QT_ABSTENCOES',
    }
    chave = ['CD_ELEICAO', 'NR_TURNO', 'CD_MUNICIPIO', 'NR_ZONA', 'CD_CARGO']
    partes = []
    for ano in esquema.ANOS:
        caminho = os.path.join(esquema.DIR_BRUTOS_TSE,
                               f'detalhe_votacao_munzona_{ano}_PI.csv')
        if not os.path.exists(caminho):
            continue
        d = pd.read_csv(caminho, sep=';', encoding='latin1', dtype=str, quotechar='"',
                        na_values=esquema.NA_TSE,
                        usecols=chave + ['QT_APTOS', 'QT_COMPARECIMENTO'] + list(ren))
        d = d.rename(columns=ren)
        for c in d.columns:
            d[c] = pd.to_numeric(d[c], errors='coerce')
        # O TSE quebra a linha por voto em trânsito. Votos somam; aptos e
        # comparecimento se repetem entre as linhas, então basta o máximo.
        g = d.groupby(chave, as_index=False).agg(
            {**{c: 'sum' for c in ren.values()},
             'QT_APTOS': 'max', 'QT_COMPARECIMENTO': 'max'})
        partes.append(g)
    if not partes:
        return None
    o = pd.concat(partes, ignore_index=True)
    o = o.merge(dim_eleicao[['SK_ELEICAO', 'CD_ELEICAO', 'NR_TURNO']],
                on=['CD_ELEICAO', 'NR_TURNO'], how='inner', validate='many_to_one')
    return esquema.aplica(o, 'fato_oficial_munzona').sort_values(
        ['SK_ELEICAO', 'CD_MUNICIPIO', 'NR_ZONA', 'CD_CARGO']).reset_index(drop=True)


def main():
    print('lendo camada bronze...')
    b = carrega_bronze()
    print(f'  {len(b):,} linhas')

    dim_eleicao = monta_dim_eleicao(b)
    b = b.merge(dim_eleicao[['ANO_ELEICAO', 'CD_ELEICAO', 'NR_TURNO', 'SK_ELEICAO']],
                on=['ANO_ELEICAO', 'CD_ELEICAO', 'NR_TURNO'], how='left', validate='many_to_one')
    assert b['SK_ELEICAO'].notna().all()

    print('resolvendo identidade dos locais...')
    chave_nat = ['ANO_ELEICAO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO']
    entrada = b.drop_duplicates(chave_nat)[chave_nat + ['NM_LOCAL_VOTACAO', 'ID_LOCAL']].copy()
    sk_local, zonas, rejeitadas = locais.resolver(entrada)
    locais.salvar_referencia(zonas, rejeitadas)
    b = b.merge(sk_local[chave_nat + ['SK_LOCAL']], on=chave_nat, how='left',
                validate='many_to_one')
    assert b['SK_LOCAL'].notna().all()
    print(f'  {sk_local["SK_LOCAL"].nunique():,} locais distintos, '
          f'{len(rejeitadas)} uniões rejeitadas para revisão')

    print('resolvendo partidos...')
    # Números que aparecem na votação, para cobrir quem recebeu voto de legenda
    # sem ter lançado candidato no ano.
    vistos = set(map(tuple, b.loc[b['NR_PARTIDO'].notna(),
                                  ['ANO_ELEICAO', 'NR_PARTIDO']].drop_duplicates().values))
    dim_partido, dim_partido_ano = partidos.resolver(vistos)

    print('resolvendo votáveis...')
    dim_votavel, dim_politico = votaveis.resolver(b, dim_eleicao, dim_partido_ano, dim_partido)
    chave_v = ['SK_ELEICAO', 'CD_MUNICIPIO_UE', 'CD_CARGO', 'NR_VOTAVEL']
    ligacao = dim_votavel[dim_votavel['SK_VOTAVEL'] > 0][chave_v + ['SK_VOTAVEL']]
    b = b.merge(ligacao, on=chave_v, how='left', validate='many_to_one')
    especial = {'Branco': esquema.SK_VOTAVEL_BRANCO, 'Nulo': esquema.SK_VOTAVEL_NULO}
    b['SK_VOTAVEL'] = b['SK_VOTAVEL'].fillna(b['TP_VOTO'].map(especial))
    assert b['SK_VOTAVEL'].notna().all(), 'voto sem SK_VOTAVEL'
    print(f'  {len(dim_votavel):,} votáveis, {len(dim_politico):,} políticos distintos')

    print('montando dimensões e fatos...')
    dim_cargo = monta_dim_cargo(b)
    dim_eleicao_cargo = monta_dim_eleicao_cargo(b, dim_eleicao)
    dim_municipio = monta_dim_municipio(b)
    dim_local = monta_dim_local(b, sk_local, dim_eleicao)
    dim_local_atual = monta_dim_local_atual(dim_local, sk_local, zonas)
    fato_votos, fato_local_cargo, fato_local = monta_fatos(b, dim_eleicao_cargo, dim_votavel)
    fato_oficial = monta_fato_oficial(dim_eleicao)

    tabelas = {
        'fato_votos': fato_votos, 'fato_local_cargo': fato_local_cargo, 'fato_local': fato_local,
        'dim_eleicao': dim_eleicao, 'dim_eleicao_cargo': dim_eleicao_cargo, 'dim_cargo': dim_cargo,
        'dim_municipio': dim_municipio, 'dim_local': dim_local, 'dim_local_atual': dim_local_atual,
        'dim_partido': dim_partido, 'dim_partido_ano': dim_partido_ano,
        'dim_votavel': dim_votavel, 'dim_politico': dim_politico,
    }
    if fato_oficial is not None:
        tabelas['fato_oficial_munzona'] = fato_oficial

    print('validando...')
    validacao.rodar(tabelas, b)

    os.makedirs(esquema.DIR_UNIFICADO, exist_ok=True)
    print(f'gravando em {esquema.DIR_UNIFICADO}')
    total = 0
    for nome, df in tabelas.items():
        caminho = os.path.join(esquema.DIR_UNIFICADO, f'{nome}.parquet')
        df.to_parquet(caminho, index=False, compression='zstd')
        tam = os.path.getsize(caminho)
        total += tam
        print(f'  {nome:22} {len(df):>9,} linhas  {tam/1024/1024:6.2f} MB')
    print(f'  {"TOTAL":22} {"":>9}         {total/1024/1024:6.2f} MB')
    return tabelas


if __name__ == '__main__':
    main()
