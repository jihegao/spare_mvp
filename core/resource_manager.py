from collections import Counter, defaultdict
from typing import List, Dict, Optional, Tuple

class GlobalResourceManager:
    """
    全局资源管理器，跟踪所有保障资源的占用状态
    支持动态添加新的保障需求
    流程：
        任务招募飞机 
        -> 处于stay状态（而不是ready）的飞机提交保障请求（按refly_service_model查找jobs列表） 
        -> 全局资源管理器更新保障作业池，为jobs分配资源，更新资源占用时间线
        -> 任务飞机完成任务后，资源释放，更新资源状态
    """
    def __init__(self, model):
        self.model = model
        self.active_plans = []  # 当前活跃的保障计划列表
        self.jobs_todo = []  # 待执行的保障工作列表,包含aircraft_id, job_id, required_resources等信息
        self.jobs_log = [] # 执行后的保障工作列表,包含aircraft_id, job_id, start_time, end_time, occupied_resources等信息
        self.resource_timeline = {}  # 资源时间线，记录每个资源在每个时间点的占用情况
        self.facilities_state = {}  # 设施状态
        self.equipments_state = {}  # 设备状态
        self.staff_state = {}  # 人力状态
        self.equipment_occupied_history = defaultdict(float)  # 记录设备历史占用时间
        self.staff_occupied_history = defaultdict(float)  # 记录人员历史占用时间

        # 统计指标计数器
        self.equipment_requests = 0
        self.equipment_fulfilled_immediately = 0
        self.part_requests = 0
        self.part_fulfilled_immediately = 0
        self.transport_configs = self.model.config.get('s_parts_transportation', [])
        self.supply_inventory = {}
        self.initial_supply_inventory = {}
        self.supply_consumed_history = defaultdict(int)
        self.supply_shortage_history = defaultdict(int)
        self.resource_shortage_history = {
            'facility': Counter(),
            'equipment': Counter(),
            'staff': Counter(),
        }
        self.resource_shortage_log = []
        self.resource_requirement_history = {
            'facility': Counter(),
            'equipment': Counter(),
            'staff': Counter(),
        }
        self.resource_requirement_log = []
        self.organization_id_to_name = {}
        self.organization_name_to_ids = defaultdict(set)
        self.organization_parent = {}
        self.organization_children = defaultdict(set)
        self._organization_scope_cache = {}
        self.service_staff_root_name = self.model.config.get('service_staff_root_name', '航空联队（勤务）')
        self._build_organization_indexes()
        self.service_staff_scope_tokens = self._organization_scope_tokens(self.service_staff_root_name)
        self.service_staff_type_codes = set()

        self.initialize_resources()

    def record_equipment_stats(self, total_requests, delayed_count):
        self.equipment_requests += total_requests
        self.equipment_fulfilled_immediately += (total_requests - delayed_count)

    def record_resource_shortages(self, shortages, service_id=None, aircrafts=None):
        """记录保障计划生成时未能满足的资源需求量。"""
        if not shortages:
            return
        normalized = {}
        for category in ('facility', 'equipment', 'staff'):
            values = shortages.get(category, {}) or {}
            counter = Counter(values)
            if not counter:
                continue
            self.resource_shortage_history[category].update(counter)
            normalized[category] = dict(counter)
        if not normalized:
            return
        self.resource_shortage_log.append({
            'tick': self.model.ticks,
            'service_id': service_id,
            'aircrafts': [getattr(aircraft, 'sn', aircraft) for aircraft in (aircrafts or [])],
            'shortages': normalized,
        })
        aircraft_ids = [getattr(aircraft, 'sn', aircraft) for aircraft in (aircrafts or [])]
        self.model.log_event(
            'support_activity',
            service_id or 'unknown_service',
            f"资源不足，等待满足: {normalized}",
            event_type='resource_wait',
            aircrafts=aircraft_ids,
            shortages=normalized,
        )

    def record_resource_requirements(self, requirements, service_id=None, aircrafts=None):
        """记录保障计划生成时的资源需求总量。"""
        if not requirements:
            return
        normalized = {}
        for category in ('facility', 'equipment', 'staff'):
            values = requirements.get(category, {}) or {}
            counter = Counter(values)
            if not counter:
                continue
            self.resource_requirement_history[category].update(counter)
            normalized[category] = dict(counter)
        if not normalized:
            return
        self.resource_requirement_log.append({
            'tick': self.model.ticks,
            'service_id': service_id,
            'aircrafts': [getattr(aircraft, 'sn', aircraft) for aircraft in (aircrafts or [])],
            'requirements': normalized,
        })

    def check_part_availability(self, part):
        """检查备件是否可用"""
        return self.spare_parts.get(part.id, 0) > 0

    def record_part_request(self, fulfilled: bool, part=None):
        self.part_requests += 1
        
        if part:
            # 无论是否立即满足，最终都会消耗备件（库存或调运）
            self.part_consumed_history[part.id] += 1

        if fulfilled:
            self.part_fulfilled_immediately += 1
            if part:
                pid = part.id
                if self.spare_parts.get(pid, 0) > 0:
                    self.spare_parts[pid] -= 1

    def get_overall_equipment_fulfill_rate(self):
        return self.equipment_fulfilled_immediately / self.equipment_requests if self.equipment_requests > 0 else 1.0

    def get_overall_equipment_utilization(self):
        # 统计在仿真周期内有至少一次使用记录的保障设备占全部设备数量的比例
        total_equipments = len(self.equipments_state)
        if total_equipments == 0:
            return 0.0
            
        used_equipments_count = 0
        for instance_id, equipment in self.equipments_state.items():
            # 检查是否有历史使用记录
            has_history = self.equipment_occupied_history.get(instance_id, 0) > 0
            # 检查当前是否有占用
            has_current = len(equipment.get('occupied_times', [])) > 0
            
            if has_history or has_current:
                used_equipments_count += 1
                
        return used_equipments_count / total_equipments

    def get_overall_part_fulfill_rate(self):
        return (self.part_fulfilled_immediately / self.part_requests) if self.part_requests > 0 else 1.0

    def get_overall_part_utilization(self):
        # 备件利用率: 已消耗备件 / 初始备件总数
        total_initial = sum(self.initial_spare_parts.values())
        total_consumed = sum(self.part_consumed_history.values())
        
        return (total_consumed / total_initial) if total_initial > 0 else 0.0
    
    def queue_service_requests(self, aircrafts, task=None, service_id=None, service_mode='preflight'):
        """将待保障的飞机加入请求队列，并立即尝试调度。"""
        new_requests = []
        for aircraft in aircrafts:
            # 避免重复入队
            if any(entry['aircraft'] == aircraft for entry in self.jobs_todo):
                continue
            self.jobs_todo.append({
                'aircraft': aircraft,
                'requested_at': self.model.ticks,
                'task': task,
                'service_id': service_id,
                'service_mode': service_mode,
            })
            new_requests.append(aircraft)
        if new_requests:
            requested_ids = ",".join(str(a.sn) for a in new_requests)
            self.model.log_event(
                'support_activity',
                service_id or getattr(task, 'id', 'service_queue'),
                f"收到飞机 {requested_ids} 的保障请求",
                event_type='request_queued',
                aircrafts=[str(a.sn) for a in new_requests],
                service_mode=service_mode,
            )
            self.process_pending_requests()
    
    def initialize_resources(self):
        """初始化资源状态"""
        # 初始化设施状态
        facilities = self.model.config.get('s_facilities', [])
        for facility in facilities:
            self.facilities_state[facility['Id']] = {
                'facility_SN': facility.get('facility_SN', 'Unknown'),
                'functions': facility.get('functions', []),
                'organization': facility.get('organization'),
                'organization_id': facility.get('organization_id'),
                'occupied_times': []
            }
        
        # 初始化设备状态
        equipments = self.model.config.get('s_equipments', [])
        for equipment in equipments:
            equipment_num = equipment.get('equipment_num', 1)
            for i in range(equipment_num):
                instance_id = f"{equipment['Id']}_instance_{i+1}"
                self.equipments_state[instance_id] = {
                    'equipment_name': equipment.get('equipment_name', 'Unknown'),
                    'base_id': equipment['Id'],
                    'organization': equipment.get('organization'),
                    'organization_id': equipment.get('organization_id'),
                    'occupied_times': []
                }

        # 初始化人力状态
        staffs = self.model.config.get('s_staff', [])
        for staff in staffs:
            staff_num = int(staff.get('num', 0) or 0)
            for i in range(staff_num):
                instance_id = f"{staff['Id']}_instance_{i+1}"
                self.staff_state[instance_id] = {
                    'type_code': staff.get('type_code', 'Unknown'),
                    'base_id': staff['Id'],
                    'organization': staff.get('organization'),
                    'organization_id': staff.get('organization_id'),
                    'occupied_times': []
                }
        self.service_staff_type_codes = {
            staff['type_code']
            for staff in self.staff_state.values()
            if self._resource_matches_scope_tokens(staff, self.service_staff_scope_tokens)
        }
        
        # 初始化备件
        spare_parts = {}
        mapped_supply_names = set()
        supplies = self.model.config.get('s_supplies', [])
        if supplies:
            part_name_to_id = {}
            for aircraft in self.model.aircrafts:
                for part in aircraft.parts:
                    part_name_to_id.setdefault(getattr(part, 'name', None) or getattr(part, 'id', None), part.id)

            for supply in supplies:
                supply_name = supply.get('supply_name')
                if supply_name in part_name_to_id:
                    spare_parts[part_name_to_id[supply_name]] = int(supply.get('quantity', 0) or 0)
                    mapped_supply_names.add(supply_name)
        else:
            # 兼容旧配置：读取aircrafts中的备件比例生成每类备件数量
            for aircraft in self.model.aircrafts:
                for part in aircraft.parts:
                    pid = part.id
                    part_config = next((p for p in aircraft.part_conf if p['Id'] == pid), {})
                    spare_ratio = part_config.get('num_ratio', 0)
                    spare_parts[pid] = spare_parts.get(pid, 0) + spare_ratio

        self.spare_parts = {pid: int(count) for pid, count in spare_parts.items()}
        self.initial_spare_parts = self.spare_parts.copy()
        self.part_consumed_history = defaultdict(int)

        # 初始化一般消耗品库存（如弹药、油液等），按 supply_name 管理
        supplies = self.model.config.get('s_supplies', [])
        self.supply_inventory = {
            supply['supply_name']: int(supply.get('quantity', 0) or 0)
            for supply in supplies
            if supply.get('supply_name') and supply.get('supply_name') not in mapped_supply_names
        }
        self.initial_supply_inventory = self.supply_inventory.copy()

    def consume_job_supplies(self, supply_requirements, event_time, task_id=None, job_name=None):
        """在保障作业执行时消耗一般消耗品，并记录缺口。"""
        for supply_name in supply_requirements or []:
            if supply_name not in self.supply_inventory:
                self.supply_inventory[supply_name] = 0
                if supply_name not in self.initial_supply_inventory:
                    self.initial_supply_inventory[supply_name] = 0

            current_stock = self.supply_inventory.get(supply_name, 0)
            if current_stock > 0:
                self.supply_inventory[supply_name] = current_stock - 1
                self.supply_consumed_history[supply_name] += 1
                self.model.log_event(
                    'support_activity',
                    job_name or task_id or supply_name,
                    f"消耗品 {supply_name} 使用完成，库存 {current_stock} -> {self.supply_inventory[supply_name]}",
                    event_type='supply_consumed',
                    supply_name=supply_name,
                    event_tick=event_time,
                )
            else:
                self.supply_shortage_history[supply_name] += 1
                self.model.log_event(
                    'support_activity',
                    job_name or task_id or supply_name,
                    f"消耗品 {supply_name} 库存不足",
                    event_type='supply_shortage',
                    supply_name=supply_name,
                    event_tick=event_time,
                )
            
    def replenish_spare_parts(self):
        """
        根据s_parts_transportation配置自动补充备件
        """
        # 仅在每天开始时检查 (假设ticks单位为分钟)
        if self.model.ticks % (24 * 60) != 0:
            return

        current_day = self.model.ticks // (24 * 60)
        
        for config in self.transport_configs:
            cycle_days = config.get('cycle_days', 1)
            if cycle_days <= 0: cycle_days = 1
            
            # 检查是否是补给日
            if current_day % cycle_days == 0:
                lru_id = config.get('lru')
                target_num = config.get('target_num', 0)
                trigger_level = config.get('replenishment_trigger_below', 0)
                
                current_stock = self.spare_parts.get(lru_id, 0)
                
                if current_stock <= trigger_level:
                    replenish_amount = target_num - current_stock
                    if replenish_amount > 0:
                        self.spare_parts[lru_id] = target_num
                        self.model.log_event(
                            'support_activity',
                            lru_id,
                            f"备件库存低于阈值，补充 {replenish_amount} 至 {target_num}",
                            event_type='spare_replenished',
                            previous_stock=current_stock,
                            trigger_level=trigger_level,
                            target_num=target_num,
                        )

    def register_aircraft_plan(self, aircraft_id, service_plan):
        """注册飞机的保障计划到全局资源管理器"""
        if not service_plan:
            return
        if 'aircraft_plan' in service_plan:
            aircraft_plan = service_plan['aircraft_plan']
        elif 'tasks' in service_plan:
            aircraft_plan = {'tasks': service_plan['tasks']}
        else:
            return

        plan_record = {
            'aircraft_sn': aircraft_id,
            'plan_start_time': self.model.ticks,
            'tasks': aircraft_plan.get('tasks', []),
            'is_active': True
        }
        
        self.active_plans.append(plan_record)
        
        # 更新资源占用状态
        for task in aircraft_plan.get('tasks', []):
            self._register_task_resources(task, self.model.ticks)
        
        self.model.log_event(
            'support_activity',
            aircraft_id,
            f"注册保障计划，共 {len(aircraft_plan.get('tasks', []))} 个保障作业",
            event_type='plan_registered',
        )
        self.jobs_log.append({
            'aircraft_id': aircraft_id,
            'assigned_at': self.model.ticks,
            'tasks': aircraft_plan.get('tasks', [])
        })
    
    def process_pending_requests(self):
        """尝试为待保障的飞机批量生成计划并分配资源。"""
        pending_entries = [entry for entry in self.jobs_todo if entry['aircraft'].state == "stay"]
        if not pending_entries:
            return

        # 检查TAT计算策略
        tat_method = self.model.config.get('tat_calculation_method', 'service_plan')
        
        if tat_method == 'tat_sampling':
            # 简单模式：仅对每架飞机进行TAT抽样
            for entry in pending_entries:
                aircraft = entry['aircraft']
                # Sample TAT
                tat_sample = self.model.get_time_sample(aircraft.TAT)
                duration = int(tat_sample * 60) # TAT is usually in hours, convert to minutes

                aircraft.preparing_time_remaining = duration
                aircraft.calculated_tat = duration
                aircraft.service_plan = {'method': 'tat_sampling', 'duration': duration}

                if aircraft.state == "stay":
                    aircraft._set_state("in_preparing", reason="TAT 抽样保障开始")

                self.model.log_event(
                    'support_activity',
                    aircraft.sn,
                    f"使用 TAT 抽样，准备时间 {duration} 分钟",
                    event_type='tat_sampled',
                    duration=duration,
                )

                # 将飞机绑定到请求任务（若存在）
                if entry.get('task') and aircraft not in entry['task'].team:
                    entry['task'].team.append(aircraft)

            # 移除已处理的请求
            handled_aircrafts = {entry['aircraft'] for entry in pending_entries}
            self.jobs_todo = [entry for entry in self.jobs_todo if entry['aircraft'] not in handled_aircrafts]
            return

        # Group by service_id
        grouped_entries = defaultdict(list)
        for entry in pending_entries:
            task = entry.get('task')
            service_id = entry.get('service_id') or (getattr(task, 'tat_service_id', None) if task else None)
            organization_id = self._get_aircraft_service_unit(entry['aircraft'])
            grouped_entries[(service_id, organization_id)].append(entry)

        handled_aircrafts_all = set()

        for (service_id, organization_id), entries in grouped_entries.items():
            facilities_state, equipments_state, staffs_state = self.get_current_resource_state(organization_id)
            aircrafts = [entry['aircraft'] for entry in entries]

            try:
                multi_plan = self.model._generate_multiple_aircraft_plans_with_resources(
                
                    aircrafts, facilities_state, equipments_state, staffs_state, service_id=service_id
                )
            except Exception as exc:  # 捕获潜在生成异常，避免阻塞队列
                self.model.log_event('support_activity', service_id or 'unknown_service', f"多机保障计划生成异常: {exc}", event_type='plan_exception')
                continue

            if not multi_plan or 'aircraft_plans' not in multi_plan:
                self.model.log_event('support_activity', service_id or 'unknown_service', "多机保障计划生成失败，保留待处理请求", event_type='plan_failed')
                continue

            aircraft_plans = multi_plan.get('aircraft_plans', [])
            if not aircraft_plans:
                continue

            resource_requirements = multi_plan.get('resource_requirements', {})
            resource_bottlenecks = multi_plan.get('resource_bottlenecks', {})
            self.record_resource_requirements(resource_requirements, service_id=service_id, aircrafts=aircrafts)
            self.record_resource_shortages(resource_bottlenecks, service_id=service_id, aircrafts=aircrafts)

            # 将结果按请求顺序应用
            # Note: aircraft_plans order matches aircrafts list order in _generate_multiple_aircraft_plans_with_resources
            # which matches entries order here.
            for entry, plan_data in zip(entries, aircraft_plans):
                plan_data.setdefault('resource_requirements', resource_requirements)
                plan_data.setdefault('resource_bottlenecks', resource_bottlenecks)
                self._activate_aircraft_plan(entry, plan_data)
                handled_aircrafts_all.add(entry['aircraft'])

        # 移除已处理的请求
        self.jobs_todo = [entry for entry in self.jobs_todo if entry['aircraft'] not in handled_aircrafts_all]
    
    def _register_task_resources(self, task, plan_start_time):
        """注册任务的资源占用"""
        # 注册设施占用
        facility_id = task['required_resources'].get('facility_id')
        if facility_id and facility_id in self.facilities_state:
            occupied_period = {
                'start_time': plan_start_time + task['start_time'],
                'end_time': plan_start_time + task['end_time'],
                'task_id': task['Id'],
                'job_name': task.get('job_name', 'Unknown')
            }
            self.facilities_state[facility_id]['occupied_times'].append(occupied_period)
        
        # 注册设备占用
        allocated_equipments = task['required_resources'].get('allocated_equipments', [])
        for equipment in allocated_equipments:
            instance_id = equipment.get('instance_id')
            if instance_id and instance_id in self.equipments_state:
                occupied_period = {
                    'start_time': plan_start_time + task['start_time'],
                    'end_time': plan_start_time + task['end_time'],
                    'task_id': task['Id'],
                    'job_name': task.get('job_name', 'Unknown')
                }
                self.equipments_state[instance_id]['occupied_times'].append(occupied_period)

        allocated_staff = task['required_resources'].get('allocated_staff', [])
        for staff in allocated_staff:
            instance_id = staff.get('instance_id')
            if instance_id and instance_id in self.staff_state:
                occupied_period = {
                    'start_time': plan_start_time + task['start_time'],
                    'end_time': plan_start_time + task['end_time'],
                    'task_id': task['Id'],
                    'job_name': task.get('job_name', 'Unknown')
                }
                self.staff_state[instance_id]['occupied_times'].append(occupied_period)

        required_supplies = task['required_resources'].get('required_supplies', [])
        if required_supplies:
            self.consume_job_supplies(
                required_supplies,
                event_time=plan_start_time + task['start_time'],
                task_id=task.get('Id'),
                job_name=task.get('job_name')
            )
    
    def cleanup_completed_plans(self):
        """清理已完成的保障计划"""
        current_time = self.model.ticks
        
        # 清理过期的资源占用记录
        for facility_id, facility in self.facilities_state.items():
            facility['occupied_times'] = [
                period for period in facility['occupied_times']
                if period['end_time'] > current_time
            ]
        
        for equipment_id, equipment in self.equipments_state.items():
            # 累加已完成的占用时间
            for period in equipment['occupied_times']:
                if period['end_time'] <= current_time:
                    duration = period['end_time'] - period['start_time']
                    self.equipment_occupied_history[equipment_id] += duration

            equipment['occupied_times'] = [
                period for period in equipment['occupied_times']
                if period['end_time'] > current_time
            ]

        for staff_id, staff in self.staff_state.items():
            for period in staff['occupied_times']:
                if period['end_time'] <= current_time:
                    duration = period['end_time'] - period['start_time']
                    self.staff_occupied_history[staff_id] += duration

            staff['occupied_times'] = [
                period for period in staff['occupied_times']
                if period['end_time'] > current_time
            ]
        
        # 清理已完成的计划记录
        active_plans = []
        for plan in self.active_plans:
            if not plan['is_active']:
                continue
            has_future_work = any(
                task['end_time'] + plan['plan_start_time'] > current_time
                for task in plan['tasks']
            )
            if has_future_work:
                active_plans.append(plan)
            else:
                plan['is_active'] = False
                self.model.log_event(
                    'support_activity',
                    plan.get('aircraft_sn', 'unknown_aircraft'),
                    "保障计划执行完成",
                    event_type='plan_completed',
                    completed_jobs=len(plan.get('tasks', [])),
                )
        self.active_plans = active_plans
    
    @staticmethod
    def _normalize_organization_token(value):
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def _build_organization_indexes(self):
        organizations = self.model.config.get('organization', []) or []
        normalized_rows = []

        for index, org in enumerate(organizations, 1):
            if not isinstance(org, dict):
                continue
            name = self._normalize_organization_token(
                org.get('name') or org.get('组织名称') or org.get('organization_name')
            )
            org_id = self._normalize_organization_token(
                org.get('Id') or org.get('id') or org.get('uid') or org.get('organization_id')
            )
            if not org_id:
                org_id = name or f"org_{index}"
            if not name:
                name = org_id

            self.organization_id_to_name[org_id] = name
            self.organization_name_to_ids[name].add(org_id)
            normalized_rows.append((org_id, org))

        for org_id, org in normalized_rows:
            parent = self._normalize_organization_token(
                org.get('parent') or org.get('上级组织') or org.get('parent_id')
            )
            if not parent:
                continue
            parent_id = self._resolve_organization_id(parent) or parent
            self.organization_parent[org_id] = parent_id
            self.organization_children[parent_id].add(org_id)

    def _resolve_organization_id(self, token):
        token = self._normalize_organization_token(token)
        if not token:
            return None
        if token in self.organization_id_to_name:
            return token
        ids = self.organization_name_to_ids.get(token)
        if ids:
            return sorted(ids)[0]
        return None

    def _organization_identity_tokens(self, organization_id):
        token = self._normalize_organization_token(organization_id)
        if not token:
            return set()
        tokens = {token}
        resolved_id = self._resolve_organization_id(token)
        if resolved_id:
            tokens.add(resolved_id)
            name = self.organization_id_to_name.get(resolved_id)
            if name:
                tokens.add(name)
        return tokens

    def _organization_scope_tokens(self, organization_id):
        token = self._normalize_organization_token(organization_id)
        if not token:
            return set()
        if token in self._organization_scope_cache:
            return self._organization_scope_cache[token]

        root_id = self._resolve_organization_id(token)
        if not root_id:
            scope = self._organization_identity_tokens(token)
            self._organization_scope_cache[token] = scope
            return scope

        scope = set()
        stack = [root_id]
        while stack:
            org_id = stack.pop()
            if org_id in scope:
                continue
            scope.add(org_id)
            name = self.organization_id_to_name.get(org_id)
            if name:
                scope.add(name)
            stack.extend(self.organization_children.get(org_id, set()))

        scope.update(self._organization_identity_tokens(token))
        self._organization_scope_cache[token] = scope
        return scope

    def _resource_organization_tokens(self, resource):
        tokens = set()
        for key in ('organization_id', 'organization'):
            token = self._normalize_organization_token(resource.get(key))
            if not token:
                continue
            tokens.update(self._organization_identity_tokens(token))
        return tokens

    def _resource_matches_scope_tokens(self, resource, scope_tokens, allow_unassigned=False):
        if not scope_tokens:
            return True
        resource_tokens = self._resource_organization_tokens(resource)
        if not resource_tokens:
            return allow_unassigned
        return bool(resource_tokens & scope_tokens)

    def _get_aircraft_service_unit(self, aircraft):
        aircraft_conf = getattr(aircraft, 'aircraft_conf', {}) or {}
        if not isinstance(aircraft_conf, dict):
            return None
        raw_unit = (
            aircraft_conf.get('service_unit_id')
            or aircraft_conf.get('supportOrganizationId')
            or aircraft_conf.get('organization_id')
            or aircraft_conf.get('service_unit')
            or aircraft_conf.get('supportOrganizationName')
            or aircraft_conf.get('organization')
            or aircraft_conf.get('unit_name')
        )
        return self._resolve_organization_id(raw_unit) or raw_unit

    def _resource_matches_organization(self, resource, organization_id, allow_unassigned=False):
        if not organization_id:
            return True
        scope_tokens = self._organization_scope_tokens(organization_id)
        return self._resource_matches_scope_tokens(resource, scope_tokens, allow_unassigned=allow_unassigned)

    def get_current_resource_state(self, organization_id=None):
        """获取当前资源占用状态，用于新的保障计划生成"""
        self.cleanup_completed_plans()
        aircraft_scope_tokens = self._organization_scope_tokens(organization_id)
        service_scope_tokens = self.service_staff_scope_tokens
        
        # 构建适合ServicePlan使用的资源状态
        facilities_for_service_plan = []
        for facility_id, facility in self.facilities_state.items():
            if not self._resource_matches_organization(facility, organization_id, allow_unassigned=True):
                continue
            facility_copy = {
                'Id': facility_id,
                'facility_SN': facility['facility_SN'],
                'functions': facility['functions'],
                'organization': facility.get('organization'),
                'organization_id': facility.get('organization_id'),
                'occupied_times': facility['occupied_times'].copy()
            }
            facilities_for_service_plan.append(facility_copy)
        
        equipments_for_service_plan = []
        equipment_groups = {}
        
        # 按照基础设备ID分组
        for instance_id, equipment in self.equipments_state.items():
            if not self._resource_matches_organization(equipment, organization_id):
                continue
            base_id = equipment['base_id']
            if base_id not in equipment_groups:
                equipment_groups[base_id] = []
            
            equipment_instance = {
                'Id': base_id,
                'equipment_name': equipment['equipment_name'],
                'instance_id': instance_id,
                'organization': equipment.get('organization'),
                'organization_id': equipment.get('organization_id'),
                'occupied_times': equipment['occupied_times'].copy()
            }
            equipment_groups[base_id].append(equipment_instance)
        
        # 展平设备实例
        for instances in equipment_groups.values():
            equipments_for_service_plan.extend(instances)

        staffs_for_service_plan = []
        staff_groups = {}
        for instance_id, staff in self.staff_state.items():
            is_aircraft_staff = self._resource_matches_scope_tokens(staff, aircraft_scope_tokens) if organization_id else True
            is_service_staff = self._resource_matches_scope_tokens(staff, service_scope_tokens) if service_scope_tokens else False
            if organization_id and not (is_aircraft_staff or is_service_staff):
                continue
            base_id = staff['base_id']
            if base_id not in staff_groups:
                staff_groups[base_id] = []

            staff_instance = {
                'Id': base_id,
                'type_code': staff['type_code'],
                'instance_id': instance_id,
                'organization': staff.get('organization'),
                'organization_id': staff.get('organization_id'),
                'is_aircraft_staff': is_aircraft_staff,
                'is_service_staff': is_service_staff,
                'occupied_times': staff['occupied_times'].copy()
            }
            staff_groups[base_id].append(staff_instance)

        for instances in staff_groups.values():
            staffs_for_service_plan.extend(instances)

        return facilities_for_service_plan, equipments_for_service_plan, staffs_for_service_plan
    
    def _activate_aircraft_plan(self, queue_entry, plan_data):
        """激活单架飞机的保障计划，并更新飞机状态。"""
        aircraft = queue_entry['aircraft']
        tasks = plan_data.get('tasks', [])
        service_plan_payload = {
            'aircraft_plan': {
                'aircraft_sn': plan_data.get('aircraft_sn', aircraft.sn),
                'tasks': tasks,
                'facility_switches': plan_data.get('facility_switches')
            },
            'total_duration': max((task.get('end_time', 0) for task in tasks), default=0),
            'generation_method': 'global_resource_manager',
            'resource_requirements': plan_data.get('resource_requirements', {}),
            'resource_bottlenecks': plan_data.get('resource_bottlenecks', {})
        }

        self.register_aircraft_plan(aircraft.sn, service_plan_payload)

        total_duration = int(service_plan_payload['total_duration']) if service_plan_payload['total_duration'] else int(max((task.get('duration', 0) for task in tasks), default=0))
        if total_duration <= 0:
            total_duration = int(max(aircraft.TAT * 60, 10))

        aircraft.service_plan = service_plan_payload
        aircraft.service_mode = queue_entry.get('service_mode') or 'preflight'
        aircraft.calculated_tat = total_duration
        aircraft.preparing_time_remaining = total_duration
        if aircraft.state == "stay":
            aircraft._set_state("in_preparing", reason="分配保障计划")
        self.model.log_event(
            'support_activity',
            aircraft.sn,
            f"分配多机保障计划，预计准备 {total_duration} 分钟",
            event_type='plan_assigned',
            task_count=len(tasks),
            total_duration=total_duration,
        )

        # 将飞机绑定到请求任务（若存在）
        if queue_entry.get('task') and aircraft not in queue_entry['task'].team:
            queue_entry['task'].team.append(aircraft)

    def generate_new_multi_aircraft_plan(self, aircrafts_or_count):
        """供调试/测试使用，根据当前资源状态生成新多机计划。"""
        if isinstance(aircrafts_or_count, int):
            target_aircrafts = [a for a in self.model.aircrafts if a.state == "stay"][:aircrafts_or_count]
        else:
            target_aircrafts = list(aircrafts_or_count)

        if not target_aircrafts:
            return None

        organization_ids = {self._get_aircraft_service_unit(aircraft) for aircraft in target_aircrafts}
        organization_id = next(iter(organization_ids)) if len(organization_ids) == 1 else None
        facilities_state, equipments_state, staffs_state = self.get_current_resource_state(organization_id)
        return self.model._generate_multiple_aircraft_plans_with_resources(target_aircrafts, facilities_state, equipments_state, staffs_state)
    
    # ========== 资源分配辅助方法 ==========
    
    def get_equipment_by_id(self, equipment_id, equipments_list):
        '''根据设备ID获取该类型的所有设备实例'''
        return [equip for equip in equipments_list if equip['Id'] == equipment_id]
    
    def is_equipment_available(self, equipment, start_time, duration):
        '''检查保障设备在指定时间段内是否可用'''
        end_time = start_time + duration
        for occupied in equipment.get('occupied_times', []):
            if not (end_time <= occupied['start_time'] or start_time >= occupied['end_time']):
                return False
        return True
    
    def is_facility_available(self, facility, start_time, duration):
        '''检查保障设施在指定时间段内是否可用'''
        end_time = start_time + duration
        for occupied in facility.get('occupied_times', []):
            if not (end_time <= occupied['start_time'] or start_time >= occupied['end_time']):
                return False
        return True
    
    def _find_earliest_slot_equipment(self, equipment, desired_start, duration):
        '''在设备中找到最早可用的时间槽'''
        start_time = max(0, desired_start)
        while True:
            conflict = None
            for occupied in equipment.get('occupied_times', []):
                if start_time + duration <= occupied['start_time'] or start_time >= occupied['end_time']:
                    continue
                conflict = occupied
                start_time = occupied['end_time']
                break
            if conflict is None:
                return start_time
    
    def _find_earliest_slot(self, facility, desired_start, duration):
        '''在设施中找到最早可用的时间槽'''
        start_time = max(0, desired_start)
        while True:
            conflict = None
            for occupied in facility.get('occupied_times', []):
                if start_time + duration <= occupied['start_time'] or start_time >= occupied['end_time']:
                    continue
                conflict = occupied
                start_time = occupied['end_time']
                break
            if conflict is None:
                return start_time
    
    def allocate_equipment(self, job, desired_start, equipments_list):
        '''为作业分配保障设备，并找到最早可用的时间槽'''
        equip_requirements = job.get('equip_req') or []
        if not equip_requirements:
            return [], desired_start
        
        max_start_time = desired_start
        allocated_equipments = []
        
        for equip_id in equip_requirements:
            equipment_instances = self.get_equipment_by_id(equip_id, equipments_list)
            
            if not equipment_instances:
                return None, desired_start
            
            best_equipment = None
            best_start = None
            
            for equipment in equipment_instances:
                slot_start = self._find_earliest_slot_equipment(equipment, desired_start, job['duration'])
                if best_start is None or slot_start < best_start:
                    best_start = slot_start
                    best_equipment = equipment
            
            if best_equipment is None or best_start is None:
                return None, desired_start
            
            if best_start > max_start_time:
                max_start_time = best_start
            
            allocated_equipments.append({
                'equipment': best_equipment,
                'earliest_start': best_start
            })
        
        final_allocated = []
        actual_start_time = max_start_time
        
        for equip_id in equip_requirements:
            equipment_instances = self.get_equipment_by_id(equip_id, equipments_list)
            selected_equipment = None
            min_delay = float('inf')
            
            for equipment in equipment_instances:
                if self.is_equipment_available(equipment, actual_start_time, job['duration']):
                    selected_equipment = equipment
                    break
                else:
                    next_slot = self._find_earliest_slot_equipment(equipment, actual_start_time, job['duration'])
                    delay = next_slot - actual_start_time
                    if delay < min_delay:
                        min_delay = delay
                        selected_equipment = equipment
            
            if selected_equipment is None:
                return None, desired_start
            
            if not self.is_equipment_available(selected_equipment, actual_start_time, job['duration']):
                new_start = self._find_earliest_slot_equipment(selected_equipment, actual_start_time, job['duration'])
                if new_start > actual_start_time:
                    return self.allocate_equipment(job, new_start, equipments_list)
            
            final_allocated.append(selected_equipment)
        
        for equipment in final_allocated:
            occupied_entry = {
                'start_time': actual_start_time,
                'end_time': actual_start_time + job['duration'],
                'job_id': job['Id']
            }
            equipment['occupied_times'].append(occupied_entry)
            equipment['occupied_times'].sort(key=lambda item: item['start_time'])
        
        return final_allocated, actual_start_time
    
    def allocate_facility(self, job, desired_start, facilities_list, current_facility=None):
        '''为作业分配设施，并找到最早可用的时间槽'''
        requirements = job.get('facility_req') or []
        if not requirements:
            return None, desired_start
        
        candidate_facilities = [
            fac for fac in facilities_list 
            if all(req in fac.get('functions', []) for req in requirements)
        ]
        if not candidate_facilities:
            return None, desired_start
        
        priority_facilities = []
        other_facilities = []
        
        if current_facility and current_facility in candidate_facilities:
            priority_facilities.append(current_facility)
            other_facilities = [fac for fac in candidate_facilities if fac != current_facility]
        else:
            other_facilities = candidate_facilities
        
        best_facility = None
        best_start = None
        is_current_facility = False
        
        for facility in priority_facilities:
            slot_start = self._find_earliest_slot(facility, desired_start, job['duration'])
            tolerance = job['duration'] * 0.2
            
            if best_start is None or slot_start <= desired_start + tolerance:
                best_start = slot_start
                best_facility = facility
                is_current_facility = True
                if slot_start <= desired_start + tolerance:
                    break
        
        if not is_current_facility or best_start > desired_start + job['duration'] * 0.2:
            for facility in other_facilities:
                slot_start = self._find_earliest_slot(facility, desired_start, job['duration'])
                if best_start is None or slot_start < best_start:
                    best_start = slot_start
                    best_facility = facility
                    is_current_facility = False
        
        if best_facility is not None:
            occupied_entry = {
                'start_time': best_start,
                'end_time': best_start + job['duration'],
                'job_id': job['Id']
            }
            best_facility['occupied_times'].append(occupied_entry)
            best_facility['occupied_times'].sort(key=lambda item: item['start_time'])
        
        return best_facility, best_start if best_start is not None else desired_start
    
    def estimate_facility_available_time(self, job, desired_start, facilities_list):
        '''估算设施可用时间'''
        requirements = job.get('facility_req', [])
        if not requirements:
            return desired_start
        
        candidate_facilities = [
            fac for fac in facilities_list 
            if all(req in fac.get('functions', []) for req in requirements)
        ]
        
        if not candidate_facilities:
            return desired_start
        
        min_available = float('inf')
        for facility in candidate_facilities:
            available_time = self._find_earliest_slot(facility, desired_start, job['duration'])
            min_available = min(min_available, available_time)
        
        return min_available if min_available != float('inf') else desired_start
    
    def estimate_equipment_available_time(self, job, desired_start, equipments_list):
        '''估算设备可用时间'''
        equip_requirements = job.get('equip_req', [])
        if not equip_requirements:
            return desired_start
        
        max_available = desired_start
        for equip_id in equip_requirements:
            equipment_instances = self.get_equipment_by_id(equip_id, equipments_list)
            if not equipment_instances:
                continue
            
            min_slot = float('inf')
            for equipment in equipment_instances:
                slot = self._find_earliest_slot_equipment(equipment, desired_start, job['duration'])
                min_slot = min(min_slot, slot)
            
            if min_slot != float('inf'):
                max_available = max(max_available, min_slot)
        
        return max_available
