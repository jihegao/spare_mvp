import numpy as np
import random

class Part:
    def __init__(self, aircraft, id, name, pid, mtbf=500, mtbcf=2000,mttr=2, critical_ratio = 0.1, spare_part_delay_time=0):
        self.id = id
        self.aircraft = aircraft
        self.name = name
        self.critical_ratio = critical_ratio
        self.critical_failure = False
        # find parent part in aircraft.parts by pid
        self.parent = None
        # Note: This requires aircraft to be fully initialized or we handle parent linking later.
        # In the original code, it iterates over aircraft.parts which might not be fully populated if we are in the middle of creating them.
        # But usually parts are created in order or we can link them later.
        # For now, we'll keep the logic but be aware of potential issues if parent is not yet in list.
        if hasattr(aircraft, 'parts'):
            for part in aircraft.parts:
                if part.id == pid:
                    self.parent = part
                    self.aircraft = aircraft
                    break
        
        # mtbf follows an exponential distribution
        self.mtbf = mtbf
        self.mtbcf = mtbcf
        self.ftime = 60 * np.random.exponential(scale=mtbf) # failure time counter
        self.cftime = 60 * np.random.exponential(scale=mtbcf) # critical failure time counter
        self.mttr = mttr * 60 # convert mttr to minutes
        self.rtime = mttr * 60 # recovery time counter (in minutes)
        self.spare_part_delay_time = spare_part_delay_time * 60  # 延迟时间同样按分钟计

    def decoy(self):
        if self.ftime > 0:
            self.ftime -= 1
        
            if self.ftime <= 0:
                self.aircraft.failures_count += 1

        if self.cftime > 0:
            self.cftime -= 1
            if self.cftime <= 0:
                self.critical_failure = True
                self.aircraft.critical_failure_count += 1