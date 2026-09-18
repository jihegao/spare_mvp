"""Verify authenticated ownership at the HTTP boundary, without trusting request claims."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from threading import Thread
from tests import test_backend_http_api as http_helpers
from src.spare_mvp_backend.http_server import create_backend_server
from src.spare_mvp_backend.api import BackendApi
from src.spare_mvp_backend.repository import ContractRepository
from src.spare_mvp_contract.adapter import SimulationAdapter


class ExperimentPermissionsHttpTest(unittest.TestCase):
    _json = http_helpers.BackendHttpApiTest._json
    _json_error_with_status = http_helpers.BackendHttpApiTest._json_error_with_status
    _login_token = http_helpers.BackendHttpApiTest._login_token

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.database = Path(self.tmp.name) / 'test.sqlite3'
        self.server = create_backend_server(('127.0.0.1', 0), database_path=self.database,
            output_dir=Path(self.tmp.name) / 'artifacts', repo_root=Path(__file__).resolve().parents[1])
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_address[1]}/api'
        self.tokens = {role: self._login_token(self.base, role, role) for role in ['user', 'data', 'admin']}
        self.project = http_helpers.small_aircraft_support_project('http-permissions')
        self._json(self.base, 'POST', '/projects', self.project, auth_token=self.tokens['data'])
        self.path = '/projects/http-permissions/experiment-plans'
        self.config = {'name': 'permissions', 'projectJson': self.project, 'samples': 2, 'parallelCores': 2}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.tmp.cleanup()

    def create(self, role='user'):
        return self._json(self.base, 'POST', self.path,
            {'created_by': 'user-admin', 'config': {**self.config, 'created_by': 'user-admin'}},
            auth_token=self.tokens[role])

    def test_forged_creator_is_ignored_owner_survives_update_and_deletes_own_only(self):
        own = self.create()
        other = self.create('data')
        self.assertEqual(own['created_by'], 'user-basic')
        self.assertNotEqual(own['experiment_plan_id'], other['experiment_plan_id'])
        own_path = self.path + '/' + own['experiment_plan_id']
        updated = self._json(self.base, 'PUT', own_path, {'config': self.config, 'created_by': 'user-data'}, auth_token=self.tokens['user'])
        self.assertEqual(updated['created_by'], 'user-basic')
        status, error = self._json_error_with_status(self.base, 'DELETE', self.path + '/' + other['experiment_plan_id'], auth_token=self.tokens['user'])
        self.assertEqual((status, error['code']), (403, 'forbidden'))
        self._json(self.base, 'DELETE', own_path, auth_token=self.tokens['user'])
        remaining = self._json(self.base, 'GET', self.path)['experiment_plans']
        self.assertEqual([p['experiment_plan_id'] for p in remaining], [other['experiment_plan_id']])

    def test_all_roles_unfreeze_and_project_mismatch_does_not_change_frozen_plan(self):
        plan = self.create()
        path = self.path + '/' + plan['experiment_plan_id']
        for role in ['user', 'data', 'admin']:
            self._json(self.base, 'POST', path + '/freeze', auth_token=self.tokens['user'])
            status, error = self._json_error_with_status(self.base, 'POST', path.replace('http-permissions/', 'wrong-project/', 1) + '/unfreeze', auth_token=self.tokens[role])
            self.assertEqual(error['code'], 'experiment_plan_project_mismatch')
            frozen = self._json(self.base, 'GET', self.path)['experiment_plans'][0]
            self.assertEqual(frozen['status'], 'frozen')
            draft = self._json(self.base, 'POST', path + '/unfreeze', auth_token=self.tokens[role])
            self.assertEqual(draft['status'], 'draft')
            self.assertNotIn('canonical_fingerprint', draft)
            self.assertEqual(draft['created_by'], 'user-basic')
        status, error = self._json_error_with_status(self.base, 'POST', path + '/unfreeze')
        self.assertEqual((status, error['code']), (401, 'unauthorized'))

    def test_legacy_unowned_plan_is_not_claimed_and_remains_admin_deletable(self):
        with sqlite3.connect(self.database) as connection:
            api = BackendApi(ContractRepository(connection), SimulationAdapter(), output_dir=Path(self.tmp.name) / 'artifacts')
            legacy = api.create_experiment_plan('http-permissions', self.config)
        path = self.path + '/' + legacy['experiment_plan_id']
        status, error = self._json_error_with_status(self.base, 'DELETE', path, auth_token=self.tokens['user'])
        self.assertEqual((status, error['code']), (403, 'forbidden'))
        self._json(self.base, 'DELETE', path, auth_token=self.tokens['admin'])
