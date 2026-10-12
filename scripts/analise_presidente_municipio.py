"""Lula 2022 (x Bolsonaro) e 2026 (x Flávio Bolsonaro) por bairro, escola e seção.

Lê só a base unificada (`public/dados`). Para um município, compara a votação dos dois
pares de candidatos a Presidente no 1º turno, com a variação do Lula em votos e em pontos
percentuais dos votos VÁLIDOS (nominais) do cargo.

Cuidados que a leitura precisa:
  - Variação em votos mistura mudança de comparecimento com mudança de preferência; os
    pontos percentuais do Lula sobre os válidos separam melhor os dois.
  - A numeração das seções muda entre eleições. A comparação por seção só vale onde o
    mesmo número existe na mesma escola nos dois anos; fora disso a unidade comparável
    é a escola (SK_LOCAL), que é estável.
  - O bairro é o do cadastro mais recente do local de votação (igual ao painel).

Uso:  python scripts/analise_presidente_municipio.py [CD_MUNICIPIO]   (padrão 11673, Piripiri)
"""

import os
import subprocess
import sys

import duckdb
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(RAIZ, 'public', 'dados') + os.sep
CD = int(sys.argv[1]) if len(sys.argv) > 1 else 11673

con = duckdb.connect()
for t in ['fato_votos_secao', 'dim_local', 'dim_eleicao', 'dim_votavel', 'dim_local_atual', 'dim_municipio']:
    con.sql(f"create view {t} as select * from '{D}{t}.parquet'")

municipio = con.sql(f'select NM_MUNICIPIO from dim_municipio where CD_MUNICIPIO={CD}').fetchone()[0]

# Eleições gerais (série principal) 2022 e 2026 e os quatro candidatos.
sk = {a: con.sql(f'select SK_ELEICAO from dim_eleicao where ANO_ELEICAO={a} and FL_SERIE_PRINCIPAL').fetchone()[0]
      for a in (2022, 2026)}
CAND = {  # papel -> (ano, nome na base)
    'lula22': (2022, 'LUIZ INÁCIO LULA DA SILVA'), 'rival22': (2022, 'JAIR MESSIAS BOLSONARO'),
    'lula26': (2026, 'LUIZ INÁCIO LULA DA SILVA'), 'rival26': (2026, 'FLAVIO NANTES BOLSONARO'),
}
vot = {}
for papel, (ano, nome) in CAND.items():
    r = con.sql(f"select SK_VOTAVEL from dim_votavel where SK_ELEICAO={sk[ano]} and CD_CARGO=1 "
                f"and TP_VOTO='Nominal' and NM_VOTAVEL='{nome}'").fetchall()
    assert len(r) == 1, f'{papel}: {len(r)} votáveis'
    vot[papel] = r[0][0]

# Votos por (ano, local, seção, candidato) do município, só Presidente.
s = con.sql(f"""
  with loc as (select distinct SK_LOCAL, SK_ELEICAO from dim_local where CD_MUNICIPIO={CD})
  select s.SK_ELEICAO, s.SK_LOCAL, s.NR_SECAO, s.SK_VOTAVEL, s.QT_VOTOS_NORM v
  from fato_votos_secao s
  join loc on loc.SK_LOCAL = s.SK_LOCAL and loc.SK_ELEICAO = s.SK_ELEICAO
  join dim_votavel d on d.SK_VOTAVEL = s.SK_VOTAVEL
  where d.CD_CARGO = 1 and s.SK_ELEICAO in ({sk[2022]}, {sk[2026]})
""").df()
ano_de = {sk[2022]: 2022, sk[2026]: 2026}
s['ano'] = s['SK_ELEICAO'].map(ano_de)
papel_de = {v: k[:-2] for k, v in vot.items()}  # 'lula22' -> 'lula'; o ano já vem na coluna `ano`
s['papel'] = s['SK_VOTAVEL'].map(papel_de).fillna('outros')

# Locais: bairro mais recente e nome de referência.
loc = con.sql(f"""
  select l.SK_LOCAL, la.NM_LOCAL_REF as escola,
         arg_max(coalesce(nullif(trim(l.NM_BAIRRO), ''), 'SEM BAIRRO'), l.SK_ELEICAO) as bairro,
         arg_max(l.NR_ZONA, l.SK_ELEICAO) as zona
  from dim_local l join dim_eleicao e on e.SK_ELEICAO = l.SK_ELEICAO
  join dim_local_atual la on la.SK_LOCAL = l.SK_LOCAL
  where l.CD_MUNICIPIO = {CD} and e.FL_SERIE_PRINCIPAL
  group by l.SK_LOCAL, la.NM_LOCAL_REF
""").df().set_index('SK_LOCAL')


def monta(chaves):
    """Uma linha por unidade, com os votos de cada papel em cada ano."""
    t = (s.groupby(chaves + ['ano', 'papel'])['v'].sum().unstack(['ano', 'papel'], fill_value=0))
    t.columns = [f'{p}{str(a)[2:]}' for a, p in t.columns]
    for c in ['lula22', 'rival22', 'outros22', 'lula26', 'rival26', 'outros26']:
        if c not in t:
            t[c] = 0
    t = t.reset_index()
    for a in ('22', '26'):
        t[f'validos{a}'] = t[f'lula{a}'] + t[f'rival{a}'] + t[f'outros{a}']
        for p in ('lula', 'rival'):
            t[f'{p}{a}_pct'] = (t[f'{p}{a}'] / t[f'validos{a}'] * 100).where(t[f'validos{a}'] > 0)
    t['d_lula_votos'] = t['lula26'] - t['lula22']
    t['d_lula_pp'] = t['lula26_pct'] - t['lula22_pct']
    t['margem22'] = t['lula22_pct'] - t['rival22_pct']
    t['margem26'] = t['lula26_pct'] - t['rival26_pct']
    t['d_margem_pp'] = t['margem26'] - t['margem22']
    return t


# --- município, bairro, escola, seção ---------------------------------------
s['k'] = 1
mun = monta(['k']).drop(columns='k')
mun.insert(0, 'unidade', municipio)

s['bairro'] = s['SK_LOCAL'].map(loc['bairro'])
assert s['bairro'].notna().all(), 'seção de local sem bairro'
bairro = monta(['bairro']).sort_values('d_lula_pp', ascending=False)

escola = monta(['SK_LOCAL'])
escola = escola.merge(loc, left_on='SK_LOCAL', right_index=True).drop(columns='SK_LOCAL')
escola = escola.sort_values('d_lula_pp', ascending=False)

# Seção NÃO é comparável pelo número: a agregação muda entre eleições (a agregada não aparece
# nos votos, que entram na principal) e seções novas surgem por divisão. A comparação é por
# GRUPO de seções, montado em secoes_agregadas_municipio.py a partir do cadastro de eleitorado.
subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                             'secoes_agregadas_municipio.py'), str(CD)], check=True,
               stdout=subprocess.DEVNULL)
secao = pd.read_pickle(os.path.join(RAIZ, 'dados', 'processados', f'_secoes_{CD}.pkl'))['G'].copy()
secao['margem22'] = secao['lula22_pct'] - secao['rival22_pct']
secao['margem26'] = secao['lula26_pct'] - secao['rival26_pct']
assert secao['lula22'].sum() == mun['lula22'].iloc[0] and secao['lula26'].sum() == mun['lula26'].iloc[0],     'grupos de seções não fecham com o total do município'
secao = secao.sort_values(['bairro', 'escola', 'grupo'])

pd.to_pickle({'mun': mun, 'bairro': bairro, 'escola': escola, 'secao': secao},
             os.path.join(RAIZ, 'dados', 'processados', f'_analise_pres_{CD}.pkl'))

# --- Excel -------------------------------------------------------------------
COLS = [
    ('lula22', 'Lula 2022', 'int'), ('rival22', 'Bolsonaro 2022', 'int'), ('validos22', 'Válidos 2022', 'int'),
    ('lula22_pct', 'Lula 2022 %', 'pct'), ('rival22_pct', 'Bolsonaro 2022 %', 'pct'),
    ('lula26', 'Lula 2026', 'int'), ('rival26', 'Flávio 2026', 'int'), ('validos26', 'Válidos 2026', 'int'),
    ('lula26_pct', 'Lula 2026 %', 'pct'), ('rival26_pct', 'Flávio 2026 %', 'pct'),
    ('d_lula_votos', 'Δ Lula (votos)', 'int'), ('d_lula_pp', 'Δ Lula (p.p.)', 'pp'),
    ('margem22', 'Margem Lula−Bolsonaro 2022 (p.p.)', 'pp'), ('margem26', 'Margem Lula−Flávio 2026 (p.p.)', 'pp'),
    ('d_margem_pp', 'Δ margem (p.p.)', 'pp'),
]
FMT = {'int': '#,##0', 'pct': '0.0', 'pp': '+0.0;-0.0;0.0'}
VERDE, VERMELHO = PatternFill('solid', fgColor='FFD9EAD3'), PatternFill('solid', fgColor='FFF4CCCC')

wb = Workbook()
ws = wb.active
ws.title = 'Leia-me'
for i, linha in enumerate([
    f'Presidente em {municipio.title()} — Lula 2022 (x Bolsonaro) e 2026 (x Flávio Bolsonaro), 1º turno',
    '',
    'Fonte: dados abertos do TSE (votação por seção), base unificada eleitoral-pi.',
    'Válidos = votos nominais em candidato a Presidente (exclui branco e nulo). % = sobre os válidos.',
    'Δ Lula (p.p.) = % do Lula em 2026 menos % em 2022. Positivo = Lula cresceu; negativo = diminuiu.',
    'Margem = % do Lula menos % do adversário direto (Bolsonaro em 2022, Flávio em 2026).',
    'Δ em votos mistura comparecimento e preferência; os p.p. isolam melhor a preferência.',
    'Seções: o número da seção NÃO identifica a mesma seção nos dois anos. Seção agregada não aparece',
    'nos votos (entra na principal) e a agregação muda; seções novas surgem por divisão e algumas',
    'trocam de escola. Por isso a aba "Seções (grupos)" compara GRUPOS de seções, ligados por',
    'agregação, mesma numeração e, no caso de seção nova, mesma escola. Veja o detalhe de cada',
    'seção em secoes_agregadas_piripiri_2022_2026.xlsx.',
    'O bairro é o do cadastro mais recente do local de votação.',
], start=1):
    ws.cell(i, 1, linha)
ws['A1'].font = Font(bold=True, size=13)
ws.column_dimensions['A'].width = 110


def aba(nome, df, rotulos, larguras=None):
    larguras = larguras or {}
    w = wb.create_sheet(nome)
    cab = [r for _, r in rotulos] + [t for _, t, _ in COLS]
    w.append(cab)
    for c in w[1]:
        c.font = Font(bold=True, color='FFFFFFFF')
        c.fill = PatternFill('solid', fgColor='FF1F2937')
        c.alignment = Alignment(wrap_text=True, vertical='center')
    for _, r in df.iterrows():
        w.append([r[k] for k, _ in rotulos] + [None if pd.isna(r[k]) else float(r[k]) for k, _, _ in COLS])
    n = len(rotulos)
    for j, (k, _, tipo) in enumerate(COLS, start=n + 1):
        for i in range(2, w.max_row + 1):
            c = w.cell(i, j)
            c.number_format = FMT[tipo]
            if k in ('d_lula_pp', 'd_margem_pp', 'd_lula_votos') and isinstance(c.value, (int, float)):
                if c.value > 0:
                    c.fill = VERDE
                elif c.value < 0:
                    c.fill = VERMELHO
        w.column_dimensions[get_column_letter(j)].width = 15
    for j, (k, _) in enumerate(rotulos, start=1):
        w.column_dimensions[get_column_letter(j)].width = larguras.get(k, 34 if j <= 2 else 14)
    w.row_dimensions[1].height = 45
    w.freeze_panes = w.cell(2, n + 1)
    w.auto_filter.ref = w.dimensions


aba('Município', mun, [('unidade', 'Município')])
aba('Bairros', bairro, [('bairro', 'Bairro')])
aba('Escolas', escola, [('bairro', 'Bairro'), ('escola', 'Escola'), ('zona', 'Zona')])
aba('Seções (grupos)', secao, [
    ('bairro', 'Bairro'), ('escola', 'Escola(s)'), ('grupo', 'Grupo'), ('tipo', 'Tipo'),
    ('principais_2022', 'Seções principais 2022'), ('principais_2026', 'Seções principais 2026'),
    ('agregadas_2022', 'Agregadas 2022'), ('agregadas_2026', 'Agregadas 2026'),
    ('novas_2026', 'Seções novas em 2026'),
], {'bairro': 22, 'escola': 46, 'grupo': 8, 'tipo': 24, 'principais_2022': 24, 'principais_2026': 24,
    'agregadas_2022': 16, 'agregadas_2026': 16, 'novas_2026': 16})

saida = os.path.join(RAIZ, 'dados', 'processados', f'presidente_2022_2026_{municipio.lower().replace(" ", "_")}.xlsx')
wb.save(saida)
print('gravado:', saida)
print(mun.T.to_string())
