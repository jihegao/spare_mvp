import random
from collections import Counter

class Task:
    '''
    'task_name': '训练任务',
    'task_stages': [{'Id': '1589080',
        'stage_seq': 1,
        'stage_name': '2507050200000002',
        'system_num': 4,
        'system_num_min': 4,
        'stage_proportion': 0.3},
        ...
    '''
    def __init__(
        self,
        model,
        id,
        aircraft_id,
        name,
        task_hrs,
        stages,
        start_hour=0,
        prep_time=3,
        task_config=None,
        operation_config=None,
    ):
        self.id = id
        self.model = model
        self.aircraft_id = aircraft_id
        self.aircraft_name = next((a.aircraft_name for a in model.aircrafts if a.Id == aircraft_id), 'aircraft') if aircraft_id else 'any_aircraft'
        self.task_config = task_config if isinstance(task_config, dict) else {}
        self.operation_config = operation_config if isinstance(operation_config, dict) else {}
        self.name = name
        self.hrs = task_hrs
        self.hrs_covered = 0
        self.stages = []
        self.start_hour = start_hour
        self.preparation_minutes = self._resolve_preparation_minutes(prep_time)
        self.prep_time = self.preparation_minutes / 60
        self.cancel_minutes = self._coerce_non_negative_int(
            self._first_config_value('cancel_minutes', 'cancelMinutes'),
            default=0,
        )
        self.dispatch_hour = self._resolve_dispatch_hour()
        self.group_name = str(self._first_config_value('group_name', 'groupName', 'unit_name', 'unitName', default='') or '').strip()
        self.troops = self._normalize_troops(self._first_config_value('troops', 'task_troops', default=[]))
        self.tat_service_id = self._first_config_value('tat_service_id', 'tatServiceId', 'refly_service_model', 'reflyServiceModel')
        self.postflight_service_id = self.operation_config.get('postflight_service_id') or self.operation_config.get('postflightServiceId')
        explicit_minimum = self._first_config_value(
            'minimum_equipment_quantity',
            'minimumEquipmentQuantity',
            'minimum_equipment_count',
            'minimumEquipmentCount',
        )
        self.minimum_equipment_quantity = (
            self._coerce_non_negative_int(explicit_minimum, default=0)
            if explicit_minimum not in (None, '')
            else None
        )
        self.success = True
        self.status = 'pending'
        ticks_from_start = 0
        for stage_data in stages:
            stage_length = round(task_hrs * stage_data['stage_proportion'])
            system_num_min = stage_data['system_num_min']
            if self.minimum_equipment_quantity is not None:
                system_num_min = self.minimum_equipment_quantity
            stage = {
                "seq":stage_data['stage_seq'],
                "system_num":stage_data['system_num'],
                "system_num_min":system_num_min,
                "time_proportion":stage_data['stage_proportion'],
                "stage_length": stage_length
            }
            self.stages.append(stage)
        if self.minimum_equipment_quantity is None:
            self.minimum_equipment_quantity = self._minimum_active_aircraft_count()
        
        self.team = []
        self.team_record = []
        
        # 再次出动准备时间统计
        self.preparation_start_time = None
        self.preparation_end_time = None
        self.turnaround_time = None
        self.failure_context = None
        
        self.model.tasks.append(self)

    def _log_event(self, message, event_type='activity', **details):
        return self.model.log_event('task', self.id, message, event_type=event_type, task_name=self.name, status=self.status, **details)

    def _set_status(self, new_status, reason=None, **details):
        old_status = self.status
        self.status = new_status
        return self.model.log_state_change(
            'task',
            self.id,
            old_status,
            new_status,
            reason=reason,
            task_name=self.name,
            **details,
        )

    def _first_config_value(self, *keys, default=None):
        for source in (self.operation_config, self.task_config):
            for key in keys:
                if key in source and source[key] not in (None, ''):
                    return source[key]
        return default

    def _coerce_non_negative_int(self, value, default=0):
        try:
            number = float(value)
        except (TypeError, ValueError):
            return default
        if number < 0:
            return default
        return int(number)

    def _resolve_preparation_minutes(self, prep_time):
        explicit_minutes = self._first_config_value(
            'preparation_minutes',
            'preparationMinutes',
            'prepare_minutes',
            'prepareMinutes',
        )
        if explicit_minutes not in (None, ''):
            return self._coerce_non_negative_int(explicit_minutes, default=0)
        try:
            return max(0, int(float(prep_time) * 60))
        except (TypeError, ValueError):
            return 0

    def _parse_clock_hour(self, value):
        if isinstance(value, (int, float)):
            return float(value)
        text = str(value or '').strip()
        if not text:
            return None
        if 'T' in text:
            text = text.split('T', 1)[1]
        text = text[:5]
        parts = text.split(':')
        if len(parts) != 2:
            return None
        try:
            return int(parts[0]) + int(parts[1]) / 60
        except ValueError:
            return None

    def _resolve_dispatch_hour(self):
        explicit_hour = self._first_config_value('task_dispatch_hour', 'dispatch_hour', 'dispatchHour')
        if explicit_hour not in (None, ''):
            try:
                return float(explicit_hour)
            except (TypeError, ValueError):
                pass

        repeat_index = self._coerce_non_negative_int(self.operation_config.get('repeat_index'), default=0)
        if repeat_index == 0:
            dispatch_time = self._first_config_value('task_dispatch_time', 'taskDispatchTime', 'dispatch_time', 'dispatchTime')
            parsed_hour = self._parse_clock_hour(dispatch_time)
            if parsed_hour is not None:
                return (int(self.start_hour // 24) * 24) + parsed_hour

        return max(0, self.start_hour - self.preparation_minutes / 60)

    def _normalize_troops(self, raw_troops):
        if isinstance(raw_troops, dict):
            raw_troops = raw_troops.get('items', raw_troops.get('troops', []))
        if not isinstance(raw_troops, list):
            return []
        troops = []
        for troop in raw_troops:
            if isinstance(troop, dict):
                troops.append(troop)
            elif troop not in (None, ''):
                troops.append({'aircraftNo': str(troop).strip()})
        return troops

    def _aircraft_tokens(self, aircraft):
        aircraft_conf = getattr(aircraft, 'aircraft_conf', {}) or {}
        values = [
            getattr(aircraft, 'Id', None),
            getattr(aircraft, 'sn', None),
            getattr(aircraft, 'unit_id', None),
        ]
        if isinstance(aircraft_conf, dict):
            values.extend([
                aircraft_conf.get('Id'),
                aircraft_conf.get('SN'),
                aircraft_conf.get('aircraftNo'),
                aircraft_conf.get('aircraft_no'),
            ])
        return {str(value).strip() for value in values if value not in (None, '')}

    def _troop_for_aircraft(self, aircraft):
        aircraft_tokens = self._aircraft_tokens(aircraft)
        for troop in self.troops:
            troop_tokens = {
                str(troop.get(key)).strip()
                for key in ('unitId', 'unit_id', 'aircraftNo', 'aircraft_no', 'SN', 'sn', 'Id', 'id', 'aircraft_id')
                if troop.get(key) not in (None, '')
            }
            if aircraft_tokens.intersection(troop_tokens):
                return troop
        return None

    def _base_aircraft_match(self, aircraft):
        return (
            self.aircraft_id is None
            or aircraft.Id == self.aircraft_id
            or getattr(aircraft, 'unit_id', None) == self.aircraft_id
            or aircraft.aircraft_name == self.aircraft_id
        )

    def _group_match(self, aircraft):
        if not self.group_name:
            return True
        aircraft_conf = getattr(aircraft, 'aircraft_conf', {}) or {}
        group_values = [getattr(aircraft, 'unit_name', None)]
        if isinstance(aircraft_conf, dict):
            group_values.extend([
                aircraft_conf.get('unit_name'),
                aircraft_conf.get('groupName'),
                aircraft_conf.get('group_name'),
            ])
        return any(str(value).strip() == self.group_name for value in group_values if value not in (None, ''))

    def _matches_aircraft(self, aircraft):
        if self.troops:
            return self._troop_for_aircraft(aircraft) is not None
        return self._base_aircraft_match(aircraft) and self._group_match(aircraft)

    def _matching_aircrafts(self):
        return [aircraft for aircraft in self.model.aircrafts if self._matches_aircraft(aircraft)]

    def _aircraft_member_no(self, aircraft):
        aircraft_conf = getattr(aircraft, 'aircraft_conf', {}) or {}
        for value in (
            getattr(aircraft, 'sn', None),
            aircraft_conf.get('SN') if isinstance(aircraft_conf, dict) else None,
            aircraft_conf.get('aircraftNo') if isinstance(aircraft_conf, dict) else None,
            getattr(aircraft, 'unit_id', None),
            getattr(aircraft, 'Id', None),
        ):
            if value not in (None, ''):
                return str(value).strip()
        return ''

    def _task_aircraft_type_tokens(self):
        values = [
            self.aircraft_id,
            self.aircraft_name,
            self.task_config.get('aircraft'),
            self.task_config.get('aircraft_name'),
            self.task_config.get('equipment_type'),
            self.task_config.get('装备型号'),
        ]
        return {str(value).strip() for value in values if value not in (None, '', 'aircraft', 'any_aircraft')}

    def _same_task_aircraft_type(self, aircraft):
        expected = self._task_aircraft_type_tokens()
        if not expected:
            return True
        aircraft_conf = getattr(aircraft, 'aircraft_conf', {}) or {}
        values = [
            getattr(aircraft, 'aircraft_name', None),
            getattr(aircraft, 'Id', None),
            getattr(aircraft, 'unit_id', None),
        ]
        if isinstance(aircraft_conf, dict):
            values.extend([
                aircraft_conf.get('aircraft_name'),
                aircraft_conf.get('type'),
                aircraft_conf.get('model'),
            ])
        return any(str(value).strip() in expected for value in values if value not in (None, ''))

    def _configured_member_numbers(self):
        member_numbers = set()
        for operation in getattr(self.model, 'operation', []) or []:
            for task in operation.get('tasks', []):
                for troop in task.get('troops') or []:
                    if not isinstance(troop, dict):
                        continue
                    for key in ('aircraftNo', 'aircraft_no', 'SN', 'sn'):
                        value = troop.get(key)
                        if value not in (None, ''):
                            member_numbers.add(str(value).strip())
        return member_numbers

    def _is_unformed_aircraft(self, aircraft):
        member_no = self._aircraft_member_no(aircraft)
        return bool(member_no) and member_no not in self._configured_member_numbers()

    def _can_select_replacement_aircraft(self, aircraft):
        return (
            all(aircraft is not assigned for assigned in self.team)
            and getattr(aircraft, 'state', None) in ("ready", "stay")
            and getattr(aircraft, 'my_task', None) is None
            and aircraft.is_available()
            and self._same_task_aircraft_type(aircraft)
            and self._is_unformed_aircraft(aircraft)
        )

    def _required_aircraft_count(self):
        if not self.stages:
            return 0
        return max(0, int(self.stages[0].get('system_num', 0) or 0))

    def _minimum_active_aircraft_count(self, stage_index=1):
        if not self.stages:
            return 0
        index = min(stage_index, len(self.stages) - 1)
        return max(0, int(self.stages[index].get('system_num_min', 0) or 0))

    def _cancel_deadline_ticks(self):
        return int(self.start_hour * 60 + self.cancel_minutes)

    def _request_window_end_ticks(self):
        return max(int(self.start_hour * 60), self._cancel_deadline_ticks())

    def _can_select_aircraft(self, aircraft):
        return (
            all(aircraft is not assigned for assigned in self.team)
            and getattr(aircraft, 'state', None) in ("ready", "stay")
            and getattr(aircraft, 'my_task', None) is None
            and aircraft.is_available()
            and self._matches_aircraft(aircraft)
        )

    def _aircraft_sort_key(self, aircraft):
        return (
            str(getattr(aircraft, 'sn', '') or ''),
            str(getattr(aircraft, 'unit_id', '') or ''),
            str(getattr(aircraft, 'Id', '') or ''),
        )

    def _select_aircrafts(self, available_aircrafts, count):
        if count <= 0:
            return []
        if self.troops:
            selected = []
            selected_ids = set()
            for troop in self.troops:
                for aircraft in available_aircrafts:
                    if id(aircraft) in selected_ids:
                        continue
                    if self._troop_for_aircraft(aircraft) is troop:
                        selected.append(aircraft)
                        selected_ids.add(id(aircraft))
                        break
                if len(selected) >= count:
                    break
            return selected
        if self.group_name:
            return sorted(available_aircrafts, key=self._aircraft_sort_key)[:count]
        return random.sample(available_aircrafts, min(count, len(available_aircrafts)))

    def _apply_troop_metadata(self, aircraft):
        troop = self._troop_for_aircraft(aircraft)
        if not troop:
            return
        organization = (
            troop.get('supportOrganizationName')
            or troop.get('support_org_name')
            or troop.get('service_unit')
            or troop.get('organization')
        )
        organization_id = (
            troop.get('supportOrganizationId')
            or troop.get('support_org_id')
            or troop.get('service_unit_id')
            or troop.get('organization_id')
        )
        if not organization and not organization_id:
            return
        if not isinstance(getattr(aircraft, 'aircraft_conf', None), dict):
            aircraft.aircraft_conf = {}
        if organization:
            aircraft.aircraft_conf['service_unit'] = organization
            aircraft.aircraft_conf['supportOrganizationName'] = organization
        if organization_id:
            aircraft.aircraft_conf['service_unit_id'] = organization_id
            aircraft.aircraft_conf['supportOrganizationId'] = organization_id

    def _collect_resource_shortages(self, waiting_aircrafts):
        facility_counter = Counter()
        equipment_counter = Counter()
        staff_counter = Counter()

        for aircraft in waiting_aircrafts:
            service_plan = aircraft.service_plan if isinstance(aircraft.service_plan, dict) else {}
            bottlenecks = service_plan.get('resource_bottlenecks', {})
            facility_counter.update(bottlenecks.get('facility', {}) or {})
            equipment_counter.update(bottlenecks.get('equipment', {}) or {})
            staff_counter.update(bottlenecks.get('staff', {}) or {})

        shortages = []
        if facility_counter:
            details = ', '.join(f"{name}x{count}" for name, count in facility_counter.most_common())
            shortages.append({'短板类型': '保障站位不足', '短板明细': details})
        if equipment_counter:
            details = ', '.join(f"{name}x{count}" for name, count in equipment_counter.most_common())
            shortages.append({'短板类型': '保障设备不足', '短板明细': details})
        if staff_counter:
            details = ', '.join(f"{name}x{count}" for name, count in staff_counter.most_common())
            shortages.append({'短板类型': '保障人员不足', '短板明细': details})
        if not shortages and waiting_aircrafts:
            shortages.append({'短板类型': '保障准备超时', '短板明细': '保障流程未在任务准备窗口内完成'})

        return shortages

    def _build_failure_context(self, required_min, active_aircraft_count):
        matching_aircrafts = self._matching_aircrafts()
        state_counter = Counter(aircraft.state for aircraft in matching_aircrafts)
        team_state_counter = Counter(aircraft.state for aircraft in self.team)
        waiting_aircrafts = [aircraft for aircraft in self.team if aircraft.state in {'stay', 'in_preparing'}]

        shortages = []
        if state_counter.get('in_repairing', 0) > 0:
            shortages.append({
                '短板类型': '故障维修',
                '短板明细': f"{state_counter['in_repairing']} 架飞机处于故障维修状态",
            })
        if state_counter.get('in_maintenance', 0) > 0:
            shortages.append({
                '短板类型': '预防性维修',
                '短板明细': f"{state_counter['in_maintenance']} 架飞机处于预防性维修状态",
            })
        if team_state_counter.get('early_returning', 0) > 0:
            shortages.append({
                '短板类型': '任务中故障返航',
                '短板明细': f"{team_state_counter['early_returning']} 架任务飞机因故障提前返航",
            })
        shortages.extend(self._collect_resource_shortages(waiting_aircrafts))

        if not shortages:
            shortages.append({
                '短板类型': '可用飞机不足',
                '短板明细': '任务开始时可用飞机数量不足，无法满足最低编成要求',
            })

        return {
            '任务最低编成需求': required_min,
            '失败时在任务中的飞机数': active_aircraft_count,
            '失败时任务队伍状态分布': dict(team_state_counter),
            '失败时该机型状态分布': dict(state_counter),
            '资源短板': shortages,
        }


    def find_aircrafts(self, a_num) -> None:
        self._set_status('requesting_aircraft', reason=f"寻找 {a_num} 架 {self.aircraft_name}")
        self._log_event(f"正在寻找 {a_num} 架 {self.aircraft_name}", event_type='dispatch_request', requested_aircraft_count=a_num)
        available_aircrafts = [a for a in self.model.aircrafts if self._can_select_aircraft(a)]
        
        selected_aircrafts = self._select_aircrafts(available_aircrafts, a_num)
        
        if selected_aircrafts:
            self.preparation_start_time = self.model.ticks
            self._set_status('preparing', reason=f"已选中 {len(selected_aircrafts)} 架飞机进入保障准备")
        
        # 将选中的飞机添加到任务队伍
        for a in selected_aircrafts:
            self._apply_troop_metadata(a)
            a.my_task = self
            self.team.append(a)
            self.team_record.append(a)
            self._log_event(f"加入飞机 {a.sn}", event_type='aircraft_assigned', aircraft_sn=a.sn)
        
        # 对所有选中的飞机生成多机保障计划（考虑资源约束）
        if selected_aircrafts and any(a.state == "stay" for a in selected_aircrafts):
            self.make_service_request(selected_aircrafts)

    def _replace_failed_troop_member(self, replacement_aircraft):
        replacement_no = self._aircraft_member_no(replacement_aircraft)
        if not replacement_no:
            return None

        failed_aircrafts = [a for a in self.team if getattr(a, 'state', None) == 'early_returning']
        failed_member_numbers = {self._aircraft_member_no(a) for a in failed_aircrafts}
        replace_index = None

        for index, troop in enumerate(self.troops):
            if not isinstance(troop, dict):
                continue
            troop_no = str(troop.get('aircraftNo') or troop.get('aircraft_no') or troop.get('SN') or troop.get('sn') or '').strip()
            if troop_no in failed_member_numbers:
                replace_index = index
                break

        if replace_index is None:
            replace_index = len(self.troops)
            self.troops.append({})

        old_troop = self.troops[replace_index] if isinstance(self.troops[replace_index], dict) else {}
        old_member = str(old_troop.get('aircraftNo') or old_troop.get('aircraft_no') or old_troop.get('SN') or old_troop.get('sn') or '').strip()
        new_troop = dict(old_troop)
        new_troop['aircraftNo'] = replacement_no
        self.troops[replace_index] = new_troop
        if isinstance(self.operation_config, dict):
            self.operation_config['troops'] = self.troops
        return old_member

    def find_replacement_aircrafts(self, a_num) -> None:
        if a_num <= 0:
            return
        available_aircrafts = [a for a in self.model.aircrafts if self._can_select_replacement_aircraft(a)]
        selected_aircrafts = sorted(available_aircrafts, key=self._aircraft_sort_key)[:a_num]
        for aircraft in selected_aircrafts:
            old_member = self._replace_failed_troop_member(aircraft)
            aircraft.my_task = self
            self.team.append(aircraft)
            self.team_record.append(aircraft)
            self._log_event(
                f"备用机 {aircraft.sn} 替换成员 {old_member or '-'}",
                event_type='backup_aircraft_assigned',
                aircraft_sn=aircraft.sn,
                replaced_member=old_member,
                replacement_member=self._aircraft_member_no(aircraft),
            )
        if selected_aircrafts and any(a.state == "stay" for a in selected_aircrafts):
            self.make_service_request(selected_aircrafts)

    def make_service_request(self, aircrafts):
        """
        将指定飞机的保障计划推送到全局资源管理器
        """
        # 筛选出需要准备的飞机（状态为stay的飞机）
        aircrafts_to_prepare = [a for a in aircrafts if a.state == "stay"]
        
        if not aircrafts_to_prepare:
            return

        # 推送保障请求到全局资源管理器，让其统一调度
        self.model.global_resource_manager.queue_service_requests(aircrafts_to_prepare, task=self)

    def demand_hrs(self):
        return self.last_stage_start() - self.in_task_stage_start()

    def in_task_stage_start(self):
        return self.start_hour + self.stages[0]['stage_length']
    
    def last_stage_start(self):
        return self.start_hour + self.hrs - self.stages[-1]['stage_length']
    
    def completed(self):
        return self.model.ticks >= (self.start_hour + self.hrs) * 60

    def step(self):
        ticks = self.model.ticks

        # 统计再次出动准备时间
        if self.preparation_start_time is not None and self.preparation_end_time is None:
            # 检查是否所有飞机都已准备就绪（状态为ready或in_task）
            if self.team and all(a.state in ["ready", "in_task"] for a in self.team):
                self.preparation_end_time = ticks
                self.turnaround_time = self.preparation_end_time - self.preparation_start_time
                self._set_status('ready', reason=f"保障准备完成，用时 {self.turnaround_time} 分钟", turnaround_time=self.turnaround_time)

        # 任务准备阶段
        if ticks >= self.dispatch_hour * 60 and ticks <= self._request_window_end_ticks():
            missing_aircrafts = self._required_aircraft_count() - len(self.team)
            if missing_aircrafts > 0:
                self.find_aircrafts(missing_aircrafts)

        # 任务执行阶段
        if self.success == True and (ticks >= 60 * self.start_hour and ticks < 60 * (self.start_hour + self.hrs)):
            # 开始任务，将飞机状态改为 in_task
            task_started = False
            for a in self.team:
                # if the aircraft is in preparing state, we can start the task
                # 更新起降次数必须在这里完成
                if a.state == "ready":
                    a._set_state("in_task", reason=f"执行任务 {self.id}", task_id=self.id)
                    self.model.total_takeoffs += 1
                    a.takeoffs += 1
                    task_started = True
                    for pr in a.prev_repairs: 
                        pr.update_counters('takeoff')
                # check if the aircraft is still available
                # if a.is_available():

            if task_started and self.status != 'executing':
                self._set_status('executing', reason='任务开始执行')

            # state[1]: 任务执行过程中，未进入最后一个stage的时间段（返航时段）
            if ticks < 60 * self.last_stage_start():

                if ticks >= self.in_task_stage_start() * 60:
                    # 计算航线占有时间
                    # 只有当有飞机处于in_task状态时才累计
                    if any(a.state == "in_task" for a in self.team):
                        self.hrs_covered += 1 / 60
                
                # 任务执行过程中，未进入最后一个stage的时间段（返航时段）时，如果无足够可用飞机，则提前启动下一个task，并且全部后续tasks提前启动
                # check if any aircraft in team is in early_returning state
                # 修正：应该检查处于in_task状态的飞机数量，而不是team总数（因为stay状态的飞机也在team中）
                active_aircraft_count = sum(1 for a in self.team if a.state == "in_task")
                required_min = self._minimum_active_aircraft_count(stage_index=1)
                if required_min > 0 and active_aircraft_count < required_min:
                    self.find_replacement_aircrafts(required_min - active_aircraft_count)
                    active_aircraft_count = sum(1 for a in self.team if a.state == "in_task")
                if required_min > 0 and active_aircraft_count < required_min and ticks >= self._cancel_deadline_ticks():
                    self.failure_context = self._build_failure_context(
                        required_min=required_min,
                        active_aircraft_count=active_aircraft_count,
                    )
                    self.success = False
                    self._set_status('failed', reason='任务执行过程中可用飞机不足', failure_context=self.failure_context)
                    # 计算当前任务提前结束的时间ticks
                    early_ticks = (self.last_stage_start() - self.model.ticks) * 60

                    # 通知下一个task提前启动,增加任务时间 TODO

        # 任务结束阶段 - 只有当任务真正完成时才清空team
        elif ticks >= 60 * (self.start_hour + self.hrs):
            # Task has completed, we can reset the team
            completed_aircrafts = list(self.team)
            if self.status != 'completed':
                self._set_status('completed', reason=f"任务结束，参与飞机 {len(completed_aircrafts)} 架")
            for a in self.team:
                a.my_task = None
                # update aircrafts takeoff times in prev_repair
                # 返回基地后，更新起飞次数计数器
                for pr in a.prev_repairs: 
                    pr.update_counters('takeoff')

                # set aircraft state to checking
                a._set_state("checking", reason=f"任务 {self.id} 完成返场检查", task_id=self.id)
            if self.postflight_service_id and completed_aircrafts:
                self.model.global_resource_manager.queue_service_requests(
                    completed_aircrafts,
                    service_id=self.postflight_service_id,
                    service_mode='postflight'
                )
            self.team = []
