from pathlib import Path
import importlib.util,json
root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('preserve',Path(__file__).parent/'preserve-workbooks.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.QA=root/'tmp/specialties-b2b-clean-2026-10-22'
report=json.loads((m.QA/'clean-report.json').read_text(encoding='utf-8'))
m.merge('Семантическое ядро Сайт АБС.xlsx',replace_rows=report['rowLimits'])
