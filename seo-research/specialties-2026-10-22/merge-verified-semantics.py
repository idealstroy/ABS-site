from pathlib import Path
import importlib.util
root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('preserve',Path(__file__).parent/'preserve-workbooks.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.QA=root/'tmp/specialties-content-2026-10-22'
m.merge('Семантическое ядро Сайт АБС.xlsx')
