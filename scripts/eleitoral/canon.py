"""Normalização de texto e valores compartilhada por todos os anos.

Reúne os helpers que estavam duplicados nos quatro `consolida_<ano>.py`.
"""

import re
import unicodedata

import pandas as pd

# Sentinelas que o TSE usa no lugar de nulo em campos numéricos-como-texto.
# '-4' marca dado suprimido por proteção de dados pessoais — é o que aparece no
# lugar do CPF nos arquivos de candidatura a partir de 2024.
VAZIOS = ['-1', '-3', '-4', '0', '00000000', '000000000']

# Caixa delimitadora do Piauí, para descartar coordenada fora do estado.
BBOX_PI = {'lat': (-11.5, -2.5), 'lon': (-46.5, -40.0)}

# Palavras que ficam em minúscula no meio de um nome próprio em pt-BR.
_MINUSCULAS = {'de', 'da', 'do', 'das', 'dos', 'e', 'du', 'del', 'em', 'a'}

_ESPACOS = re.compile(r'\s+')


def texto(s):
    """Normaliza para exibição: NFC, sem espaço nas pontas, sem espaço duplo."""
    if isinstance(s, pd.Series):
        out = s.astype('string').str.normalize('NFC').str.strip()
        return out.str.replace(_ESPACOS, ' ', regex=True)
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return None
    return _ESPACOS.sub(' ', unicodedata.normalize('NFC', str(s)).strip())


def chave(s):
    """Normaliza para casamento: sem acento, maiúsculo, sem pontuação.

    Usado apenas para construir chaves de junção — nunca para exibir. Resolve,
    por exemplo, "JOSÉ ... ARAÚJO" (2018) contra "JOSE ... ARAUJO" (2022), que
    são a mesma pessoa.
    """
    def _uma(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return None
        v = unicodedata.normalize('NFKD', str(v))
        v = ''.join(c for c in v if not unicodedata.combining(c))
        v = re.sub(r'[^A-Za-z0-9 ]', ' ', v)
        return _ESPACOS.sub(' ', v).strip().upper()

    if isinstance(s, pd.Series):
        return s.map(_uma, na_action='ignore').astype('string')
    return _uma(s)


def titulo_ptbr(s):
    """Title Case respeitando as preposições do português."""
    def _uma(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return None
        palavras = _ESPACOS.sub(' ', str(v).strip()).split(' ')
        saida = []
        for i, p in enumerate(palavras):
            baixa = p.lower()
            saida.append(baixa if i > 0 and baixa in _MINUSCULAS else baixa.capitalize())
        return ' '.join(saida)

    if isinstance(s, pd.Series):
        return s.map(_uma, na_action='ignore').astype('string')
    return _uma(s)


def limpa_sentinela(s, extras=()):
    """Troca os sentinelas do TSE por nulo."""
    return s.where(~s.isin(list(VAZIOS) + list(extras)))


def coordenada(serie_lat, serie_lon):
    """Converte para float e anula o que cai fora do Piauí.

    O TSE usa -1 como ausência de coordenada; o bbox descarta também eventuais
    geocodificações erradas que caem em outro estado.
    """
    lat = pd.to_numeric(serie_lat, errors='coerce')
    lon = pd.to_numeric(serie_lon, errors='coerce')
    ok = lat.between(*BBOX_PI['lat']) & lon.between(*BBOX_PI['lon'])
    return lat.where(ok), lon.where(ok)


def primeiro(s):
    """Primeiro valor não nulo — para agregação."""
    nn = s.dropna()
    return nn.iloc[0] if len(nn) else pd.NA


def moda(s):
    """Valor mais frequente — para agregação de atributos textuais."""
    nn = s.dropna()
    if not len(nn):
        return pd.NA
    m = nn.mode()
    return m.iloc[0] if len(m) else pd.NA


def rotulo_voto(tp_voto, nm_votavel):
    """Rótulo canônico do votável.

    2018-2022 gravam "VOTO BRANCO"/"VOTO NULO"; 2024 grava "Branco"/"Nulo".
    Sem isso a mesma categoria vira duas séries no dashboard.
    """
    if tp_voto == 'Branco':
        return 'Branco'
    if tp_voto == 'Nulo':
        return 'Nulo'
    return nm_votavel
