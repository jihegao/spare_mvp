# Independent Mesa

Standalone Mesa model consuming the 导入示例项目 modeling-import-v1 data package.

## Run

```bash
# Single scenario
.abm-mesa-test-env/bin/python run_single.py --steps 48 --sample-every 4 --seed 20260621

# Monte Carlo sweep
.abm-mesa-test-env/bin/python run_sweep.py --steps 48 --samples 24 --seed 20260621

# Tests
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest discover -s tests -v
```
