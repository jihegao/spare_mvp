"""Preflight reuses only the exact branch that already crossed the exporter."""
import copy
import unittest
from unittest import mock

from src.spare_mvp_backend.api import BackendApiError
from src.spare_mvp_backend.project_payload import strip_project_sweep
from src.spare_mvp_backend.run_service import _compile_runtime_config, _export_project_for_model_family
from tests import test_backend_api_contract as fixtures


class ExperimentCreationPreflightTest(unittest.TestCase):
    setUp = fixtures.BackendApiContractTest.setUp
    tearDown = fixtures.BackendApiContractTest.tearDown

    def test_reused_export_preserves_runtime_config_and_isolation(self):
        project = fixtures.small_aircraft_support_project('creation-reuse')
        plan = {'config': {'projectJson': project, 'samples': 50, 'seed': 7}}
        original = copy.deepcopy(plan)
        exported, _ = _export_project_for_model_family(strip_project_sweep(project), 'aircraft_support_v1')
        old = _compile_runtime_config(plan, model_family='aircraft_support_v1')
        new = _compile_runtime_config(plan, model_family='aircraft_support_v1', exported_branch_project=exported)
        self.assertEqual(old, new)
        self.assertEqual(plan, original)
        new['projectJson']['projectInfo']['name'] = 'changed'
        self.assertNotEqual(exported['projectInfo']['name'], 'changed')

    def test_preflight_exports_matching_branch_only_once(self):
        project = fixtures.small_aircraft_support_project('creation-one-export')
        self.api.save_project(project)
        plan = self.api.create_experiment_plan(project['project_id'], {'projectJson': project, 'samples': 2})
        with mock.patch('src.spare_mvp_backend.run_service._export_project_for_model_family', wraps=_export_project_for_model_family) as exporter:
            result = self.api.compile_project_preflight(project['project_id'], experiment_plan_id=plan['experiment_plan_id'])
        self.assertEqual(result['status'], 'compiled')
        self.assertEqual(exporter.call_count, 1)

    def test_frozen_branch_reuse_does_not_substitute_snapshot_or_live_project(self):
        project = fixtures.small_aircraft_support_project('creation-frozen-branch')
        project['projectInfo']['name'] = 'snapshot name'
        self.api.save_project(project)
        branch = copy.deepcopy(project)
        branch['projectInfo']['name'] = 'branch name'
        plan = self.api.create_experiment_plan(project['project_id'], {'projectJson': branch, 'samples': 2})
        self.api.freeze_experiment_plan(project['project_id'], plan['experiment_plan_id'])
        project['projectInfo']['name'] = 'live name'
        project['supportActivities'] = []
        self.api.save_project(project)
        self.adapter.compile_calls.clear()
        self.adapter.compile_runtime_configs.clear()
        with mock.patch('src.spare_mvp_backend.run_service._export_project_for_model_family', wraps=_export_project_for_model_family) as exporter:
            result = self.api.compile_project_preflight(project['project_id'], experiment_plan_id=plan['experiment_plan_id'])
        self.assertEqual(result['status'], 'compiled')
        self.assertEqual(exporter.call_count, 1)
        self.assertEqual(self.adapter.compile_calls[0][0]['projectInfo']['name'], 'branch name')
        self.assertEqual(self.adapter.compile_runtime_configs[0]['projectJson']['projectInfo']['name'], 'branch name')
        self.assertEqual(self.repository.get_project(project['project_id'])['projectInfo']['name'], 'live name')

    def test_branchless_plan_keeps_snapshot_fallback(self):
        project = fixtures.small_aircraft_support_project('creation-snapshot')
        self.api.save_project(project)
        plan = self.api.create_experiment_plan(project['project_id'], {'samples': 2})
        project['supportActivities'] = []
        self.api.save_project(project)
        with mock.patch('src.spare_mvp_backend.run_service._compile_runtime_config', wraps=_compile_runtime_config) as compile_config:
            result = self.api.compile_project_preflight(project['project_id'], experiment_plan_id=plan['experiment_plan_id'])
        self.assertEqual(result['status'], 'compiled')
        self.assertIsNone(compile_config.call_args.kwargs['exported_branch_project'])

    def test_missing_branch_project_id_keeps_original_export_validation(self):
        project = fixtures.small_aircraft_support_project('creation-missing-id')
        self.api.save_project(project)
        branch = copy.deepcopy(project)
        del branch['project_id']
        branch['scenarioId'] = project['project_id']
        plan = self.api.create_experiment_plan(project['project_id'], {'projectJson': branch, 'samples': 2})
        try:
            old_config = _compile_runtime_config(plan, model_family='aircraft_support_v1')
        except ValueError:
            old_config = None
        self.adapter.compile_runtime_configs.clear()
        with (
            mock.patch('src.spare_mvp_backend.run_service._compile_runtime_config', wraps=_compile_runtime_config) as compile_config,
            mock.patch('src.spare_mvp_backend.run_service._export_project_for_model_family', wraps=_export_project_for_model_family) as exporter,
        ):
            result = self.api.compile_project_preflight(project['project_id'], experiment_plan_id=plan['experiment_plan_id'])
        self.assertIsNone(compile_config.call_args.kwargs['exported_branch_project'])
        self.assertEqual(exporter.call_count, 2)
        if old_config is None:
            self.assertEqual(result['status'], 'blocked')
        else:
            self.assertEqual(self.adapter.compile_runtime_configs[0], old_config)

    def test_reuse_does_not_bypass_exporter_or_adapter_validation(self):
        for invalid_kind in ['export', 'adapter']:
            with self.subTest(invalid_kind=invalid_kind):
                project = fixtures.small_aircraft_support_project('creation-invalid-' + invalid_kind)
                self.api.save_project(project)
                branch = copy.deepcopy(project)
                if invalid_kind == 'export':
                    branch['supportOrganization'] = 'invalid'
                else:
                    branch['supportActivities'] = []
                plan = self.api.create_experiment_plan(project['project_id'], {'samples': 2})
                plan['config']['projectJson'] = branch
                self.repository.upsert_experiment_plan(plan)
                result = self.api.compile_project_preflight(project['project_id'], experiment_plan_id=plan['experiment_plan_id'])
                self.assertEqual(result['status'], 'blocked')
                expected = 'invalid_clean_project' if invalid_kind == 'export' else 'missing_support_activities'
                self.assertIn(expected, {issue['code'] for issue in result['issues']})

    def test_wrong_project_branch_is_still_rejected_before_reuse(self):
        project = fixtures.small_aircraft_support_project('creation-owner')
        self.api.save_project(project)
        branch = copy.deepcopy(project)
        branch['project_id'] = 'different-owner'
        plan = self.api.create_experiment_plan(project['project_id'], {'projectJson': branch, 'samples': 2})
        with self.assertRaises(BackendApiError) as caught:
            self.api.compile_project_preflight(project['project_id'], experiment_plan_id=plan['experiment_plan_id'])
        self.assertEqual(caught.exception.code, 'project_plan_mismatch')
