"""The optimized executor must retain the accepted V2 business semantics."""
import copy
import json
from pathlib import Path
import unittest

from src.spare_mvp_backend.project_payload import ProjectJsonExporter
from src.spare_mvp_contract.adapter import SimulationAdapter
from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model
from src.spare_mvp_abm.aircraft_support_v1.compiled_runtime import CompiledSimulation
from tests.test_compiled_runtime import CheckedCompiledModel, core_result, terminal_state
from tests.test_aircraft_support_v1_model import _vertical_organization_inputs

ROOT = Path(__file__).resolve().parents[1]


def v2_inputs():
    project = json.loads((ROOT / 'tests/fixtures/aircraft_support_v1_operations_project.json').read_text())
    exported = ProjectJsonExporter(repo_root=ROOT).export(project)
    inputs = SimulationAdapter(ROOT).compile_scenario(exported)['simulation_inputs']
    inputs.update(disable_visualization_frames=True, write_event_snapshots=True)
    return inputs


class CompiledV2RuntimeTests(unittest.TestCase):
    def test_daily_operations_and_midnight_match_reference_with_isolated_samples(self):
        for case in ('daily', 'empty-phases', 'midnight', 'resource-constrained'):
            inputs = v2_inputs()
            if case == 'empty-phases':
                for activity in inputs['support_activities']['activities']:
                    if activity.get('operations_phase'):
                        activity['jobs'] = []
            if case == 'midnight':
                inputs['time']['duration_minutes'] = 3000
                inputs['stop_policy'] = {'mode': 'or', 'conditions': [{'type': 'duration', 'duration_minutes': 3000}]}
                item = inputs['mission_profile']['composite_tasks'][0]['taskItems'][0]
                item.update(firstWaveTime='23:20', intervalHours=38 / 60)
                for activity in inputs['support_activities']['activities']:
                    if activity.get('operations_phase') == 'relaunch':
                        for job in activity['jobs']:
                            job['durationMinutes'] = 20
                inputs['mission_profile']['mission_calendar'].append({'day_index': 2, 'composite_task_id': 'daily'})
            if case == 'resource-constrained':
                for node in inputs['support_network']['nodes']:
                    node['personnel_capacity'] = 1
                    node['equipment_capacity'] = 1
            shared = CompiledSimulation.compile(inputs)
            pristine = copy.deepcopy(shared)
            for seed in (1, 7):
                with self.subTest(case=case, seed=seed):
                    seeded = dict(inputs, seed=seed)
                    reference = AircraftSupportV1Model(seeded)
                    optimized = CheckedCompiledModel(seeded, shared)
                    self.assertEqual(core_result(reference.run()), core_result(optimized.run()))
                    self.assertEqual(terminal_state(reference), terminal_state(optimized))
                    self.assertEqual(shared, pristine)
                    self.assertGreater(optimized.invariant_checks, 0)
                    self.assertEqual(reference.spare_immediately_filled_total, optimized.spare_immediately_filled_total)
                    if case == 'daily':
                        self.assertEqual([j.operations_phase for j in optimized.jobs if j.operations_phase], ['preflight', 'relaunch', 'postflight'])


    def test_nonzero_immediate_fill_and_later_remote_supply_match_reference(self):
        # Initial fulfillment is historical: a later delivery must not turn a
        # shortage into immediate fulfillment in the triggered executor.
        for local_stock, remote_stock in ((5, 0), (3, 5), (0, 5)):
            with self.subTest(local_stock=local_stock, remote_stock=remote_stock):
                inputs = _vertical_organization_inputs(local_quantity=local_stock, parent_quantity=remote_stock)
                inputs['mission_profile']['basic_missions'] = []
                inputs['time']['duration_minutes'] = 180
                inputs.update(disable_visualization_frames=True, write_event_snapshots=True)
                repair = inputs['support_activities']['activities'][1]
                repair['maintenance_methods'] = ['replacement']
                repair['jobs'][0]['spare'] = [{'product_id': 'shared-spare', 'quantity': 5}]
                shared = CompiledSimulation.compile(inputs)
                reference = AircraftSupportV1Model(inputs)
                optimized = CheckedCompiledModel(inputs, shared)
                for model in (reference, optimized):
                    model.aircraft[0].state = 'maintenance'
                    model._create_job(model.aircraft[0], model.activities[1], kind='repair')
                    if isinstance(model, CheckedCompiledModel):
                        # This test seeds a repair after construction; make its
                        # active index match that explicit initial condition.
                        model._active_jobs = list(model.jobs)
                        model._known_job_ids = {job.job_id for job in model.jobs}
                self.assertEqual(core_result(reference.run()), core_result(optimized.run()))
                self.assertEqual(terminal_state(reference), terminal_state(optimized))
                self.assertEqual(optimized.spare_demand_total, 5)
                self.assertEqual(optimized.spare_consumed_total, 5)
                self.assertEqual(optimized.spare_immediately_filled_total, 5 if local_stock == 5 else 0)
                self.assertEqual(optimized.snapshot()['spare_fill_rate'], 1 if local_stock == 5 else 0)


if __name__ == '__main__':
    unittest.main()
