import random
import numpy as np
from .component import Part
from .maintenance import PrevRepair

class Aircraft:
    # possible states: stay, in_preparing, ready, in_task, checking, early_returning, in_repairing, in_maintenance
    def __init__(self, model, aid, sn=None, unit_id=None):
        self.model = model
        self.Id = aid
        self.sn = sn
        self.unit_id = unit_id
        
        self.my_task = None
        self.available_time = 0
        self.failures_count = 0
        self.critical_failure_count = 0
        
        # 优先读取实例级配置（s_units），无则回退到机型级配置（s_aircraft_models）
        self.aircraft_conf: dict = next((a for a in model.config.get('s_units', []) if a.get('Id') == self.Id), {})
        if not self.aircraft_conf:
            self.aircraft_conf = next((a for a in model.config.get('s_aircraft_models', []) if a.get('Id') == self.Id), {})

        self.aircraft_name = self.aircraft_conf.get('aircraft_name', 'aircraft')
        self.MTBF = self.aircraft_conf.get('MTBF', self.aircraft_conf.get('MFHBF', 100))
        self.MTTR = self.aircraft_conf.get('MTTR', self.aircraft_conf.get('MSRT', 2))
        self.TAT = self.aircraft_conf.get('TAT', 1)
        self.part_fulfill_rate = self.aircraft_conf.get('part_fulfill_rate', 1.0)
        self.spare_part_delay_time = self.aircraft_conf.get('spare_part_delay_time', 0)
        
        # Initialize parts
        self.parts = [] # Initialize empty list first for Part constructor
        model_ref = f"model_{self.aircraft_name}"
        self.part_conf = list(filter(
            lambda p: p.get('aircraft') in {self.Id, self.aircraft_name, model_ref},
            model.config['s_parts']
        ))
        self.setup_parts(self.part_conf)
        
        self.state = "stay"  # 默认进入stay状态

        # 初始化整机故障时间 - 指数分布
        self.ftime = random.expovariate(1 / self.MTBF) * 60  # 转换为分钟

        self.current_task_counter = 0
        self.task_hrs = 0
        self.task_hrs_sum = 0
        self.takeoffs = 0
        self.my_services = []
        
        # 添加保障工作相关属性
        self.service_plan = None  # 当前的保障计划
        self.service_mode = 'preflight'
        self.calculated_tat = self.TAT  # 计算得出的TAT时间（分钟）
        self.preparing_time_remaining = 0  # 剩余准备时间（分钟）
        
        # 初始化预防性维修配置
        self.prev_repairs = []
        self.setup_prev_repair(model)

    def _log_event(self, message, event_type='activity', **details):
        aircraft_id = self.sn or self.Id
        return self.model.log_event('aircraft', aircraft_id, message, event_type=event_type, state=self.state, **details)

    def _set_state(self, new_state, reason=None, **details):
        old_state = self.state
        self.state = new_state
        return self.model.log_state_change(
            'aircraft',
            self.sn or self.Id,
            old_state,
            new_state,
            reason=reason,
            aircraft_id=self.Id,
            **details,
        )

    def setup_prev_repair(self, model):
        pm_configs = model.config.get('prev_maintain', model.config.get('s_prev_maintain', []))
        
        # Fallback: use aircraft model properties if no specific PM config
        if not pm_configs or len(pm_configs) == 0:
            gap = self.aircraft_conf.get('avg_prev_repair_gap_hours')
            duration = self.aircraft_conf.get('avg_prev_repair_time')
            
            if gap and duration:
                # Create a dynamic time distribution for the duration
                dist_id = f"dynamic_pm_dist_{self.Id}"
                
                # Ensure model has time_dist dict
                if not hasattr(model, 'time_dist'):
                    model.time_dist = {}
                
                from .utils import TimeDistribution
                model.time_dist[dist_id] = TimeDistribution({
                    "mean": duration,
                    "dist_type": "fix"
                })
                
                pm_configs = [{
                    "Id": f"dynamic_pm_{self.Id}",
                    "service_name": "Default Preventive Maintenance",
                    "flyhour_interval": gap,
                    "flyhour_interval_margin": 0,
                    "service_duration": dist_id,
                    "day_interval": 0,
                    "takeoff_times": 0
                }]

        self.prev_repairs = []
        for pm_config in pm_configs:
            self.prev_repairs.append(PrevRepair(model, self, pm_config))

    def setup_parts(self, part_conf):
        self.parts = []
        
        for part_data in part_conf:
            # 没有mtbf和mtbcf的部件跳过
            if 'sys_MTBF' in part_data or 'sys_MTCBF' in part_data:
                c_ratio = part_data.get('critical_ratio', 0.1)
                if self.model.max_critical_ratio is not None and c_ratio > self.model.max_critical_ratio:
                    c_ratio = self.model.max_critical_ratio
                part = Part(
                            aircraft=self,
                            id = part_data['Id'], 
                            name=part_data.get('part_name', 'part'),
                            pid=part_data.get('parent_node', part_data.get('parent', None)),
                            mtbf=part_data.get('sys_MTBF', part_data.get('mtbf', 999999)), 
                            # if part_data has sys_MTBCF, use it, else use critical_ratio to generate mtbcf
                            mtbcf=part_data.get('sys_MTBCF', part_data.get('mtbcf', part_data.get('mtbf', 999999) / c_ratio if c_ratio > 0 else 999999)),
                            mttr=part_data.get('MTTR', part_data.get('mttr', 2)),
                            critical_ratio= c_ratio,
                            spare_part_delay_time=part_data.get('spare_part_delay_time', 0)
                        )
                        

                self.parts.append(part)

    def min_part_mtbf(self):
        if self.parts:
            return min([part.ftime for part in self.parts])
        else:
            return None

    def has_part_failure(self):
        for part in self.parts:
            if part.ftime <= 0:
                return True
        return False

    def is_available(self):
        # This method would check if the aircraft is available for tasks
        if self.state == "in_maintenance" or self.state == "in_repairing":
            return False
        
        # 如果在任务执行阶段，只有cf_time <=0 的部件才算故障
        elif self.parts is None or len(self.parts) == 0:
                return self.ftime > 0
        else:
            for part in self.parts:
                if part.ftime <= 0 and part.critical_failure == True:
                    return False
            return True
    
    def generate_service_plan_and_calculate_tat(self):
        """
        生成保障工作并计算TAT时间
        当飞机被任务选中后调用此方法
        """
        try:
            # 尝试使用高级保障计划生成器
            # Note: This import might need adjustment if service_plan_generator is not available or moved
            # For now, we'll assume it's not available or we use fallback
            # from .service_plan_generator import generate_advanced_service_plan
            # self.service_plan, self.calculated_tat = generate_advanced_service_plan(self, self.model)
            raise ImportError("service_plan_generator not implemented yet")
        except Exception as e:
            # 如果出现其他错误，使用默认TAT
            self.calculated_tat = int(self.TAT * 60)  # 转换为分钟
            self.service_plan = {
                'generation_method': 'error_fallback',
                'estimated_duration': self.calculated_tat,
                'error': str(e)
            }
            # self.model.logs.append(f"{self.model.ticks}: 飞机 {self.Id} 保障计划生成失败，使用默认TAT: {self.calculated_tat} 分钟. 错误: {str(e)}")
        
        # 设置准备时间
        self.preparing_time_remaining = self.calculated_tat

    def get_on_time_maintenance(self):
        """返回到期的预防性维修"""
        due_prev_repairs = []
        for pr in self.prev_repairs:
            # 任务时间
            if pr.flyhour_interval > 0 and pr.flyhour_counter >= pr.flyhour_interval:
                due_prev_repairs.append(pr)
            # takeoff_times
            elif pr.takeoff_interval > 0 and pr.takeoff_counter >= pr.takeoff_interval:
                due_prev_repairs.append(pr)
            # calendar_days
            elif pr.day_interval > 0 and pr.day_counter >= pr.day_interval:
                due_prev_repairs.append(pr)
        return due_prev_repairs


    def step(self):
        # update available time 
        if self.is_available():
            self.available_time += 1

        # update calendar days for prev repairs
        for pr in self.prev_repairs:
            pr.update_counters('calendar_days')

        # state machine logic
        if self.state == "checking":
            # 检查是否需要预防性维修（检查所有预防性维修配置）
            if any(self.get_on_time_maintenance()):
                self._set_state("in_maintenance", reason="进入预防性维修")
                # 根据预防性维修服务时间，产生维护时间
                for maintain in self.get_on_time_maintenance():
                    self.current_task_counter += maintain.service_duration.get_sample() * 60 
                    maintain.reset()

            # 如果 parts 为空，则表示没有飞机构型配置，直接根据整机故障时间产生维修时间 rtime
            elif (len(self.parts) == 0 and self.ftime <= 0):
                self._set_state("in_repairing", reason="整机故障进入维修")

                is_fulfilled = random.random() <= self.part_fulfill_rate
                self.model.global_resource_manager.record_part_request(is_fulfilled)
                if is_fulfilled:
                    self.rtime = self.MTTR * 60
                else:
                    self.rtime = self.MTTR * 60 + self.spare_part_delay_time

            # 有飞机构型，有故障件
            elif self.has_part_failure():
                self._set_state("in_repairing", reason="部件故障进入维修")

                for part in self.parts:
                    if part.ftime <= 0 or part.cftime <= 0:
                        # 查找global_resource_manager 是否有备件
                        is_fulfilled = False
                        
                        # 检查是否配置了备件
                        if part.id in self.model.global_resource_manager.spare_parts:
                            # 如果配置了备件，则不使用part_fulfill_rate，应该根据global_resource_manager实际数量判断
                            is_fulfilled = self.model.global_resource_manager.check_part_availability(part)
                        else:
                            # 未配置备件（兜底），使用概率判断
                            is_fulfilled = random.random() <= self.part_fulfill_rate
                        
                        self.model.global_resource_manager.record_part_request(is_fulfilled, part)

                        # 如果有备件，产生维修时间 rtime
                        if is_fulfilled:
                            part.rtime = part.mttr
                        else:
                            # 如果没有备件，看 self.model.global_resource_manager.transport_configs 中是否有运输配置
                            transport_configs = getattr(self.model.global_resource_manager, 'transport_configs', [])
                            transport_config = next((cfg for cfg in transport_configs if cfg.get('lru') == part.id), None)
                            
                            if transport_config:
                                # 如果有，则根据运输配置计算备件到达时间
                                cycle_days = transport_config.get('cycle_days', 1)
                                current_day = self.model.ticks // (24 * 60)
                                next_cycle_day = ((current_day // cycle_days) + 1) * cycle_days
                                arrival_tick = next_cycle_day * 24 * 60
                                wait_time = arrival_tick - self.model.ticks
                                part.rtime = part.mttr + wait_time
                            else:
                                # 如果没有运输配置，则直接根据 self.spare_part_delay_time 计算备件到达时间
                                part.rtime = part.mttr + self.spare_part_delay_time
 
            
            else:
                self._set_state("stay", reason="检查完成")
                self.current_task_counter = 1
        
        elif self.state == "in_preparing":
            # 处理准备状态，倒计时TAT时间
            if self.preparing_time_remaining > 0:
                self.preparing_time_remaining -= 1  # 每分钟减少1
                
            if self.preparing_time_remaining <= 0:
                if self.service_mode == 'postflight':
                    self._set_state("stay", reason="飞行后保障完成")
                    self.service_mode = 'preflight'
                else:
                    self._set_state("ready", reason="保障准备完成")

        elif self.state == "in_task":
            self.task_hrs += 1 / 60
            self.task_hrs_sum += 1 / 60
            for pr in self.prev_repairs: 
                pr.update_counters('task_hrs')
            
            for part in self.parts:
                # Simulate part failure and repair logic here
                part.decoy()
            # if this aircraft has no part, or all its parts don't have mtbf attribute, 
            # then try to decoy based on aircraft level MTBF
            if len(self.parts) == 0 or all(not hasattr(part, 'mtbf') for part in self.parts):
                # Decoy based on aircraft level MTBF
                self.ftime -= 1
                if self.ftime <= 0:
                    self.failures_count += 1
                    if random.random() < 0.1:  # assuming 10% critical failure rate at aircraft level
                        self.critical_failure_count += 1

            if not self.is_available():                    
                if self.my_task is not None and hasattr(self.my_task, 'stages') and len(self.my_task.stages) > 0:
                    self.current_task_counter = self.my_task.stages[-1]['stage_length'] * self.my_task.hrs * 60 # 计算返航时间
                else:
                    if self.my_task and self in self.my_task.team:
                        self.my_task.team.remove(self)
                    self.my_task = None
                
                self._set_state("early_returning", reason="任务中故障提前返航")


        elif self.state == "early_returning":
            self.task_hrs += 1 / 60
            self.task_hrs_sum += 1 / 60
            for pr in self.prev_repairs: 
                pr.update_counters('task_hrs')
            self.current_task_counter -= 1
            if self.current_task_counter <= 0:
                self._set_state("checking", reason="提前返航落地完成")

        elif self.state == "in_repairing":
            for part in self.parts:
                if part.ftime <= 0:
                    part.rtime -= 1
                    if part.rtime <= 0:
                        # Repair is done, reset the part
                        part.ftime = np.random.exponential(scale=part.mtbf) * 60  # 转换为分钟
                        part.critical_failure = False
                        part.rtime = part.mttr

            # Handle aircraft level repair
            if len(self.parts) == 0:
                self.rtime -= 1
                if self.rtime <= 0:
                    self.ftime = random.expovariate(1 / self.MTBF) * 60
                    self._set_state("stay", reason="整机维修完成")
                    self.model.total_repairs += 1
                    self.current_task_counter = 1
                    return

            # 检查是否所有故障部件都已修复完成
            all_repaired = all(part.ftime > 0 for part in self.parts)
            if all_repaired and len(self.parts) > 0:
                self._set_state("stay", reason="故障件维修完成")
                self.model.total_repairs += 1
                self.current_task_counter = 1

        elif self.state == "in_maintenance":
            self.current_task_counter -= 1
            if self.current_task_counter <= 0:
                self._set_state("checking", reason="预防性维修完成")
