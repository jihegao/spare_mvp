import random

class TimeDistribution:
    def __init__(self, dist):
        self.mean = dist.get('mean', 1)
        self.dist_type = dist.get('dist_type', 'constant')
        self.time_unit = dist.get('time_unit', 'hour')
        self.model_name = dist.get('model_name', 'default_model')
        self.sd = dist.get('standard_deviation', 0)
        self.lower = dist.get('lower', 0)
        self.upper = dist.get('upper', 0)
        self.mode = dist.get('mode', self.mean)

    def get_sample(self):
        if self.dist_type == 'constant' or self.dist_type == 'fix':
            return self.mean
        elif self.dist_type == 'exponential':
            return random.expovariate(1 / self.mean)
        elif self.dist_type == 'normal':
            return random.gauss(self.mean, self.sd)
        elif self.dist_type == 'random':
            return random.uniform(self.lower, self.upper)
        elif self.dist_type == 'triangular':
            return random.triangular(self.lower, self.upper, self.mode)
        else:
            # Fallback or raise error
            return self.mean
