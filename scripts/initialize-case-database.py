"""Create a new local database through the repository and API boundaries."""
import argparse
import json
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.spare_mvp_backend.api import BackendApi
from src.spare_mvp_backend.repository import ContractRepository, initialize_database
from src.spare_mvp_contract.adapter import SimulationAdapter

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--project', type=Path, help='Optional local clean Project JSON')
    parser.add_argument('--experiment-config', type=Path, help='Optional local experiment settings for --project')
    args = parser.parse_args()
    if args.experiment_config and not args.project:
        parser.error('--experiment-config requires --project')
    if args.database.exists():
        parser.error('Database already exists; refusing to overwrite local state')
    args.database.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(args.database) as connection:
        initialize_database(connection)
        api = BackendApi(ContractRepository(connection), SimulationAdapter(ROOT), output_dir=args.database.parent / 'outputs')
        for name in ['project-minimum-001.json', 'project-case-large.json']:
            project = json.loads((ROOT / 'exports' / name).read_text(encoding='utf-8'))
            api.save_project(project)
        if args.project:
            project = json.loads(args.project.read_text(encoding='utf-8'))
            api.save_project(project)
            if args.experiment_config:
                config = json.loads(args.experiment_config.read_text(encoding='utf-8'))
                plan = api.create_experiment_plan(project['project_id'], config)
                api.freeze_experiment_plan(project['project_id'], plan['experiment_plan_id'])
    print('Initialized template projects and any explicitly supplied local case.')

if __name__ == '__main__':
    main()
