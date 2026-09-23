"""Authenticated experiment ownership and reversible freeze permissions."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from src.spare_mvp_backend.api import BackendApi
from src.spare_mvp_backend.errors import BackendApiError
from src.spare_mvp_backend.repository import ContractRepository, initialize_database
from src.spare_mvp_contract.adapter import SimulationAdapter
from tests.test_backend_api_contract import small_aircraft_support_project


class ExperimentPermissionsTest(unittest.TestCase):
    def setUp(self):
        self.connection = sqlite3.connect(':memory:')
        initialize_database(self.connection)
        self.repository = ContractRepository(self.connection)
        self.temp = tempfile.TemporaryDirectory()
        self.api = BackendApi(self.repository, SimulationAdapter(), output_dir=Path(self.temp.name))
        self.project = small_aircraft_support_project('permissions-project')
        self.api.save_project(self.project)
        self.config = {'name': 'shared name', 'projectJson': self.project, 'samples': 2, 'parallelCores': 2}

    def tearDown(self):
        self.connection.close()
        self.temp.cleanup()

    def create(self, actor='user-basic', *, name=None):
        config = {
            **self.config,
            'name': name or f"shared name {actor or 'legacy'}",
        }
        return self.api.create_experiment_plan(self.project['project_id'], config, actor_user_id=actor)

    def test_owner_is_preserved_and_own_plan_can_be_deleted(self):
        plan = self.create()
        self.assertEqual(plan['created_by'], 'user-basic')
        updated = self.api.update_experiment_plan(self.project['project_id'], plan['experiment_plan_id'], self.config)
        self.assertEqual(updated['created_by'], 'user-basic')
        self.api.delete_experiment_plan(self.project['project_id'], plan['experiment_plan_id'], actor_user_id='user-basic')
        with self.assertRaises(KeyError):
            self.repository.get_experiment_plan(plan['experiment_plan_id'])

    def test_users_do_not_collide_and_cannot_delete_other_or_legacy_plan(self):
        own = self.create()
        other = self.create('user-admin')
        legacy = self.create(None)
        self.assertEqual(len({p['experiment_plan_id'] for p in [own, other, legacy]}), 3)
        for plan in [other, legacy]:
            with self.assertRaises(BackendApiError) as caught:
                self.api.delete_experiment_plan(self.project['project_id'], plan['experiment_plan_id'], actor_user_id='user-basic')
            self.assertEqual(caught.exception.code, 'forbidden')
        self.api.delete_experiment_plan(self.project['project_id'], legacy['experiment_plan_id'], actor_user_id='user-admin')

    def test_unknown_plan_delete_returns_structured_not_found(self):
        for actor in ['user-basic', 'user-admin']:
            with self.subTest(actor=actor):
                with self.assertRaises(BackendApiError) as caught:
                    self.api.delete_experiment_plan(
                        self.project['project_id'], 'missing-plan', actor_user_id=actor,
                    )
                self.assertEqual(caught.exception.code, 'experiment_plan_not_found')
                self.assertEqual(caught.exception.details['experiment_plan_id'], 'missing-plan')
                self.assertEqual(caught.exception.details['project_id'], self.project['project_id'])

    def test_all_roles_unfreeze_and_clear_fingerprint_but_preserve_owner(self):
        for actor in ['user-basic', 'user-admin', 'user-data']:
            plan = self.create(name=f'unfreeze {actor}')
            frozen = self.api.freeze_experiment_plan(self.project['project_id'], plan['experiment_plan_id'])
            self.assertEqual(frozen['status'], 'frozen')
            draft = self.api.unfreeze_experiment_plan(self.project['project_id'], plan['experiment_plan_id'], actor_user_id=actor)
            self.assertEqual(draft['status'], 'draft')
            self.assertEqual(draft['created_by'], 'user-basic')
            self.assertNotIn('canonical_fingerprint', draft)
            self.assertNotIn('frozen_at', draft)
            self.assertEqual(self.repository.get_experiment_plan(plan['experiment_plan_id']), draft)

    def test_wrong_project_and_unknown_actor_cannot_unfreeze(self):
        plan = self.create()
        self.api.freeze_experiment_plan(self.project['project_id'], plan['experiment_plan_id'])
        for project, actor in [('wrong', 'user-basic'), (self.project['project_id'], 'unknown')]:
            with self.assertRaises(BackendApiError):
                self.api.unfreeze_experiment_plan(project, plan['experiment_plan_id'], actor_user_id=actor)
        self.assertEqual(self.repository.get_experiment_plan(plan['experiment_plan_id'])['status'], 'frozen')
