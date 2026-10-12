"""Extrai o Piauí dos arquivos NACIONAIS (BR) do TSE para o cargo de Presidente.

Os arquivos por UF (`votacao_secao_<ano>_PI`, `consulta_cand_<ano>_PI`) não trazem
Presidente: o TSE publica esse cargo só nos arquivos `_BR`. Daqui saem dois arquivos
pequenos por ano, que `consolida_<ano>.py` e `votaveis.py` leem como se fossem do PI:

  dados/<ano>/votacao_secao_<ano>_PRESIDENTE_PI.csv   votos por seção, SG_UF == PI
  dados/brutos_tse/consulta_cand_<ano>_BR.csv         candidatos a Presidente

Os zips nacionais (160-270 MB cada) ficam fora do projeto, em
`ORIGEM` — só este script os lê.

Uso:  python scripts/extrai_presidente.py
"""

import os
import sys
import zipfile

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eleitoral import esquema  # noqa: E402

ORIGEM = r'D:\2.2 Consultoria\Eleição\2026\resultados\presidente'
ANOS = (2018, 2022, 2026)


def extrai_votos(ano):
    destino = os.path.join(esquema.DIR_DADOS, str(ano), f'votacao_secao_{ano}_PRESIDENTE_PI.csv')
    zf = zipfile.ZipFile(os.path.join(ORIGEM, f'votacao_secao_{ano}_BR.zip'))
    nome = f'votacao_secao_{ano}_BR.csv'
    partes, lidas = [], 0
    with zf.open(nome) as f:
        for bloco in pd.read_csv(f, sep=';', encoding='latin1', dtype=str, quotechar='"',
                                 chunksize=500_000):
            bloco.columns = [c.strip() for c in bloco.columns]
            lidas += len(bloco)
            partes.append(bloco[(bloco['SG_UF'] == 'PI') & (bloco['CD_CARGO'] == '1')])
    d = pd.concat(partes, ignore_index=True)
    d.to_csv(destino, sep=';', index=False, encoding='latin1', quoting=1)
    print(f'{ano}: {lidas:,} linhas nacionais -> {len(d):,} do PI '
          f'(turnos {sorted(d["NR_TURNO"].unique())}) -> {destino}')


def extrai_candidatos(ano):
    destino = os.path.join(esquema.DIR_BRUTOS_TSE, f'consulta_cand_{ano}_BR.csv')
    zf = zipfile.ZipFile(os.path.join(ORIGEM, f'consulta_cand_{ano}.zip'))
    with zf.open(f'consulta_cand_{ano}_BR.csv') as f:
        c = pd.read_csv(f, sep=';', encoding='latin1', dtype=str, quotechar='"')
    c = c[c['CD_CARGO'] == '1']
    c.to_csv(destino, sep=';', index=False, encoding='latin1', quoting=1)
    print(f'{ano}: {len(c)} candidatos a Presidente -> {destino}')


if __name__ == '__main__':
    for a in ANOS:
        extrai_votos(a)
        extrai_candidatos(a)
