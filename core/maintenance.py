from .utils import TimeDistribution

class PrevRepair:
    """Preventive maintenance schedule tied to an aircraft."""

    def __init__(self, model, aircraft, prev_maintain_config: dict):
        self.model = model
        self.aircraft = aircraft
        self.num_maintenances = 0
        
        # 从传入的配置中读取参数
        self.id = prev_maintain_config.get("Id")
        self.service_name = prev_maintain_config.get("service_name", "预防性维修")
        self.flyhour_interval = 60 * prev_maintain_config.get("flyhour_interval", 100)
        self.flyhour_interval_margin = 60 * prev_maintain_config.get("flyhour_interval_margin", 10)
        self.flyhour_counter = 0
        self.day_interval = prev_maintain_config.get("day_interval", 30)
        self.day_margin = prev_maintain_config.get("day_margin", 3)
        self.day_counter = 0
        self.takeoff_interval = prev_maintain_config.get("takeoff_times", 100)
        self.takeoff_interval_margin = prev_maintain_config.get("takeoff_times_margin", 10)
        self.takeoff_counter = 0
        
        # 维修时长配置
        self.service_duration = None
        service_duration_id = prev_maintain_config.get("service_duration")
        if hasattr(self.model, 'time_dist') and service_duration_id and service_duration_id in self.model.time_dist:
            self.service_duration = self.model.time_dist[service_duration_id]
        else:
            self.service_duration = TimeDistribution({"mean": 2, "dist_type": "fix"})
        # 初始化计数器
        self.reset()
        self.num_maintenances = 0


    def update_counters(self, counter) -> None:
        if counter == 'task_hrs':
            self.flyhour_counter += 1
        elif counter in {'takeoff', 'takeoffs'}:
            self.takeoff_counter += 1
        elif counter == 'calendar_days':
            # 每1440个ticks（1天）增加1
            if self.model.ticks % 1440 == 0:
                self.day_counter += 1


    def reset(self) -> None:
        self.flyhour_counter = 0
        self.takeoff_counter = 0
        self.day_counter = 0
        self.num_maintenances += 1
