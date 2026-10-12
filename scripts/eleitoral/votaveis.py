"""Dimensão de votáveis e ponte de político.

Um votável pertence a **uma** eleição. Números de urna são reciclados entre
pleitos: cruzando 2020 e 2024 pelo trio (município, cargo, número), 75% dos
pares são pessoas diferentes. Então `NR_VOTAVEL` nunca é identidade.

A identidade real da pessoa vem do **título de eleitor** do candidato, publicado
no `consulta_cand` do TSE. O CPF seria o candidato natural, mas a partir de 2024
o TSE o suprime por proteção de dados pessoais (todas as linhas trazem o
sentinela "-4"); o título continua completo e distinto nos quatro anos.

É também do `consulta_cand` que sai o `SQ_CANDIDATO` de 2024, que o Boletim de
Urna não traz, e o nome completo — em 2024 o boletim só publica o nome de urna.
"""

import os

import pandas as pd

from . import canon, esquema

# Colunas aproveitadas do consulta_cand.
_COLS_CAND = [
    'NR_TURNO', 'SG_UE', 'CD_CARGO', 'SQ_CANDIDATO', 'NR_CANDIDATO',
    'NM_CANDIDATO', 'NM_URNA_CANDIDATO', 'NR_TITULO_ELEITORAL_CANDIDATO',
    'DS_SITUACAO_CANDIDATURA', 'DS_SIT_TOT_TURNO', 'SG_FEDERACAO',
    'DT_NASCIMENTO', 'DS_GENERO', 'DS_COR_RACA', 'DS_GRAU_INSTRUCAO', 'DS_OCUPACAO',
]


def carrega_candidaturas():
    """Une os 4 consulta_cand, preferindo a candidatura APTA.

    Em 2018 oito números de urna aparecem duas vezes na mesma eleição porque o
    candidato original foi declarado INAPTO e substituído. Quem recebeu os votos
    é o APTO, então ele vence o desempate.
    """
    partes = []
    for ano in esquema.ANOS:
        # Presidente só consta do arquivo nacional (extrai_presidente.py o reduz aos
        # candidatos ao cargo); os demais cargos, do arquivo do estado.
        for sufixo in ('PI', 'BR'):
            caminho = os.path.join(esquema.DIR_BRUTOS_TSE, f'consulta_cand_{ano}_{sufixo}.csv')
            if sufixo == 'BR' and not os.path.exists(caminho):
                continue
            c = pd.read_csv(caminho, sep=';', encoding='latin1', dtype=str, quotechar='"',
                            na_values=esquema.NA_TSE, usecols=_COLS_CAND)
            c['ANO_ELEICAO'] = ano
            partes.append(c)
    c = pd.concat(partes, ignore_index=True)

    c['NR_TITULO_ELEITORAL_CANDIDATO'] = canon.limpa_sentinela(
        c['NR_TITULO_ELEITORAL_CANDIDATO'].astype('string'))
    c['FL_APTO'] = c['DS_SITUACAO_CANDIDATURA'].eq('APTO')
    # Candidatura substituída, renunciada ou sem apuração sai com DS_SIT_TOT_TURNO
    # "#NULO" (vira nulo na leitura). O arquivo mais novo do TSE traz essas linhas
    # junto da candidatura que de fato recebeu os votos, com o MESMO número na mesma
    # disputa — em 2024 e 2026 todo DS_SITUACAO_CANDIDATURA é "#NE", então só a
    # apuração distingue quem é quem.
    c['FL_TEM_RESULTADO'] = c['DS_SIT_TOT_TURNO'].notna()
    # Quando duas candidaturas dividem o mesmo número na mesma disputa (substituição:
    # os votos dos dois SQ caem no mesmo votável, pela chave natural), quem fica é a
    # que ocupa o mandato — é ela que define, por exemplo, quantas prefeituras um
    # partido ganhou (Muricí dos Portelas 2020: Ana Lina e Francisca, as duas PSD 55).
    c['FL_ELEITA'] = c['DS_SIT_TOT_TURNO'].str.upper().str.startswith('ELEITO').fillna(False)
    c['UE'] = c['SG_UE'].str.lstrip('0').replace('', '0')
    # As chaves de junção vêm como texto do CSV; o bronze é numérico.
    for col in ['NR_TURNO', 'CD_CARGO']:
        c[col] = pd.to_numeric(c[col])
    c = c.sort_values(['FL_APTO', 'FL_TEM_RESULTADO', 'FL_ELEITA'], ascending=False, kind='stable')
    return c


def destinacao_oficial():
    """Quais votos o TSE contou como válidos, por candidatura.

    `DS_SITUACAO_CANDIDATURA` diz se o registro foi deferido, mas não basta: um
    candidato apto pode ter os votos anulados depois, por julgamento ou cassação.
    A resposta oficial está em `votacao_candidato_munzona`, no campo
    `NM_TIPO_DESTINACAO_VOTOS` e na diferença entre `QT_VOTOS_NOMINAIS` e
    `QT_VOTOS_NOMINAIS_VALIDOS`.

    O mecanismo muda de ano: em 2022 e 2024 a candidatura anulada aparece com
    destinação "Anulado"; em 2018 e 2020 ela é simplesmente **omitida** do
    arquivo — foi o que aconteceu com Elizeu Aguiar, senador em 2018, cujos
    79.781 votos o TSE contabiliza como nulos.

    Destinações que contam como válido: "Válido" e "Válido (legenda)" — nesta
    última o voto migra para a legenda do partido, mas continua válido. Ficam de
    fora "Anulado" e "Anulado sub judice".

    Daí a leitura de uma ausência depender do ano: onde o arquivo lista
    anulações explícitas, quem não está lá é só um registro faltante e o TSE
    conta seus votos como válidos; onde não lista nenhuma, a ausência **é** a
    anulação. Devolve (mapa SQ->válido, mapa ano->lista anulações).
    """
    valido, lista_anulacao = {}, {}
    for ano in esquema.ANOS:
        caminho = os.path.join(esquema.DIR_BRUTOS_TSE,
                               f'votacao_candidato_munzona_{ano}_PI.csv')
        if not os.path.exists(caminho):
            continue
        v = pd.read_csv(caminho, sep=';', encoding='latin1', dtype=str, quotechar='"',
                        na_values=esquema.NA_TSE,
                        usecols=['SQ_CANDIDATO', 'NM_TIPO_DESTINACAO_VOTOS'])
        destino = v['NM_TIPO_DESTINACAO_VOTOS'].fillna('Válido')
        conta = destino.str.startswith('Válido')
        agregado = conta.groupby(v['SQ_CANDIDATO']).any()
        valido.update(agregado.items())
        lista_anulacao[ano] = bool((~conta).any())
    return valido, lista_anulacao


def _idade(dt_nasc, ano):
    d = pd.to_datetime(dt_nasc, format='%d/%m/%Y', errors='coerce')
    return (ano - d.dt.year).astype('Int16')


def resolver(bronze, dim_eleicao, dim_partido_ano, dim_partido):
    """Devolve (dim_votavel, dim_politico).

    `bronze` é a união dos CSVs por ano, já com SK_ELEICAO.
    """
    cand = carrega_candidaturas()

    chave = ['SK_ELEICAO', 'CD_MUNICIPIO_UE', 'CD_CARGO', 'NR_VOTAVEL']

    # Duas candidaturas podem dividir o mesmo número na mesma disputa (substituição):
    # os votos dos dois SQ caem no mesmo votável, pela chave natural, e quem o
    # representa é a que ocupa o mandato — é ela que define, por exemplo, quantas
    # prefeituras um partido ganhou (Muricí dos Portelas 2020: Ana Lina e Francisca,
    # as duas PSD 55). Sem SQ no bronze (2024) a escolha cai no desempate de
    # `carrega_candidaturas`.
    sq_turno = cand.drop_duplicates(['SQ_CANDIDATO', 'NR_TURNO']).set_index(['SQ_CANDIDATO', 'NR_TURNO'])
    idx_bronze = pd.MultiIndex.from_arrays([bronze['SQ_CANDIDATO'], bronze['NR_TURNO']])
    prioridade = pd.DataFrame({
        'eleita': sq_turno['FL_ELEITA'].reindex(idx_bronze).fillna(False).astype(bool).values,
        'resultado': sq_turno['FL_TEM_RESULTADO'].reindex(idx_bronze).fillna(False).astype(bool).values,
    }, index=bronze.index)
    ordem = prioridade.sort_values(['eleita', 'resultado'], ascending=False, kind='stable').index
    v = (bronze.loc[ordem].drop_duplicates(chave)[
        chave + ['ANO_ELEICAO', 'NR_TURNO', 'TP_VOTO', 'NM_VOTAVEL', 'SQ_CANDIDATO',
                 'NR_PARTIDO', 'TP_ESFERA']].copy())

    # --- enriquecimento com o consulta_cand -------------------------------
    # 2018-2022 já trazem SQ_CANDIDATO: o casamento por SQ é exato e não depende
    # de número nem de turno. 2024 não tem SQ, então cai no trio natural.
    cand_por_sq = cand.drop_duplicates('SQ_CANDIDATO').set_index('SQ_CANDIDATO')
    cand_por_nr = cand.drop_duplicates(['ANO_ELEICAO', 'NR_TURNO', 'UE', 'CD_CARGO', 'NR_CANDIDATO'])

    v['UE'] = v['CD_MUNICIPIO_UE'].astype(str).where(v['TP_ESFERA'] == 'Municipal', 'PI')
    # A unidade eleitoral de Presidente é o país: SG_UE = 'BR' no consulta_cand.
    v.loc[v['CD_CARGO'] == esquema.CD_CARGO_PRESIDENTE, 'UE'] = 'BR'
    por_sq = v['SQ_CANDIDATO'].map(cand_por_sq['NR_TITULO_ELEITORAL_CANDIDATO'])

    m = v.merge(
        cand_por_nr[['ANO_ELEICAO', 'NR_TURNO', 'UE', 'CD_CARGO', 'NR_CANDIDATO',
                     'SQ_CANDIDATO', 'NM_CANDIDATO', 'NM_URNA_CANDIDATO', 'NR_TITULO_ELEITORAL_CANDIDATO',
                     'DS_SITUACAO_CANDIDATURA', 'DS_SIT_TOT_TURNO', 'SG_FEDERACAO', 'DT_NASCIMENTO',
                     'DS_GENERO', 'DS_COR_RACA', 'DS_GRAU_INSTRUCAO', 'DS_OCUPACAO']],
        left_on=['ANO_ELEICAO', 'NR_TURNO', 'UE', 'CD_CARGO', 'NR_VOTAVEL'],
        right_on=['ANO_ELEICAO', 'NR_TURNO', 'UE', 'CD_CARGO', 'NR_CANDIDATO'],
        how='left', suffixes=('', '_C'), validate='many_to_one')

    # Onde o bronze já tinha SQ, ele manda; o consulta_cand entra como reforço.
    m['SQ_CANDIDATO'] = m['SQ_CANDIDATO'].fillna(m['SQ_CANDIDATO_C'])
    enriquecido = m['SQ_CANDIDATO'].map(cand_por_sq['NR_TITULO_ELEITORAL_CANDIDATO'])
    m['NR_TITULO_ELEITORAL_CANDIDATO'] = enriquecido.fillna(m['NR_TITULO_ELEITORAL_CANDIDATO']).fillna(por_sq)
    # O SQ é exato e identifica a pessoa; o trio (ano, turno, município, cargo, número)
    # só vale onde não há SQ (2024). Por isso o SQ manda nos atributos — com o trio na
    # frente, o mesmo número reaproveitado numa eleição suplementar do mesmo ano
    # devolvia o nome da outra pessoa, e o `SK_POLITICO` (que sai do SQ) discordava do
    # nome da mesma linha. O casamento é por (SQ, turno): o mesmo SQ aparece uma vez
    # por turno, cada uma com a sua situação (Teresina foi a 2º turno em 2020).
    indice = pd.MultiIndex.from_arrays([m['SQ_CANDIDATO'], m['NR_TURNO']])
    for col in ['NM_CANDIDATO', 'NM_URNA_CANDIDATO', 'DS_SITUACAO_CANDIDATURA',
                'DS_SIT_TOT_TURNO', 'SG_FEDERACAO', 'DT_NASCIMENTO', 'DS_GENERO',
                'DS_COR_RACA', 'DS_GRAU_INSTRUCAO', 'DS_OCUPACAO']:
        pelo_sq = pd.Series(sq_turno[col].reindex(indice).values, index=m.index)
        m[col] = pelo_sq.fillna(m[col])

    # Só voto nominal tem candidato. Legenda, branco e nulo não podem herdar
    # atributos de pessoa: o número de legenda é o do partido e pode coincidir
    # com o número de algum candidato, o que atribuiria a mesma pessoa a duas
    # linhas da mesma disputa.
    e_nominal = m['TP_VOTO'].eq('Nominal')
    for col in ['SQ_CANDIDATO', 'NR_TITULO_ELEITORAL_CANDIDATO', 'NM_CANDIDATO',
                'NM_URNA_CANDIDATO', 'DS_SITUACAO_CANDIDATURA', 'DS_SIT_TOT_TURNO',
                'SG_FEDERACAO', 'DT_NASCIMENTO', 'DS_GENERO', 'DS_COR_RACA',
                'DS_GRAU_INSTRUCAO', 'DS_OCUPACAO']:
        m[col] = m[col].where(e_nominal)

    # --- nomes canônicos ---------------------------------------------------
    nominal = m['TP_VOTO'].eq('Nominal')
    legenda = m['TP_VOTO'].eq('Legenda')

    # O nome legal do consulta_cand vale para todos os anos; sem ele 2024
    # ficaria só com o nome de urna e não casaria com 2018-2022.
    m['TP_NOME_ORIGEM'] = pd.NA
    m.loc[nominal, 'TP_NOME_ORIGEM'] = m.loc[nominal, 'NM_CANDIDATO'].notna().map(
        {True: 'legal', False: 'urna'})
    nome = m['NM_CANDIDATO'].where(nominal & m['NM_CANDIDATO'].notna(), m['NM_VOTAVEL'])

    # Legenda: usa o nome canônico do partido, em vez do que cada ano gravou
    # (nome completo em 2018-2022, sigla em 2024).
    nomes_partido = dim_partido.set_index('SK_PARTIDO')['NM_PARTIDO']
    sk_part = m.merge(dim_partido_ano[['ANO_ELEICAO', 'NR_PARTIDO', 'SK_PARTIDO']],
                      on=['ANO_ELEICAO', 'NR_PARTIDO'], how='left',
                      validate='many_to_one')['SK_PARTIDO']
    m['SK_PARTIDO'] = sk_part.values
    nome = nome.where(~legenda, m['SK_PARTIDO'].map(nomes_partido))

    # Branco e Nulo ganham rótulo único, senão viram duas séries entre anos.
    nome = nome.where(~m['TP_VOTO'].isin(['Branco', 'Nulo']), m['TP_VOTO'])
    m['NM_VOTAVEL'] = canon.texto(nome)
    m['NM_VOTAVEL_CHAVE'] = canon.chave(m['NM_VOTAVEL'])
    m['NM_URNA'] = canon.texto(m['NM_URNA_CANDIDATO'])

    # Situação do registro: informativa. Em 2024 o TSE publica como "#NE", então
    # fica nula — desconhecida, não "apta".
    situ = m['DS_SITUACAO_CANDIDATURA'].astype('string')
    m['FL_CANDIDATURA_APTA'] = situ.eq('APTO').where(situ.notna() & nominal).astype('boolean')

    # Se o voto entrou nos válidos oficiais — é isto, e não a situação do
    # registro, que reproduz os percentuais publicados pelo TSE.
    dest, _ = destinacao_oficial()
    m['FL_VOTO_VALIDO'] = m['SQ_CANDIDATO'].map(dest).where(nominal).astype('boolean')
    # Candidatura que não consta do arquivo oficial de votação é tratada como
    # anulada. Vale para a maioria dos casos (Elizeu Aguiar em 2018, Diego Melo
    # em 2022), mas erra em 2024, onde 57 candidaturas somem do arquivo sem
    # terem sido anuladas — daí o resíduo de ~0,3% documentado no dicionário.
    # Nenhum campo publicado distingue os dois casos; para o número oficial
    # exato use fato_oficial_munzona.
    m.loc[nominal & m['FL_VOTO_VALIDO'].isna(), 'FL_VOTO_VALIDO'] = False
    # Presidente não passa por esse arquivo — `votacao_candidato_munzona_<ano>_PI` não
    # o lista, então a regra acima o trataria como anulado. Aqui vale a apuração: voto
    # em candidatura com resultado (eleito, não eleito, 2º turno) é válido; sem
    # resultado (substituída, renunciada, indeferida) o TSE o conta como nulo.
    pres = nominal & m['CD_CARGO'].eq(esquema.CD_CARGO_PRESIDENTE)
    m.loc[pres, 'FL_VOTO_VALIDO'] = m.loc[pres, 'DS_SIT_TOT_TURNO'].notna()

    m['FL_ELEITO'] = m['DS_SIT_TOT_TURNO'].str.upper().str.startswith('ELEITO')
    m['FL_ELEITO'] = m['FL_ELEITO'].where(nominal, pd.NA).astype('boolean')
    m['NR_IDADE'] = _idade(m['DT_NASCIMENTO'], m['ANO_ELEICAO'])

    # --- SK_VOTAVEL --------------------------------------------------------
    # Branco/Nulo: chave global fixa. Demais: ordenados pela chave natural.
    especial = {'Branco': esquema.SK_VOTAVEL_BRANCO, 'Nulo': esquema.SK_VOTAVEL_NULO}
    m['SK_VOTAVEL'] = m['TP_VOTO'].map(especial).astype('Int32')
    reais = m[m['SK_VOTAVEL'].isna()].sort_values(chave)
    m.loc[reais.index, 'SK_VOTAVEL'] = range(1, len(reais) + 1)
    m['SK_VOTAVEL'] = m['SK_VOTAVEL'].astype('int32')

    # Colapsa Branco/Nulo em duas linhas globais.
    esp = m[m['TP_VOTO'].isin(['Branco', 'Nulo'])].drop_duplicates('TP_VOTO').copy()
    for c in ['SK_ELEICAO', 'CD_MUNICIPIO_UE', 'CD_CARGO', 'NR_VOTAVEL', 'SQ_CANDIDATO',
              'SK_PARTIDO', 'NM_URNA', 'TP_NOME_ORIGEM', 'DS_SITUACAO_CANDIDATURA',
              'FL_CANDIDATURA_APTA', 'FL_VOTO_VALIDO', 'DS_SIT_TOT_TURNO',
              'DS_GENERO', 'DS_COR_RACA', 'DS_GRAU_INSTRUCAO', 'DS_OCUPACAO',
              'NR_IDADE', 'SG_FEDERACAO']:
        esp[c] = pd.NA
    dim = pd.concat([m[~m['TP_VOTO'].isin(['Branco', 'Nulo'])], esp], ignore_index=True)

    # --- político (título de eleitor) --------------------------------------
    titulo = dim['NR_TITULO_ELEITORAL_CANDIDATO']
    unicos = sorted(titulo.dropna().unique())
    mapa = {t: i for i, t in enumerate(unicos, start=1)}
    dim['SK_POLITICO'] = titulo.map(mapa).astype('Int32')

    pol = (dim[dim['SK_POLITICO'].notna()]
           .sort_values(['SK_POLITICO', 'ANO_ELEICAO'])
           .groupby('SK_POLITICO')
           .agg(NM_POLITICO=('NM_VOTAVEL', 'last'),
                # Anos distintos, não SK_ELEICAO: o 2º turno é outra eleição na base, e quem
                # disputou os dois turnos de 2022 disputou UMA eleição em 2022.
                QT_ELEICOES=('ANO_ELEICAO', 'nunique'),
                ANOS_PRESENTE=('ANO_ELEICAO', lambda s: ','.join(map(str, sorted(set(s))))))
           .reset_index())
    pol['NM_POLITICO_CHAVE'] = canon.chave(pol['NM_POLITICO'])
    pol['QT_ELEICOES'] = pol['QT_ELEICOES'].astype('int8')
    dim_politico = esquema.aplica(pol, 'dim_politico')

    dim_votavel = esquema.aplica(dim, 'dim_votavel').sort_values('SK_VOTAVEL').reset_index(drop=True)
    _verifica(dim_votavel, m, chave)
    return dim_votavel, dim_politico


def _verifica(dim, original, chave):
    assert dim['SK_VOTAVEL'].is_unique, 'SK_VOTAVEL duplicado'
    reais = dim[dim['SK_VOTAVEL'] > 0]
    assert not reais.duplicated(subset=chave).any(), 'chave natural de votável duplicada'
    # Nenhum SK_VOTAVEL pode atravessar duas eleições.
    assert reais.groupby('SK_VOTAVEL')['SK_ELEICAO'].nunique().max() == 1
    nominal = reais[reais['TP_VOTO'] == 'Nominal']
    sem_pessoa = nominal['SK_POLITICO'].isna().sum()
    assert sem_pessoa == 0, f'{sem_pessoa} votáveis nominais sem título de eleitor'
