import numpy as np
import random
from copy import deepcopy
from typing import Dict, List, Optional, Tuple
from collections import Counter, defaultdict

from .utils import TimeDistribution
from .aircraft import Aircraft
from .task import Task
from .resource_manager import GlobalResourceManager

class TaskSimulation:
    def __init__(self, config, params={}):
        self.ticks = 0
        self.max_critical_ratio = None
        self.config = config
        self.logs = []
        self.event_logs = []

        self.setup_time_dist(config.get("time_dist", []))
        self.task_configs = config.get("s_tasks", [])
        self.operation = config.get("s_operation", [])
        
        self.setup_aircrafts()
        self.setup_tasks()

        self.total_repairs = 0
        self.total_takeoffs = 0
        
        # 调度算法选择：'random' 或 'heuristic' (或具体策略如 'earliest_start', 'critical_path' 等)
        self.scheduling_algorithm = params.get('scheduling_algorithm', 'random')
        
        # 全局保障作业请求池
        self.global_resource_manager = GlobalResourceManager(self)

    def log_event(self, category, entity_id, message, event_type='activity', **details):
        event = {
            'tick': self.ticks,
            'category': category,
            'event_type': event_type,
            'entity_id': entity_id,
            'message': message,
        }
        cleaned_details = {key: value for key, value in details.items() if value is not None}
        if cleaned_details:
            event['details'] = cleaned_details
        self.event_logs.append(event)
        line = f"{self.ticks}: [{category}/{event_type}] {entity_id} {message}"
        self.logs.append(line)
        return event

    def log_state_change(self, category, entity_id, old_state, new_state, reason=None, **details):
        if old_state == new_state:
            return None
        message = f"状态 {old_state} -> {new_state}"
        if reason:
            message = f"{message}，{reason}"
        return self.log_event(
            category,
            entity_id,
            message,
            event_type='state_change',
            old_state=old_state,
            new_state=new_state,
            reason=reason,
            **details,
        )

    def get_metrics(self):

        return {
            '运行时间步': self.ticks,
            "使用可用度": float(np.mean([a.available_time / self.ticks for a in self.aircrafts])) if self.ticks > 0 else 0,
            "总维修次数": self.total_repairs,
            "总预防性维修次数": self.total_maintenance(),
            "总出动架次": self.total_takeoffs,
            "出动架次率": self.total_takeoffs / self.days() / len(self.aircrafts) if self.aircrafts and self.days() > 0 else 0,
            "航线占有率": self.task_hrs_coverage(), # 航线占有率
            "再次出动准备时间": self.avg_turnaround_time(),
            "平均故障间隔时间": self.get_average_mtbf(),
            "平均严重故障间隔时间": self.get_average_mtbcf(),
            "保障设备满足率": self.global_resource_manager.get_overall_equipment_fulfill_rate(),
            "保障设备利用率": self.global_resource_manager.get_overall_equipment_utilization(),
            "备件满足率": self.global_resource_manager.get_overall_part_fulfill_rate(),
            "备件利用率": self.global_resource_manager.get_overall_part_utilization()
        }

    def days(self):
        return self.ticks / 24 / 60

    def aircraft_availability(self):
        return [a.is_available for a in self.aircrafts]

    def sum_aircraft_task_hrs(self):
        return sum([a.task_hrs_sum for a in self.aircrafts])

    def sum_aircraft_available_time(self):
        return sum([a.available_time for a in self.aircrafts])
    
    def sum_aircraft_failures_count(self):
        return sum([a.failures_count for a in self.aircrafts])
    
    def sum_aircraft_critical_failures_count(self):
        return sum([a.critical_failure_count for a in self.aircrafts])

    def avg_turnaround_time(self):
        turnaround_times = [t.turnaround_time for t in self.tasks if t.turnaround_time is not None]
        return sum(turnaround_times) / len(turnaround_times) if turnaround_times else 0


    def total_fly_hrs(self):
        return sum([a.task_hrs for a in self.aircrafts])

    def setup_time_dist(self, time_dist_config):
        self.time_dist = {}
        for dist in time_dist_config:
            # Create a TimeDistribution object for each distribution
            self.time_dist[dist['Id']] = TimeDistribution(dist)

    def setup_aircrafts(self):
        unit_config = self.config.get('s_units', [])
        self.aircrafts = []
        for index, a in enumerate(unit_config):
            aid = a.get('Id') or a.get('SN') or f"unit_{index + 1}"
            if 'Id' not in a:
                a['Id'] = aid
            self.aircrafts.append(Aircraft(
                model=self,
                aid=aid,
                sn=a.get('SN', None),
                unit_id=aid
            ))

    def setup_tasks(self):
        self.tasks = []
        
        # Check for single_flight
        single_flights = self.config.get('single_flight', [])
        if single_flights:
            self.setup_single_flight_tasks(single_flights)
            return

        tasks_dict = {}

        for task_config in self.task_configs:
            tasks_dict[task_config['Id']] = {
                'task_name': task_config['task_name'],
                'aircraft': task_config.get('aircraft', None),
                'task_duration': task_config['task_duration'],
                'task_stages': task_config['task_stages'],
                'prep_time': task_config.get('prep_time', 3),
                'config': task_config
            }

        for op_index, op in enumerate(self.operation):
            for task_index, t in enumerate(op['tasks']):
                for repeat in range(0, t['max_repeat_num']):
                    start = t['start_day'] * 24 + t['start_hour']
                    task_id = t['task_id']
                    if task_id in tasks_dict:
                         operation_config = dict(t)
                         operation_config['repeat_index'] = repeat
                         aircraft_id = tasks_dict[task_id]['aircraft']
                         task_name = tasks_dict[task_id]['task_name']
                         prefix = aircraft_id if aircraft_id else "Any"
                         
                         task = Task(
                            model=self,
                            id= f"{prefix}_{task_name}_{op_index}_{task_index}_{repeat}",
                            aircraft_id=aircraft_id if self.aircrafts else None,
                            name=task_name,
                            task_hrs=tasks_dict[task_id]['task_duration'],
                            stages=tasks_dict[task_id]['task_stages'],
                            start_hour=start + repeat * t['regenerate_hrs'],
                            prep_time=tasks_dict[task_id]['prep_time'],
                            task_config=tasks_dict[task_id]['config'],
                            operation_config=operation_config
                        )


    # 航线占有率
    def task_hrs_coverage(self):
        selected_tasks = [t for t in self.tasks if (t.start_hour + t.hrs) * 60 <= self.ticks]
        if selected_tasks:
            total_hrs = sum([t.demand_hrs() for t in selected_tasks])
            covered_hrs = sum([t.hrs_covered for t in selected_tasks])
            return covered_hrs / total_hrs if total_hrs > 0 else 0
        else:
            return 0
        
    def total_maintenance(self):
        return sum([ sum([pr.num_maintenances for pr in a.prev_repairs])  for a in self.aircrafts])


    def get_average_mtbf(self):
        return self.sum_aircraft_task_hrs() / self.sum_aircraft_failures_count() if self.sum_aircraft_failures_count() > 0 else 9999

    def get_average_mtbcf(self):
        return self.sum_aircraft_task_hrs() / self.sum_aircraft_critical_failures_count() if self.sum_aircraft_critical_failures_count() > 0 else 9999

    def generate_multiple_aircraft_plans(self, aircrafts):
        """
        生成多架飞机的保障计划，考虑资源约束。
        入参是飞机对象列表
        """
        if not aircrafts:
            self.logs.append(f"{self.ticks}: 无可用于生成多机保障计划的飞机")
            return None

        facilities_state, equipments_state, staffs_state = self.global_resource_manager.get_current_resource_state()
        return self._generate_multiple_aircraft_plans_with_resources(aircrafts, facilities_state, equipments_state, staffs_state)


    def _generate_multiple_aircraft_plans_with_resources(self, aircrafts, facilities_state, equipments_state, staffs_state, service_id=None):
        """
        生成考虑当前资源占用状态的多机保障计划
        根据self.scheduling_algorithm选择使用随机算法或启发式算法
        """
        try:
            aircraft_list = list(aircrafts)
            if not aircraft_list:
                return None

            num_aircrafts = len(aircraft_list)
            
            if service_id is None:
                aircraft_services = self.config.get('s_aircraft_services', [])
                if aircraft_services:
                    service_id = aircraft_services[0].get('Id')

            strategy = self.scheduling_algorithm
            if strategy == 'heuristic':
                strategy = 'earliest_start'
            
            # 默认重试次数
            max_retries = 10

            base_jobs = self.get_aircraft_service_jobs(service_id)
            if not base_jobs:
                self.logs.append(f"{self.ticks}: No jobs found for service_id {service_id}")
                return None

            last_error = None
            for attempt in range(1, max_retries + 1):
                try:
                    # 使用传入的资源状态副本
                    facilities = deepcopy(facilities_state)
                    equipments = deepcopy(equipments_state)
                    staffs = deepcopy(staffs_state)

                    prepared_jobs = self._prepare_job_templates(base_jobs)
                    job_map = {job['Id']: job for job in prepared_jobs}

                    if strategy == 'random':
                        self._resolve_conflicts_random(prepared_jobs, job_map)
                    else:
                        self._resolve_conflicts_heuristic(prepared_jobs, job_map)
                        self._calculate_priorities(prepared_jobs, job_map, strategy)

                    job_instances = self._instantiate_jobs_for_aircrafts(
                        job_templates=prepared_jobs,
                        aircraft_list=aircraft_list
                    )

                    records, switch_map, max_duration, stats = self._run_time_based_scheduler(
                        job_instances=job_instances,
                        facilities=facilities,
                        equipments=equipments,
                        staffs=staffs,
                        strategy=strategy
                    )

                    aircraft_plans, total_switches = self._group_records_by_aircraft(records, switch_map)
                    
                    # 统计报告 (可选)
                    facilities_util = self._build_facility_utilization_report(facilities, max_duration)
                    equipments_util = self._build_equipment_utilization_report(equipments, max_duration)

                    plan = {
                        'aircraft_plans': aircraft_plans,
                        'num_aircrafts': num_aircrafts,
                        'total_duration': max_duration,
                        'retry_count': attempt,
                        'total_facility_switches': total_switches,
                        'algorithm': 'random' if strategy == 'random' else 'heuristic',
                        'strategy': None if strategy == 'random' else strategy,
                        'facilities_utilization': facilities_util,
                        'equipments_utilization': equipments_util,
                        'resource_requirements': stats.get('requirements', {}),
                        'resource_bottlenecks': stats.get('bottlenecks', {})
                    }
                    
                    # 自动校验
                    validation_issues = self.validate_plan(plan)
                    plan['validation_issues'] = validation_issues
                    plan['is_valid'] = all(len(v) == 0 for v in validation_issues.values())
                    
                    if not plan['is_valid']:
                         # 如果校验失败，视为一次尝试失败
                         raise RuntimeError(f"Plan validation failed: {validation_issues}")

                    # Update GlobalResourceManager stats
                    self.global_resource_manager.record_equipment_stats(stats['total_req'], stats['delayed'])

                    return plan

                except RuntimeError as exc:
                    last_error = exc
                    continue
            
            self.logs.append(f"{self.ticks}: Unable to generate plan after {max_retries} retries: {last_error}")
            return None

        except Exception as e:
            self.logs.append(f"{self.ticks}: _generate_multiple_aircraft_plans_with_resources方法异常: {str(e)}")
            return None

    def get_single_job(self, job_id: str) -> Optional[dict]:
        jobs = self.config.get('s_jobs', [])
        return deepcopy(next((j for j in jobs if j['Id'] == job_id), None))

    def get_aircraft_service_jobs(self, service_id: Optional[str] = None) -> List[dict]:
        services = self.config.get('s_aircraft_services', [])
        service = None
        for svc in services:
            if service_id is None or svc['Id'] == service_id:
                service = svc
                break

        if not service or 'jobs' not in service:
            return []

        jobs = []
        job_overrides = service.get('job_overrides') if isinstance(service.get('job_overrides'), dict) else {}
        for job_id in service['jobs']:
            job_ref = job_id
            inline_override = {}
            if isinstance(job_id, dict):
                job_ref = job_id.get('Id') or job_id.get('job_id')
                inline_override = {key: value for key, value in job_id.items() if key not in {'Id', 'job_id'}}
            job = self.get_single_job(job_ref)
            if job:
                override = job_overrides.get(job_ref) or {}
                if inline_override:
                    override = {**override, **inline_override}
                if override:
                    job.update(deepcopy(override))
                jobs.append(job)
        return jobs

    # ------------------------------------------------------------------
    # 冲突处理 & 优先级
    # ------------------------------------------------------------------
    def _resolve_conflicts_random(self, jobs: List[dict], job_map: Dict[str, dict]) -> None:
        processed = set()
        for job in jobs:
            for conflict_id in job.get('conflict_jobs', []):
                if conflict_id not in job_map:
                    continue
                key = frozenset({job['Id'], conflict_id})
                if key in processed:
                    continue
                processed.add(key)
                first, second = job, job_map[conflict_id]
                if np.random.rand() < 0.5:
                    first, second = second, first
                self._apply_conflict_order_safe(job_map, first, second)

    def _resolve_conflicts_heuristic(self, jobs: List[dict], job_map: Dict[str, dict]) -> None:
        processed = set()
        for job in jobs:
            for conflict_id in job.get('conflict_jobs', []):
                if conflict_id not in job_map:
                    continue
                key = frozenset({job['Id'], conflict_id})
                if key in processed:
                    continue
                processed.add(key)
                conflict_job = job_map[conflict_id]
                first, second = (
                    (job, conflict_job)
                    if job['duration'] <= conflict_job['duration']
                    else (conflict_job, job)
                )
                self._apply_conflict_order_safe(job_map, first, second)

    def _apply_conflict_order_safe(self, job_map: Dict[str, dict], first: dict, second: dict) -> None:
        if not first or not second or first['Id'] == second['Id']:
            return
        first_id, second_id = first['Id'], second['Id']
        if self._job_depends_on(job_map, first_id, second_id):
            if self._job_depends_on(job_map, second_id, first_id):
                return  # existing cycle in data; skip to avoid worsening it
            first, second = second, first
            first_id, second_id = first['Id'], second['Id']
        second.setdefault('pre_jobs', [])
        if first_id not in second['pre_jobs']:
            second['pre_jobs'].append(first_id)
        if second_id in first.get('pre_jobs', []):
            first['pre_jobs'] = [pid for pid in first['pre_jobs'] if pid != second_id]

    def _job_depends_on(self, job_map: Dict[str, dict], job_id: str, target_id: str) -> bool:
        if job_id == target_id:
            return False
        visited = set()
        stack = [job_id]
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            job = job_map.get(current)
            if not job:
                continue
            for pre in job.get('pre_jobs', []) or []:
                if pre == target_id:
                    return True
                if pre not in visited:
                    stack.append(pre)
        return False

    def _calculate_priorities(self, jobs: List[dict], job_map: Dict[str, dict], strategy: str) -> None:
        if strategy == 'critical_path':
            self._calculate_critical_path_priority(jobs, job_map)
        elif strategy == 'shortest_job':
            for job in jobs:
                job['priority'] = -job['duration']
        elif strategy == 'resource_balance':
            for job in jobs:
                complexity = (
                    len(job.get('facility_req', [])) * 2 +
                    len(job.get('equip_req', [])) * 3 +
                    len(job.get('manpower_req', []))
                )
                job['priority'] = -complexity - job['duration'] * 0.1
        else:  # earliest_start 默认按依赖深度
            self._calculate_depth_priority(jobs, job_map)

    def _calculate_critical_path_priority(self, jobs: List[dict], job_map: Dict[str, dict]) -> None:
        dependents = {job['Id']: [] for job in jobs}
        for job in jobs:
            for pre in job.get('pre_jobs', []):
                if pre in dependents:
                    dependents[pre].append(job['Id'])

        memo: Dict[str, int] = {}

        def longest_path(job_id: str) -> int:
            if job_id in memo:
                return memo[job_id]
            job = job_map.get(job_id)
            if not job:
                return 0
            best = job['duration']
            for dep_id in dependents.get(job_id, []):
                best = max(best, job['duration'] + longest_path(dep_id))
            memo[job_id] = best
            return best

        for job in jobs:
            job['priority'] = longest_path(job['Id'])

    def _calculate_depth_priority(self, jobs: List[dict], job_map: Dict[str, dict]) -> None:
        memo: Dict[str, int] = {}

        def depth(job_id: str) -> int:
            if job_id in memo:
                return memo[job_id]
            job = job_map.get(job_id)
            if not job or not job.get('pre_jobs'):
                memo[job_id] = 0
                return 0
            memo[job_id] = 1 + max(depth(pre) for pre in job['pre_jobs'])
            return memo[job_id]

        for job in jobs:
            job['priority'] = depth(job['Id'])

    # ------------------------------------------------------------------
    # 基于时间刻度的多机编排实现
    # ------------------------------------------------------------------
    def _prepare_job_templates(self, jobs: List[dict]) -> List[dict]:
        prepared = []
        for job in deepcopy(jobs):
            job.setdefault('pre_jobs', [])
            job.setdefault('conflict_jobs', [])
            job.setdefault('facility_req', [])
            job.setdefault('equip_req', [])
            job.setdefault('manpower_req', [])
            job.setdefault('supply_req', [])
            job['pre_jobs'] = [pre for pre in job['pre_jobs'] if pre != job['Id']]
            job['estimated_duration'] = self._estimate_job_duration(job)
            job['duration'] = job['estimated_duration']
            prepared.append(job)
        return prepared

    def _instantiate_jobs_for_aircrafts(self, job_templates: List[dict], aircraft_list: List) -> List[dict]:
        instances: List[dict] = []
        for idx, aircraft in enumerate(aircraft_list):
            aircraft_id = f"aircraft_{idx + 1}"
            # aircraft_sn = aircraft.sn # If needed
            for template in job_templates:
                duration = max(1, int(self.get_time_sample(template.get('job_period'))))
                instance_id = f"{aircraft_id}::{template['Id']}"
                dependencies: List[str] = []
                seen: set = set()
                for pre in template.get('pre_jobs', []):
                    dep_id = f"{aircraft_id}::{pre}"
                    if dep_id in seen:
                        continue
                    dependencies.append(dep_id)
                    seen.add(dep_id)
                job_instance = {
                    'instance_id': instance_id,
                    'Id': template['Id'],
                    'job_name': template.get('job_name', template['Id']),
                    'aircraft_id': aircraft_id,
                    'aircraft_sn': aircraft.sn,
                    'duration': duration,
                    'priority': template.get('priority', 0),
                    'facility_req': template.get('facility_req', []),
                    'equip_req': template.get('equip_req', []),
                    'manpower_req': template.get('manpower_req', []),
                    'supply_req': template.get('supply_req', []),
                    'dependencies': dependencies
                }
                instances.append(job_instance)
        return instances

    def _summarize_job_resource_requirements(self, job: dict) -> dict:
        return {
            'facility': Counter(job.get('facility_req') or []),
            'equipment': Counter(job.get('equip_req') or []),
            'staff': Counter(job.get('manpower_req') or []),
        }

    def _run_time_based_scheduler(self, job_instances: List[dict], facilities: List[dict], equipments: List[dict], staffs: List[dict],
                                  strategy: str) -> Tuple[List[dict], Dict[str, int], int]:
        pending = {job['instance_id']: job for job in job_instances}
        active: Dict[str, dict] = {}
        completed_ids: set = set()
        records: List[dict] = []
        last_facility: Dict[str, Optional[str]] = {}
        facility_switches: Dict[str, int] = {}
        
        # Stats
        jobs_needing_equipment = set()
        jobs_delayed_by_equipment = set()
        facility_requirement_counter: Counter = Counter()
        equipment_requirement_counter: Counter = Counter()
        staff_requirement_counter: Counter = Counter()
        facility_shortage_counter: Counter = Counter()
        equipment_shortage_counter: Counter = Counter()
        staff_shortage_counter: Counter = Counter()

        current_time = 0
        total_jobs = len(job_instances)
        if total_jobs == 0:
            return [], {}, 0, {'total_req': 0, 'delayed': 0}
        safety_limit = max(10, sum(job['duration'] for job in job_instances) * 5)

        while len(completed_ids) < total_jobs:
            finished_ids = [jid for jid, rec in active.items() if rec['end_time'] <= current_time]
            for jid in finished_ids:
                completed_ids.add(jid)
                active.pop(jid, None)

            ready_jobs = [job for job_id, job in pending.items() if all(dep in completed_ids for dep in job['dependencies'])]
            ready_jobs = self._sort_ready_jobs(ready_jobs, strategy)

            started_this_tick = 0
            for job in list(ready_jobs):
                facility_requirement_counter.update(job.get('facility_req') or [])
                equipment_requirement_counter.update(job.get('equip_req') or [])
                staff_requirement_counter.update(job.get('manpower_req') or [])

                # Track if job needs equipment
                if job.get('equip_req'):
                    jobs_needing_equipment.add(job['instance_id'])

                facility_choice, facility_shortage = self._select_facility_with_shortage(job, facilities, current_time)
                if facility_shortage:
                    facility_shortage_counter.update(facility_shortage)

                equipment_instances, equipment_shortage = self._select_equipments_with_shortage(job, equipments, current_time)
                if equipment_shortage:
                    jobs_delayed_by_equipment.add(job['instance_id'])
                    equipment_shortage_counter.update(equipment_shortage)

                staff_instances, staff_shortage = self._select_staffs_with_shortage(job, staffs, current_time)
                if staff_shortage:
                    staff_shortage_counter.update(staff_shortage)

                end_time = current_time + job['duration']
                facility_info = None
                facility_id = None
                if facility_choice:
                    facility_id = facility_choice['Id']
                    self._reserve_resource(facility_choice, current_time, end_time, job['instance_id'])
                    facility_info = {
                        'facility_id': facility_choice['Id'],
                        'facility_name': facility_choice.get('facility_name') or facility_choice.get('Id')
                    }

                allocated_eq = []
                for inst in equipment_instances:
                    self._reserve_resource(inst, current_time, end_time, job['instance_id'])
                    allocated_eq.append({
                        'equipment_id': inst['Id'],
                        'equipment_name': inst.get('equipment_name', 'N/A'),
                        'instance_id': inst.get('instance_id')
                    })

                allocated_staff = []
                for inst in staff_instances:
                    self._reserve_resource(inst, current_time, end_time, job['instance_id'])
                    allocated_staff.append({
                        'staff_id': inst['Id'],
                        'type_code': inst.get('type_code', 'N/A'),
                        'instance_id': inst.get('instance_id')
                    })

                record = {
                    'job_instance_id': job['instance_id'],
                    'Id': job['Id'],
                    'job_name': job['job_name'],
                    'aircraft_id': job['aircraft_id'],
                    'aircraft_sn': job.get('aircraft_sn'),
                    'start_time': current_time,
                    'end_time': end_time,
                    'duration': job['duration'],
                    'priority': job.get('priority', 0),
                    'required_resources': {
                        'facility_id': facility_id,
                        'facility_name': facility_info.get('facility_name') if facility_info else None,
                        'allocated_equipments': allocated_eq,
                        'allocated_staff': allocated_staff,
                        'required_supplies': job.get('supply_req', []),
                        'resource_shortage': {
                            'facility': dict(facility_shortage),
                            'equipment': dict(equipment_shortage),
                            'staff': dict(staff_shortage),
                        }
                    }
                }

                records.append(record)
                active[job['instance_id']] = record
                pending.pop(job['instance_id'], None)
                started_this_tick += 1

                if facility_id:
                    prev = last_facility.get(job['aircraft_id'])
                    if prev and prev != facility_id:
                        facility_switches[job['aircraft_id']] = facility_switches.get(job['aircraft_id'], 0) + 1
                    last_facility[job['aircraft_id']] = facility_id

            if not ready_jobs and not active and pending:
                raise RuntimeError('Cyclic dependencies detected for remaining jobs')

            current_time += 1
            if current_time > safety_limit:
                raise RuntimeError('Scheduling exceeded safety time bound, check constraints or resources')

        max_end = max((rec['end_time'] for rec in records), default=0)
        return records, facility_switches, max_end, {
            'total_req': len(jobs_needing_equipment),
            'delayed': len(jobs_delayed_by_equipment),
            'requirements': {
                'facility': dict(facility_requirement_counter),
                'equipment': dict(equipment_requirement_counter),
                'staff': dict(staff_requirement_counter),
            },
            'bottlenecks': {
                'facility': dict(facility_shortage_counter),
                'equipment': dict(equipment_shortage_counter),
                'staff': dict(staff_shortage_counter),
            },
        }

    def _sort_ready_jobs(self, ready_jobs: List[dict], strategy: str) -> List[dict]:
        if not ready_jobs:
            return ready_jobs
        if strategy == 'random':
            shuffled = ready_jobs[:]
            random.shuffle(shuffled)
            return shuffled
        if strategy == 'shortest_job':
            return sorted(ready_jobs, key=lambda job: (job['duration'], job['Id']))
        if strategy == 'critical_path' or strategy == 'resource_balance':
            return sorted(ready_jobs, key=lambda job: (-job.get('priority', 0), job['Id']))
        return sorted(ready_jobs, key=lambda job: (job.get('priority', 0), job['Id']))

    def _select_facility_now(self, job: dict, facilities: List[dict], start_time: int) -> Optional[dict]:
        requirements = job.get('facility_req') or []
        if not requirements:
            return None
        candidates = [fac for fac in facilities if all(req in fac.get('functions', []) for req in requirements)]
        available = [fac for fac in candidates if self.is_facility_available(fac, start_time, job['duration'])]
        if not available:
            return None
        available.sort(key=lambda fac: (len(fac.get('occupied_times', [])), fac['Id']))
        return available[0]

    def _select_facility_with_shortage(self, job: dict, facilities: List[dict], start_time: int) -> Tuple[Optional[dict], Counter]:
        requirements = job.get('facility_req') or []
        if not requirements:
            return None, Counter()
        facility_choice = self._select_facility_now(job, facilities, start_time)
        if facility_choice is None:
            return None, Counter(requirements)
        return facility_choice, Counter()

    def _select_equipments_now(self, job: dict, equipments: List[dict], start_time: int) -> Optional[List[dict]]:
        requirements = job.get('equip_req') or []
        if not requirements:
            return []
        allocated = []
        for equip_id in requirements:
            candidates = [inst for inst in equipments if inst['Id'] == equip_id and self.is_equipment_available(inst, start_time, job['duration'])]
            if not candidates:
                return None
            candidates.sort(key=lambda inst: (len(inst.get('occupied_times', [])), inst.get('instance_id')))
            allocated.append(candidates[0])
        return allocated

    def _select_equipments_with_shortage(self, job: dict, equipments: List[dict], start_time: int) -> Tuple[List[dict], Counter]:
        requirements = job.get('equip_req') or []
        if not requirements:
            return [], Counter()

        allocated = []
        shortage = Counter()
        used_instances = set()
        for equip_id in requirements:
            candidates = [
                inst for inst in equipments
                if inst['Id'] == equip_id
                and inst.get('instance_id') not in used_instances
                and self.is_equipment_available(inst, start_time, job['duration'])
            ]
            if not candidates:
                shortage.update([equip_id])
                continue
            candidates.sort(key=lambda inst: (len(inst.get('occupied_times', [])), inst.get('instance_id')))
            chosen = candidates[0]
            allocated.append(chosen)
            used_instances.add(chosen.get('instance_id'))
        return allocated, shortage

    def _expand_staff_requirement(self, token: str) -> List[str]:
        aliases = {
            '加油组': ['加油组', '加油员'],
            '挂弹组': ['挂弹组', '军械员', '军械师'],
            '液压保障小组': ['液压保障小组', '机械员', '机械师'],
        }
        return aliases.get(token, [token])

    def _is_service_staff_requirement(self, requirement: str, accepted_types: set) -> bool:
        resource_manager = getattr(self, 'global_resource_manager', None)
        service_types = getattr(resource_manager, 'service_staff_type_codes', set()) or set()
        if service_types:
            return bool(accepted_types & service_types or requirement in service_types)
        return False

    def _staff_matches_requirement_scope(self, staff: dict, requirement: str, accepted_types: set) -> bool:
        if self._is_service_staff_requirement(requirement, accepted_types):
            return bool(staff.get('is_service_staff'))
        return not (staff.get('is_service_staff') and not staff.get('is_aircraft_staff'))

    def _select_staffs_now(self, job: dict, staffs: List[dict], start_time: int) -> Optional[List[dict]]:
        requirements = job.get('manpower_req') or []
        if not requirements:
            return []

        allocated = []
        used_instances = set()
        for requirement in requirements:
            accepted_types = set(self._expand_staff_requirement(requirement))
            candidates = [
                inst for inst in staffs
                if inst.get('type_code') in accepted_types
                and inst.get('instance_id') not in used_instances
                and self._staff_matches_requirement_scope(inst, requirement, accepted_types)
                and self.is_equipment_available(inst, start_time, job['duration'])
            ]
            if not candidates:
                return None
            candidates.sort(key=lambda inst: (len(inst.get('occupied_times', [])), inst.get('instance_id')))
            chosen = candidates[0]
            allocated.append(chosen)
            used_instances.add(chosen.get('instance_id'))
        return allocated

    def _select_staffs_with_shortage(self, job: dict, staffs: List[dict], start_time: int) -> Tuple[List[dict], Counter]:
        requirements = job.get('manpower_req') or []
        if not requirements:
            return [], Counter()

        allocated = []
        shortage = Counter()
        used_instances = set()
        for requirement in requirements:
            accepted_types = set(self._expand_staff_requirement(requirement))
            candidates = [
                inst for inst in staffs
                if inst.get('type_code') in accepted_types
                and inst.get('instance_id') not in used_instances
                and self._staff_matches_requirement_scope(inst, requirement, accepted_types)
                and self.is_equipment_available(inst, start_time, job['duration'])
            ]
            if not candidates:
                shortage.update([requirement])
                continue
            candidates.sort(key=lambda inst: (len(inst.get('occupied_times', [])), inst.get('instance_id')))
            chosen = candidates[0]
            allocated.append(chosen)
            used_instances.add(chosen.get('instance_id'))
        return allocated, shortage

    def _group_records_by_aircraft(self, records: List[dict], switch_map: Dict[str, int]) -> Tuple[List[dict], int]:
        grouped: Dict[str, List[dict]] = {}
        for record in records:
            grouped.setdefault(record['aircraft_id'], []).append(record)
        aircraft_plans = []
        total_switches = 0
        for aircraft_id in sorted(grouped.keys()):
            tasks = sorted(grouped[aircraft_id], key=lambda item: item['start_time'])
            switches = switch_map.get(aircraft_id, 0)
            total_switches += switches
            aircraft_plans.append({
                'aircraft_id': aircraft_id,
                'aircraft_sn': tasks[0].get('aircraft_sn') if tasks else None,
                'tasks': tasks,
                'facility_switches': switches
            })
        return aircraft_plans, total_switches

    # ------------------------------------------------------------------
    # 设施 / 设备辅助方法
    # ------------------------------------------------------------------
    def _reserve_resource(self, resource: dict, start: int, end: int, job_id: str) -> None:
        resource.setdefault('occupied_times', [])
        resource['occupied_times'].append({
            'start_time': start,
            'end_time': end,
            'job_id': job_id
        })
        resource['occupied_times'].sort(key=lambda item: item['start_time'])

    def get_equipment_by_id(self, equipment_id: str, equipment_pool: Optional[List[dict]] = None) -> List[dict]:
        pool = equipment_pool if equipment_pool is not None else self.equipments
        if pool is None:
             return []
        return [equip for equip in pool if equip['Id'] == equipment_id]

    def is_equipment_available(self, equipment: dict, start_time: int, duration: int) -> bool:
        end_time = start_time + duration
        for occupied in equipment.get('occupied_times', []):
            if not (end_time <= occupied['start_time'] or start_time >= occupied['end_time']):
                return False
        return True

    def is_facility_available(self, facility: dict, start_time: int, duration: int) -> bool:
        end_time = start_time + duration
        for occupied in facility.get('occupied_times', []):
            if not (end_time <= occupied['start_time'] or start_time >= occupied['end_time']):
                return False
        return True

    # ------------------------------------------------------------------
    # 统计输出
    # ------------------------------------------------------------------
    def _build_facility_utilization_report(self, facilities: List[dict], horizon: int) -> dict:
        duration = max(1, horizon)
        items = []
        for fac in facilities:
            busy = sum(entry['end_time'] - entry['start_time'] for entry in fac.get('occupied_times', []))
            items.append({
                'facility_id': fac.get('Id'),
                'facility_name': fac.get('facility_name') or fac.get('Id'),
                'usage_count': len(fac.get('occupied_times', [])),
                'busy_time': busy,
                'utilization_rate': (busy / duration) * 100 if duration else 0.0
            })
        return {
            'total_duration': horizon,
            'facilities': items
        }

    def _build_equipment_utilization_report(self, equipments: List[dict], horizon: int) -> dict:
        duration = max(1, horizon)
        grouped: Dict[str, dict] = {}
        for inst in equipments:
            key = inst['Id']
            grouped.setdefault(key, {
                'equipment_id': key,
                'equipment_name': inst.get('equipment_name', 'N/A'),
                'instances': []
            })
            busy = sum(entry['end_time'] - entry['start_time'] for entry in inst.get('occupied_times', []))
            grouped[key]['instances'].append({
                'instance_id': inst.get('instance_id'),
                'usage_count': len(inst.get('occupied_times', [])),
                'busy_time': busy,
                'utilization_rate': (busy / duration) * 100 if duration else 0.0
            })
        return {
            'total_duration': horizon,
            'equipments': list(grouped.values())
        }

    # ------------------------------------------------------------------
    # 工具方法
    # ------------------------------------------------------------------
    def _estimate_job_duration(self, job: dict) -> int:
        dist_id = job.get('job_period')
        if hasattr(self, 'time_dist') and dist_id in self.time_dist:
             return int(self.get_time_sample(dist_id))
        
        return max(1, int(job.get('mean_duration', 1)))

    def get_time_sample(self, dist_id: Optional[str]) -> float:
        if not dist_id:
            return 1.0
        if isinstance(dist_id, (int, float)):
            return float(dist_id)
        if hasattr(self, 'time_dist') and dist_id in self.time_dist:
            return float(self.time_dist[dist_id].get_sample())
        return 1.0

    # ------------------------------------------------------------------
    # 方案校验与诊断
    # ------------------------------------------------------------------
    def validate_plan(self, plan: dict) -> dict:
        """对生成的计划进行全量约束检查，返回问题列表"""
        issues = {
            'sequence': [],
            'resource_conflict': [],
            'resource_invalid': [],
            'coverage': []
        }
        
        all_jobs = self.config.get('s_jobs', [])
        job_map = {j['Id']: j for j in all_jobs}
        
        facilities_config = self.config.get('s_facilities', [])
        fac_map = {f['Id']: f for f in facilities_config}
        
        # 资源占用记录表 (Resource ID -> List of (start, end, info))
        resource_usage = defaultdict(list)
        
        # 1. 遍历每架飞机的任务
        for aircraft_plan in plan.get('aircraft_plans', []):
            aircraft_id = aircraft_plan['aircraft_id']
            tasks = sorted(aircraft_plan.get('tasks', []), key=lambda x: x['start_time'])
            task_map = {t['Id']: t for t in tasks}
            
            # 1.2 任务序列与依赖检查
            for task in tasks:
                job_def = job_map.get(task['Id'])
                if not job_def: continue
                
                # 检查前置依赖
                for pre_id in job_def.get('pre_jobs', []):
                    pre_task = task_map.get(pre_id)
                    if not pre_task:
                        continue
                    if pre_task['end_time'] > task['start_time']:
                        issues['sequence'].append(
                            f"[{aircraft_id}] 依赖违规: {task['Id']} (Start:{task['start_time']}) 在前置 {pre_id} (End:{pre_task['end_time']}) 结束前开始"
                        )
                
                # 检查冲突作业 (同一飞机内不能重叠)
                for conf_id in job_def.get('conflict_jobs', []):
                    if conf_id == task['Id']:
                        continue
                    conf_task = task_map.get(conf_id)
                    if conf_task:
                        if max(task['start_time'], conf_task['start_time']) < min(task['end_time'], conf_task['end_time']):
                             issues['sequence'].append(
                                f"[{aircraft_id}] 互斥违规: {task['Id']} 与 {conf_id} 时间重叠"
                            )

                # 1.3 收集资源占用 & 检查资源有效性
                res = task.get('required_resources', {})
                
                # 设施
                fid = res.get('facility_id')
                if fid:
                    if fid not in fac_map:
                        issues['resource_invalid'].append(f"[{aircraft_id}] 未知设施: {fid} (Task: {task['Id']})")
                    else:
                        resource_usage[fid].append((task['start_time'], task['end_time'], f"{aircraft_id}::{task['Id']}"))
                        reqs = job_def.get('facility_req', [])
                        funcs = fac_map[fid].get('functions', [])
                        if not all(r in funcs for r in reqs):
                             issues['resource_invalid'].append(f"[{aircraft_id}] 设施功能不匹配: {fid} 缺少 {set(reqs)-set(funcs)}")

                # 设备
                for eq in res.get('allocated_equipments', []):
                    eid = eq.get('instance_id')
                    if eid:
                        resource_usage[eid].append((task['start_time'], task['end_time'], f"{aircraft_id}::{task['Id']}"))
                    else:
                         issues['resource_invalid'].append(f"[{aircraft_id}] 设备未分配实例ID (Task: {task['Id']})")

        # 2. 全局资源冲突检查
        for res_id, intervals in resource_usage.items():
            overlaps = self._check_overlaps(intervals)
            for info1, info2, start, end in overlaps:
                issues['resource_conflict'].append(
                    f"资源冲突 [{res_id}]: {info1} 与 {info2} 在 {start}-{end} 重叠"
                )
                
        return issues

    @staticmethod
    def _check_overlaps(intervals: List[Tuple[int, int, str]]) -> List[Tuple[str, str, int, int]]:
        """检查时间区间是否有重叠"""
        intervals.sort(key=lambda x: x[0])
        overlaps = []
        for i in range(len(intervals) - 1):
            curr_start, curr_end, curr_info = intervals[i]
            next_start, next_end, next_info = intervals[i+1]
            if curr_end > next_start:
                overlaps.append((curr_info, next_info, max(curr_start, next_start), min(curr_end, next_end)))
        return overlaps

    def step(self):
        # 清理全局资源管理器中的过期计划
        self.global_resource_manager.cleanup_completed_plans()
        # 处理待分配的保障请求
        self.global_resource_manager.process_pending_requests()
        # 自动补充备件
        self.global_resource_manager.replenish_spare_parts()

        for t in self.tasks:
            t.step()

        for a in self.aircrafts:
            a.step()

        self.ticks += 1
    
    def run(self, duration_days=30):
        total_ticks = duration_days * 24 * 60
        while self.ticks < total_ticks:
            self.step()

    def setup_single_flight_tasks(self, single_flights):
        for flight in single_flights:
            aircraft_id = flight.get('aircraft_sn') # In single_flight, aircraft_sn is the ID
            task_id = flight.get('Id')
            start_time = flight.get('takeoff_time', 0)
            end_time = flight.get('landing_time', 1)
            duration = max(0.1, end_time - start_time)
            
            # Create dummy stages for the task
            # Stage 1: Takeoff (10%)
            # Stage 2: Mission (80%)
            # Stage 3: Landing (10%)
            stages = [
                {'stage_seq': 1, 'system_num': 1, 'system_num_min': 1, 'stage_proportion': 0.1},
                {'stage_seq': 2, 'system_num': 1, 'system_num_min': 1, 'stage_proportion': 0.8},
                {'stage_seq': 3, 'system_num': 1, 'system_num_min': 1, 'stage_proportion': 0.1}
            ]
            
            task = Task(
                model=self,
                id=task_id,
                aircraft_id=aircraft_id,
                name=f"Flight_{task_id}",
                task_hrs=duration,
                stages=stages,
                start_hour=start_time,
                prep_time=3 # Default prep time
            )
            
            # Store tat_service for resource manager to use
            tat_services = flight.get('tat_service', [])
            if tat_services:
                task.tat_service_id = tat_services[0]
