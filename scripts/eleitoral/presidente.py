"""Linhas de Presidente, anexadas à votação por seção do Piauí.

O TSE publica Presidente só nos arquivos nacionais (`_BR`); `votacao_secao_<ano>_PI`
não o traz. `scripts/extrai_presidente.py` tira do arquivo nacional as linhas do Piauí
(`dados/<ano>/votacao_secao_<ano>_PRESIDENTE_PI.csv`), com o MESMO layout do arquivo
do estado. Aqui elas são empilhadas na votação do ano, antes de qualquer outra coisa,
de modo que daí em diante Presidente é só mais um cargo — passa pelo mesmo vínculo
seção→local, pela mesma classificação de voto e pela mesma agregação.

Um ajuste, para que Presidente caia DENTRO da eleição que já existe:

  - 1º turno: o TSE dá a Presidente um código de eleição próprio (297 para o governo do
    estado, 295 para a eleição geral federal em 2018). Tomamos os campos de eleição das
    linhas estaduais; sem isso `dim_eleicao` ganharia uma "eleição" só de Presidente e o
    cargo não apareceria junto dos demais.
  - 2º turno: não há cargo estadual no mesmo turno para emprestar a eleição. Presidente
    forma a sua própria eleição (CD_ELEICAO 296 em 2018, 545 em 2022), e o arquivo de
    votação desse turno só tem Presidente.

Os totais de Presidente diferem poucos votos dos de Governador no mesmo estado: o
voto em trânsito deixa o eleitor de outra UF votar para Presidente numa seção daqui.
"""

import os

import pandas as pd

from . import esquema

CAMPOS_DA_ELEICAO = [
    'DT_GERACAO', 'HH_GERACAO', 'CD_TIPO_ELEICAO', 'NM_TIPO_ELEICAO', 'CD_ELEICAO',
    'DS_ELEICAO', 'DT_ELEICAO', 'TP_ABRANGENCIA', 'SG_UE', 'NM_UE',
]


def anexa(df, ano, turno='1'):
    """Empilha Presidente do `turno` em `df`, o arquivo de votação do ano lido como texto.

    No 1º turno devolve `df` + Presidente; no 2º, só Presidente (o arquivo do estado não
    tem nada nesse turno). `df` ainda não pode ter `QT_VOTOS` convertido: as linhas
    anexadas chegam como texto. Sem o arquivo de Presidente do ano (2020 e 2024), devolve
    `df` como está no 1º turno e vazio no 2º.
    """
    caminho = os.path.join(esquema.DIR_DADOS, str(ano), f'votacao_secao_{ano}_PRESIDENTE_PI.csv')
    if not os.path.exists(caminho):
        return df if turno == '1' else df.iloc[0:0]
    p = pd.read_csv(caminho, sep=';', encoding='latin1', quotechar='"', dtype=str,
                    na_values=esquema.NA_TSE)
    p.columns = [c.strip() for c in p.columns]
    p = p[p['NR_TURNO'].str.strip() == turno].copy()
    assert len(p), f'{ano}: nenhuma linha de Presidente no {turno}º turno'

    colunas = list(df.columns)
    faltam = [c for c in colunas if c not in p.columns]
    assert not faltam, f'{ano}: o arquivo de Presidente não tem as colunas {faltam}'

    if turno != '1':
        return p[colunas].reset_index(drop=True)

    estadual = df[df['NR_TURNO'].str.strip() == '1']
    assert len(estadual), f'{ano}: votação estadual sem 1º turno'
    ref = estadual.iloc[0]
    for c in CAMPOS_DA_ELEICAO:
        if c in colunas:
            p[c] = ref[c]
    return pd.concat([df, p[colunas]], ignore_index=True)
