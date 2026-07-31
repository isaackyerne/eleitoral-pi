"""Fonte única de verdade para colunas e tipos.

Importado tanto pelos `consolida_<ano>.py` (camada bronze) quanto por
`unifica.py` (star schema), de modo que a ordem das colunas não possa divergir
de novo entre os anos.
"""

import os

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIR_DADOS = os.path.join(RAIZ, 'dados')
DIR_BRONZE = os.path.join(DIR_DADOS, 'processados')
DIR_UNIFICADO = os.path.join(DIR_BRONZE, 'unificado')
DIR_BRUTOS_TSE = os.path.join(DIR_DADOS, 'brutos_tse')
DIR_REFERENCIA = os.path.join(RAIZ, 'scripts', 'referencia')

ANOS = [2018, 2020, 2022, 2024]

# Esferas: define quais anos são estaduais e quais são municipais. Comparar
# volume de voto entre esferas não faz sentido (cargos diferentes), então o
# modelo carrega isso explicitamente.
ESFERA_POR_ANO = {2018: 'Estadual', 2020: 'Municipal', 2022: 'Estadual', 2024: 'Municipal'}

# Cargos majoritários de voto único, usados para derivar comparecimento.
CARGO_COMPARECIMENTO = {'Estadual': 'Governador', 'Municipal': 'Prefeito'}

# Cargos que aceitam voto de legenda.
CARGOS_PROPORCIONAIS = {'Deputado Federal', 'Deputado Estadual', 'Vereador'}

# Vagas em disputa por (ano, cargo). Senador teve 2 vagas em 2018 e 1 em 2022,
# então o total de votos do cargo em 2018 é o dobro do comparecimento.
VAGAS = {
    (2018, 'Governador'): 1, (2018, 'Senador'): 2,
    (2018, 'Deputado Federal'): 10, (2018, 'Deputado Estadual'): 30,
    (2022, 'Governador'): 1, (2022, 'Senador'): 1,
    (2022, 'Deputado Federal'): 10, (2022, 'Deputado Estadual'): 30,
}
# Quantos votos cada eleitor deposita naquele cargo.
VOTOS_POR_ELEITOR = {(2018, 'Senador'): 2}

# ---------------------------------------------------------------------------
# Camada bronze: eleicoes_pi_<ano>.csv
# ---------------------------------------------------------------------------

BRONZE_COLUNAS = [
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

# 2024 vem do Boletim de Urna, que traz duas informações a mais.
BRONZE_EXTRAS_2024 = ['SG_PARTIDO', 'QT_ELEITOR_BIOM_SEM_HABILITACAO']

# Colunas que precisam ser lidas como texto para não perder zero à esquerda.
BRONZE_DTYPES_LEITURA = {
    'NR_VOTAVEL': 'string', 'NR_PARTIDO': 'string', 'NR_CEP': 'string',
    'NR_TELEFONE_LOCAL': 'string', 'SQ_CANDIDATO': 'string', 'ID_LOCAL': 'string',
}


def bronze_colunas(ano):
    return BRONZE_COLUNAS + (BRONZE_EXTRAS_2024 if ano == 2024 else [])


# ---------------------------------------------------------------------------
# Star schema
# ---------------------------------------------------------------------------

FATO_VOTOS = {
    'SK_ELEICAO': 'int16',
    'SK_LOCAL': 'int32',
    'SK_VOTAVEL': 'int32',
    'CD_CARGO': 'int8',
    'QT_VOTOS': 'int32',
    'QT_VOTOS_NORM': 'float32',
}

FATO_LOCAL_CARGO = {
    'SK_ELEICAO': 'int16',
    'SK_LOCAL': 'int32',
    'CD_CARGO': 'int8',
    'QT_VOTOS_TOTAL': 'int32',
    'QT_VOTOS_VALIDOS': 'int32',
    'QT_VOTOS_NOMINAIS': 'int32',
    'QT_VOTOS_LEGENDA': 'int32',
    'QT_VOTOS_BRANCO': 'int32',
    'QT_VOTOS_NULO': 'int32',
    'QT_VOTAVEIS': 'int16',
}

FATO_LOCAL = {
    'SK_ELEICAO': 'int16',
    'SK_LOCAL': 'int32',
    'QT_APTOS': 'Int32',
    'QT_COMPARECIMENTO': 'Int32',
    'QT_ABSTENCAO': 'Int32',
    'QT_SECOES': 'Int16',
    'QT_SECOES_AGREGADAS': 'Int16',
    'QT_SECOES_ACESSIVEIS': 'Int16',
    'QT_ELEITOR_BIOM_SEM_HABILITACAO': 'Int32',
    'PCT_COMPARECIMENTO': 'float32',
    'PCT_ABSTENCAO': 'float32',
}

DIM_ELEICAO = {
    'SK_ELEICAO': 'int16',
    'ANO_ELEICAO': 'int16',
    'CD_ELEICAO': 'int16',
    'DS_ELEICAO': 'string',
    'NM_TIPO_ELEICAO': 'string',
    'NR_TURNO': 'int8',
    'DT_ELEICAO': 'string',
    'TP_ESFERA': 'string',
    'FL_SUPLEMENTAR': 'bool',
    'FL_SERIE_PRINCIPAL': 'bool',
}

DIM_ELEICAO_CARGO = {
    'SK_ELEICAO': 'int16',
    'CD_CARGO': 'int8',
    'DS_CARGO': 'string',
    'QT_VAGAS': 'Int16',
    'QT_VOTOS_POR_ELEITOR': 'int8',
    'FL_ACEITA_LEGENDA': 'bool',
}

DIM_CARGO = {
    'CD_CARGO': 'int8',
    'DS_CARGO': 'string',
    'TP_ESFERA': 'string',
    'TP_SISTEMA': 'string',
}

DIM_MUNICIPIO = {
    'CD_MUNICIPIO': 'int32',
    'NM_MUNICIPIO': 'string',
    'NM_MUNICIPIO_CHAVE': 'string',
}

DIM_LOCAL = {
    'SK_LOCAL': 'int32',
    'SK_ELEICAO': 'int16',
    'ANO_ELEICAO': 'int16',
    'CD_MUNICIPIO': 'int32',
    'NR_ZONA': 'int16',
    'NR_LOCAL_VOTACAO': 'int32',
    'ID_LOCAL_ANO': 'string',
    'NM_LOCAL_VOTACAO': 'string',
    'DS_TIPO_LOCAL': 'string',
    'DS_ENDERECO': 'string',
    'NM_BAIRRO': 'string',
    'NR_CEP': 'string',
    'NR_TELEFONE_LOCAL': 'string',
    'LATITUDE': 'float64',
    'LONGITUDE': 'float64',
    'DS_SITU_LOCAL_VOTACAO': 'string',
    'FL_SITU_AGUARDANDO_PROC': 'bool',
    'FL_LOCAL_REMANEJADO': 'bool',
    'FL_APTOS_ESTIMADO': 'bool',
    'FL_METADADO_AUSENTE': 'bool',
}

DIM_LOCAL_ATUAL = {
    'SK_LOCAL': 'int32',
    'CD_MUNICIPIO': 'int32',
    'NM_LOCAL_REF': 'string',
    'NM_LOCAL_CHAVE': 'string',
    'LATITUDE_REF': 'float64',
    'LONGITUDE_REF': 'float64',
    'ANO_GEO_REF': 'Int16',
    'FL_GEO_DIVERGENTE': 'bool',
    'TP_VINCULO': 'string',
    'ANOS_PRESENTE': 'string',
    'QT_ANOS': 'int8',
    'FL_PAINEL_COMPLETO': 'bool',
    'FL_ZONA_RENUMERADA': 'bool',
}

DIM_PARTIDO = {
    'SK_PARTIDO': 'int16',
    'SG_PARTIDO': 'string',
    'NM_PARTIDO': 'string',
    'NR_PARTIDO_ATUAL': 'Int16',
    'DS_NOTA': 'string',
}

DIM_PARTIDO_ANO = {
    'ANO_ELEICAO': 'int16',
    'NR_PARTIDO': 'string',
    'SK_PARTIDO': 'int16',
    'NM_PARTIDO_ORIGEM': 'string',
    'FL_NUMERO_REATRIBUIDO': 'bool',
}

DIM_VOTAVEL = {
    'SK_VOTAVEL': 'int32',
    'SK_ELEICAO': 'Int16',
    'CD_MUNICIPIO_UE': 'Int32',
    'CD_CARGO': 'Int8',
    'NR_VOTAVEL': 'string',
    'TP_VOTO': 'string',
    'NM_VOTAVEL': 'string',
    'NM_VOTAVEL_CHAVE': 'string',
    'NM_URNA': 'string',
    'TP_NOME_ORIGEM': 'string',
    'SQ_CANDIDATO': 'string',
    'SK_PARTIDO': 'Int16',
    'SK_POLITICO': 'Int32',
    'DS_SIT_TOT_TURNO': 'string',
    'FL_ELEITO': 'boolean',
    'DS_GENERO': 'string',
    'DS_COR_RACA': 'string',
    'DS_GRAU_INSTRUCAO': 'string',
    'DS_OCUPACAO': 'string',
    'NR_IDADE': 'Int16',
    'SG_FEDERACAO': 'string',
}

DIM_POLITICO = {
    'SK_POLITICO': 'int32',
    'NM_POLITICO': 'string',
    'NM_POLITICO_CHAVE': 'string',
    'QT_ELEICOES': 'int8',
    'ANOS_PRESENTE': 'string',
}

TABELAS = {
    'fato_votos': FATO_VOTOS,
    'fato_local_cargo': FATO_LOCAL_CARGO,
    'fato_local': FATO_LOCAL,
    'dim_eleicao': DIM_ELEICAO,
    'dim_eleicao_cargo': DIM_ELEICAO_CARGO,
    'dim_cargo': DIM_CARGO,
    'dim_municipio': DIM_MUNICIPIO,
    'dim_local': DIM_LOCAL,
    'dim_local_atual': DIM_LOCAL_ATUAL,
    'dim_partido': DIM_PARTIDO,
    'dim_partido_ano': DIM_PARTIDO_ANO,
    'dim_votavel': DIM_VOTAVEL,
    'dim_politico': DIM_POLITICO,
}

# Votáveis não-nominais recebem chave global, para que "Nulo em 2020" e
# "Nulo em 2024" sejam a mesma série.
SK_VOTAVEL_BRANCO = -1
SK_VOTAVEL_NULO = -2


def aplica(df, tabela):
    """Reordena e tipa um DataFrame conforme o esquema da tabela."""
    esquema = TABELAS[tabela]
    faltando = [c for c in esquema if c not in df.columns]
    assert not faltando, f'{tabela}: faltam colunas {faltando}'
    return df[list(esquema)].astype(esquema)
