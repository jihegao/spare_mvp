export const MODULES = {
  sparePlanning: "备件规划",
  missionReliability: "任务可靠度"
};

export const defaultScenario = {
  scenarioId: "landbase-turnaround-demo",
  activeModule: "sparePlanning",
  airports: [
    {
      id: "main-airbase",
      name: "主基地机场",
      location: "陆基主保障机场",
      runwayType: "常规跑道",
      distanceToMissionKm: 320,
      supportNodeId: "main-airbase"
    },
    {
      id: "forward-airport",
      name: "前进保障机场",
      location: "近岸前进保障点",
      runwayType: "短距起降跑道",
      distanceToMissionKm: 180,
      supportNodeId: "rear-stock"
    }
  ],
  missionAreas: [
    {
      id: "near-sea-patrol",
      name: "近海巡逻区",
      areaType: "巡逻",
      distanceFromDepartureKm: 320,
      patrolRadiusKm: 120,
      threatLevel: "中"
    },
    {
      id: "far-sea-alert",
      name: "远海警戒区",
      areaType: "警戒",
      distanceFromDepartureKm: 540,
      patrolRadiusKm: 180,
      threatLevel: "高"
    }
  ],
  experiment: {
    name: "陆基飞机保障原型实验",
    steps: 48,
    samples: 24,
    seed: 20260617,
    parallelCores: 4,
    stopCondition: "达到样本数或备件满足率稳定"
  },
  missionProfile: {
    profileId: "MP-01",
    profileType: "多机集群任务",
    repeatCycleHours: 6,
    endCondition: "完成 8 个任务波次",
    compositeTasks: [
      {
        id: "composite-day-patrol",
        name: "昼间巡逻复合任务",
        taskItems: [
          {
            id: "day-patrol-main",
            basicTaskName: "近海巡逻任务",
            equipmentType: "F35",
            equipmentQuantity: 5,
            groupName: "第一出动编队",
            taskDispatchTime: "07:15",
            firstWaveTime: "08:00",
            recoveryTime: "11:00",
            priority: 1,
            minRequiredSystems: 5,
            dailyRepeatCount: 2,
            intervalHours: 6,
            preparationMinutes: 45
          }
        ]
      },
      {
        id: "composite-night-alert",
        name: "夜间警戒复合任务",
        taskItems: [
          {
            id: "night-alert-main",
            basicTaskName: "远海警戒任务",
            equipmentType: "F15",
            equipmentQuantity: 4,
            groupName: "夜间警戒编队",
            taskDispatchTime: "19:30",
            firstWaveTime: "20:15",
            recoveryTime: "23:30",
            priority: 2,
            minRequiredSystems: 4,
            dailyRepeatCount: 1,
            intervalHours: 8,
            preparationMinutes: 45
          }
        ]
      }
    ],
    periodicTasks: [
      {
        id: "periodic-day-night",
        name: "昼夜保障周期任务",
        taskName: "昼夜保障周期任务",
        cycleDays: 7,
        taskPeriodDays: 7,
        periodDays: 7,
        repeatCycleDays: 7,
        repeatCycleValue: 7,
        repeatCycleUnit: "day",
        repeatRounds: 2,
        repeatCount: 2,
        dailyRepeatCount: 2,
        repeatWeeks: 2,
        compositeTasks: [
          { week: "1", compositeTaskId: "composite-day-patrol" },
          { week: "2", compositeTaskId: "composite-day-patrol" },
          { week: "3", compositeTaskId: "composite-night-alert" },
          { week: "4", compositeTaskId: "composite-day-patrol" },
          { week: "5", compositeTaskId: "composite-day-patrol" },
          { week: "6", compositeTaskId: "composite-night-alert" },
          { week: "7", compositeTaskId: "composite-day-patrol" }
        ],
        compositeTaskIds: ["composite-day-patrol", "composite-night-alert"],
        weekdayAssignments: {
          monday: "composite-day-patrol",
          tuesday: "composite-day-patrol",
          wednesday: "composite-night-alert",
          thursday: "composite-day-patrol",
          friday: "composite-day-patrol",
          saturday: "composite-night-alert",
          sunday: "composite-day-patrol"
        }
      }
    ]
  },
  basicMission: {
    missionId: "BM-01",
    name: "近海巡逻任务",
    taskNo: "BM-01",
    taskArea: "近海巡逻区",
    equipmentType: "F35",
    equipmentQuantity: 5,
    taskDurationMinutes: 180,
    preparationMinutes: 45,
    cancelMinutes: 20,
    supportActivityName: "飞行前保障",
    updatedAt: "2026-06-18 09:00",
    successPoint: 0.95,
    startHour: 1,
    returnRatio: 0.35,
    priority: 1,
    minRequiredSorties: 5
  },
  missionPhases: [
    { id: "phase-standby", name: "待命", state: "idle", transitionCondition: "任务波次触发", limitHours: 1 },
    { id: "phase-prep", name: "飞行前准备", state: "preparing", transitionCondition: "保障完成", limitHours: 2 },
    { id: "phase-sortie", name: "出动执行", state: "sortie", transitionCondition: "任务完成或故障", limitHours: 4 },
    { id: "phase-recovery", name: "回收检查", state: "ready", transitionCondition: "检查完成", limitHours: 1 }
  ],
  combatUnit: {
    unitId: "CU-01",
    groupName: "第一出动编队",
    basicTaskName: "近海巡逻任务",
    equipmentType: "F35 / F15",
    quantity: 6,
    requiredCount: 5,
    deploymentLocation: "主基地机场",
    standbyCount: 1,
    members: [
      { aircraftNo: "F35-01", model: "F35", role: "长机", status: "执行", remainingLifeHours: 180, preLifeRequirementHours: 120, takeoffLandingCount: 36, deploymentLocation: "主基地机场" },
      { aircraftNo: "F35-02", model: "F35", role: "僚机", status: "执行", remainingLifeHours: 176, preLifeRequirementHours: 120, takeoffLandingCount: 34, deploymentLocation: "主基地机场" },
      { aircraftNo: "F35-03", model: "F35", role: "僚机", status: "执行", remainingLifeHours: 169, preLifeRequirementHours: 120, takeoffLandingCount: 32, deploymentLocation: "主基地机场" },
      { aircraftNo: "F15-01", model: "F15", role: "僚机", status: "执行", remainingLifeHours: 164, preLifeRequirementHours: 120, takeoffLandingCount: 42, deploymentLocation: "主基地机场" },
      { aircraftNo: "F15-02", model: "F15", role: "备份", status: "备用", remainingLifeHours: 171, preLifeRequirementHours: 120, takeoffLandingCount: 39, deploymentLocation: "主基地机场" },
      { aircraftNo: "F35-04", model: "F35", role: "备份", status: "备用", remainingLifeHours: 152, preLifeRequirementHours: 120, takeoffLandingCount: 31, deploymentLocation: "主基地机场" }
    ]
  },
  equipment: {
    model: "F35",
    wholeMachineModels: ["F35", "F15"],
    quantity: 6,
    deploymentLocation: "主基地机场",
    initialReady: 6,
    minRequiredSorties: 5,
    preLifeRequirementHours: 120
  },
  components: [
    { id: "f35-engine", aircraftModel: "F35", name: "发动机", parentId: "aircraft-root", productType: "SRU", spareType: "发动机备件", failureModel: "随机", failureDistribution: { distributionType: "指数分布", parameters: "lambda=0.07" }, failureRate: 0.07, mtbfHours: 80, lifeLimitHours: 220, connectionType: "串联", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 }, specialRepairProfile: { repairTimeMinutes: 220, repairRatio: 0.35, replacementRatio: 0.65 }, rms: { reliability: 0.93, maintainability: 0.88, supportability: 0.9, mttrHours: 3.5, mldtHours: 1.2, availability: 0.96 } },
    { id: "f35-engine-control", aircraftModel: "F35", name: "发动机控制模块", parentId: "f35-engine", productType: "LRU", spareType: "发动机备件", failureModel: "随机", failureDistribution: { distributionType: "指数分布", parameters: "lambda=0.05" }, failureRate: 0.05, mtbfHours: 96, lifeLimitHours: 240, connectionType: "串联", quantity: 1, kOutOfN: { enabled: false, n: 1, k: 1 }, specialRepairProfile: { repairTimeMinutes: 180, repairRatio: 0.45, replacementRatio: 0.55 }, rms: { reliability: 0.94, maintainability: 0.9, supportability: 0.9, mttrHours: 3.0, mldtHours: 1.2, availability: 0.96 } },
    { id: "f35-avionics", aircraftModel: "F35", name: "航电系统", parentId: "aircraft-root", productType: "SRU", spareType: "航电模块", failureModel: "退化", failureDistribution: { distributionType: "威布尔分布", parameters: "beta=1.8, eta=120" }, failureRate: 0.04, mtbfHours: 110, lifeLimitHours: 260, connectionType: "并联", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 }, specialRepairProfile: { repairTimeMinutes: 160, repairRatio: 0.55, replacementRatio: 0.45 }, rms: { reliability: 0.95, maintainability: 0.91, supportability: 0.89, mttrHours: 2.8, mldtHours: 1.4, availability: 0.97 } },
    { id: "f35-mission-computer", aircraftModel: "F35", name: "任务计算机模块", parentId: "f35-avionics", productType: "LRU", spareType: "航电模块", failureModel: "退化", failureDistribution: { distributionType: "威布尔分布", parameters: "beta=1.6, eta=140" }, failureRate: 0.03, mtbfHours: 130, lifeLimitHours: 280, connectionType: "并联", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 }, specialRepairProfile: { repairTimeMinutes: 130, repairRatio: 0.6, replacementRatio: 0.4 }, rms: { reliability: 0.96, maintainability: 0.92, supportability: 0.9, mttrHours: 2.4, mldtHours: 1.1, availability: 0.98 } },
    { id: "f35-hydraulic", aircraftModel: "F35", name: "液压组件", parentId: "aircraft-root", productType: "SRU", spareType: "液压备件", failureModel: "寿命", failureDistribution: { distributionType: "正态分布", parameters: "mean=95, sigma=12" }, failureRate: 0.06, mtbfHours: 95, lifeLimitHours: 200, connectionType: "备用", quantity: 1, kOutOfN: { enabled: false, n: 1, k: 1 }, specialRepairProfile: { repairTimeMinutes: 140, repairRatio: 0.7, replacementRatio: 0.3 }, rms: { reliability: 0.92, maintainability: 0.86, supportability: 0.88, mttrHours: 3.2, mldtHours: 1.6, availability: 0.95 } },
    { id: "f15-engine", aircraftModel: "F15", name: "发动机", parentId: "aircraft-root", productType: "SRU", spareType: "发动机备件", failureModel: "随机", failureDistribution: { distributionType: "指数分布", parameters: "lambda=0.06" }, failureRate: 0.06, mtbfHours: 90, lifeLimitHours: 230, connectionType: "串联", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 }, specialRepairProfile: { repairTimeMinutes: 210, repairRatio: 0.4, replacementRatio: 0.6 }, rms: { reliability: 0.94, maintainability: 0.89, supportability: 0.9, mttrHours: 3.4, mldtHours: 1.2, availability: 0.96 } },
    { id: "f15-avionics", aircraftModel: "F15", name: "航电系统", parentId: "aircraft-root", productType: "SRU", spareType: "航电模块", failureModel: "退化", failureDistribution: { distributionType: "威布尔分布", parameters: "beta=1.7, eta=125" }, failureRate: 0.04, mtbfHours: 115, lifeLimitHours: 250, connectionType: "并联", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 }, specialRepairProfile: { repairTimeMinutes: 155, repairRatio: 0.56, replacementRatio: 0.44 }, rms: { reliability: 0.95, maintainability: 0.91, supportability: 0.89, mttrHours: 2.7, mldtHours: 1.4, availability: 0.97 } },
    { id: "f15-radar-receiver", aircraftModel: "F15", name: "雷达接收机模块", parentId: "f15-avionics", productType: "LRU", spareType: "航电模块", failureModel: "退化", failureDistribution: { distributionType: "威布尔分布", parameters: "beta=1.5, eta=135" }, failureRate: 0.035, mtbfHours: 125, lifeLimitHours: 260, connectionType: "并联", quantity: 1, kOutOfN: { enabled: false, n: 1, k: 1 }, specialRepairProfile: { repairTimeMinutes: 145, repairRatio: 0.58, replacementRatio: 0.42 }, rms: { reliability: 0.95, maintainability: 0.91, supportability: 0.9, mttrHours: 2.5, mldtHours: 1.3, availability: 0.97 } },
    { id: "f15-hydraulic", aircraftModel: "F15", name: "液压组件", parentId: "aircraft-root", productType: "SRU", spareType: "液压备件", failureModel: "寿命", failureDistribution: { distributionType: "正态分布", parameters: "mean=98, sigma=13" }, failureRate: 0.055, mtbfHours: 100, lifeLimitHours: 205, connectionType: "备用", quantity: 1, kOutOfN: { enabled: false, n: 1, k: 1 }, specialRepairProfile: { repairTimeMinutes: 135, repairRatio: 0.72, replacementRatio: 0.28 }, rms: { reliability: 0.93, maintainability: 0.87, supportability: 0.88, mttrHours: 3.1, mldtHours: 1.5, availability: 0.95 } }
  ],
  supportNodes: [
    {
      id: "main-airbase",
      name: "主基地机场",
      nodeType: "机场",
      supportLevel: "一线保障",
      personnelCapacity: 5,
      equipmentCapacity: 3,
      policy: "优先保障高优先级任务",
      organizationStrategy: "任务优先 + 备件安全库存",
      lateralSupportNodes: ["forward-airport"],
      transportPolicies: [
        { from: "rear-stock", to: "main-airbase", transportMode: "地面运输", transportTimeHours: 2, priority: 1, capacity: 4 }
      ],
      inventory: { "发动机备件": 4, "航电模块": 6, "液压备件": 5 }
    },
    {
      id: "forward-airport",
      name: "前进保障机场",
      nodeType: "机场",
      supportLevel: "前进保障",
      personnelCapacity: 4,
      equipmentCapacity: 2,
      policy: "承接主基地横向调拨",
      organizationStrategy: "前置库存 + 横向支援",
      lateralSupportNodes: ["main-airbase"],
      transportPolicies: [
        { from: "main-airbase", to: "forward-airport", transportMode: "场站转运", transportTimeHours: 1, priority: 1, capacity: 2 }
      ],
      inventory: { "发动机备件": 2, "航电模块": 3, "液压备件": 2 }
    },
    {
      id: "rear-stock",
      name: "后方保障点",
      nodeType: "保障点",
      supportLevel: "后方保障",
      personnelCapacity: 3,
      equipmentCapacity: 2,
      policy: "短缺时 2 tick 后调运",
      organizationStrategy: "集中库存 + 横向调拨",
      lateralSupportNodes: ["main-airbase"],
      transportPolicies: [
        { from: "main-airbase", to: "rear-stock", transportMode: "返修转运", transportTimeHours: 3, priority: 2, capacity: 3 }
      ],
      inventory: { "发动机备件": 6, "航电模块": 6, "液压备件": 6 }
    }
  ],
  supportActivities: [
    {
      id: "preflight",
      activityType: "飞行前保障",
      activityName: "F35直接准备方案",
      planType: "直接准备方案",
      durationHours: 1,
      requiredPersonnel: 2,
      requiredDevices: 1,
      spareType: null,
      spareQuantity: 0,
      priority: 1,
      maxWorkTimeRefMinutes: 90,
      jobs: [
        {
          activityCode: "OPS-001",
          workName: "机务检查",
          predecessors: [],
          durationMinutes: 45,
          durationProfile: { distributionType: "三角分布", min: 35, mode: 45, max: 60 },
          personnel: "机务/航电,2",
          servicePersonnel: "勤务一组,1",
          facility: "保障站位-检查",
          equipment: "检测仪,DT-01,1",
          ammunition: "无",
          spare: "无"
        },
        {
          activityCode: "OPS-002",
          workName: "燃油加注",
          predecessors: ["OPS-001"],
          durationMinutes: 60,
          durationProfile: { distributionType: "均匀分布", min: 50, max: 70 },
          personnel: "机务/油料,1",
          servicePersonnel: "油料组,2",
          facility: "保障站位-加油",
          equipment: "加油车,F-01,1",
          ammunition: "无",
          spare: "无"
        },
        {
          activityCode: "OPS-003",
          workName: "挂弹作业",
          predecessors: ["OPS-002"],
          durationMinutes: 90,
          durationProfile: { distributionType: "正态分布", mean: 90, stdDev: 12 },
          personnel: "机务/军械,2",
          servicePersonnel: "军械组,2",
          facility: "保障站位-挂载",
          equipment: "挂弹车,LD-02,1",
          ammunition: "训练弹,AAM-1,2",
          spare: "挂架保险销,STD,2"
        }
      ]
    },
    {
      id: "corrective",
      activityType: "修复性维修",
      activityName: "航电模块故障修复方案",
      planType: "修复性维修方案",
      durationHours: 3,
      requiredPersonnel: 3,
      requiredDevices: 1,
      spareType: "发动机备件",
      spareQuantity: 1,
      priority: 1,
      meanRepairTimeMinutes: 180,
      repairDistribution: { distributionType: "对数正态分布", params: "mu=5.1, sigma=0.35" },
      repairTypes: ["换件修复", "功能复测"],
      jobs: [
        {
          activityCode: "REP-001",
          workName: "故障定位",
          predecessors: [],
          durationMinutes: 40,
          durationProfile: { distributionType: "三角分布", min: 30, mode: 40, max: 55 },
          personnel: "维修/航电,2",
          servicePersonnel: "勤务二组,1",
          facility: "维修工位",
          equipment: "检测仪,DT-01,1",
          ammunition: "无",
          spare: "无"
        },
        {
          activityCode: "REP-002",
          workName: "备件领用",
          predecessors: ["REP-001"],
          durationMinutes: 30,
          durationProfile: { distributionType: "固定值", value: 30 },
          personnel: "维修/航电,1",
          servicePersonnel: "备件保障组,1",
          facility: "备件库",
          equipment: "转运车,TR-01,1",
          ammunition: "无",
          spare: "航电模块,LRU,1"
        },
        {
          activityCode: "REP-003",
          workName: "换件维修",
          predecessors: ["REP-002"],
          durationMinutes: 90,
          durationProfile: { distributionType: "正态分布", mean: 90, stdDev: 15 },
          personnel: "维修/航电,2",
          servicePersonnel: "勤务二组,1",
          facility: "维修工位",
          equipment: "通用工具箱,TK-01,1",
          ammunition: "无",
          spare: "航电模块,LRU,1"
        }
      ]
    },
    {
      id: "preventive",
      activityType: "预防性维修",
      activityName: "8小时定检",
      planType: "预防性维修方案",
      durationHours: 2,
      requiredPersonnel: 1,
      requiredDevices: 1,
      spareType: "液压备件",
      spareQuantity: 1,
      priority: 2,
      plannedDowntimeHours: 2,
      triggerModes: ["日历时间", "飞行小时", "起落次数"],
      calendarDayInterval: 1,
      calendarDayFloatRatio: 10,
      runHourInterval: 8,
      runHourFloatRatio: 15,
      takeoffLandingInterval: 6,
      takeoffLandingFloatRatio: 10,
      jobs: [
        {
          activityCode: "PM-001",
          workName: "定检准备",
          predecessors: [],
          durationMinutes: 30,
          durationProfile: { distributionType: "固定值", value: 30 },
          personnel: "维修/机体,1",
          servicePersonnel: "勤务一组,1",
          facility: "定检工位",
          equipment: "检查灯,LT-01,1",
          ammunition: "无",
          spare: "无"
        },
        {
          activityCode: "PM-002",
          workName: "液压系统检查",
          predecessors: ["PM-001"],
          durationMinutes: 70,
          durationProfile: { distributionType: "三角分布", min: 55, mode: 70, max: 90 },
          personnel: "维修/液压,2",
          servicePersonnel: "勤务一组,1",
          facility: "定检工位",
          equipment: "液压测试台,HY-01,1",
          ammunition: "无",
          spare: "液压密封件,SRU,1"
        }
      ]
    },
    {
      id: "turnaround",
      activityType: "再次出动准备",
      activityName: "F35再次出动准备方案",
      planType: "再次出动准备方案",
      durationHours: 2,
      requiredPersonnel: 2,
      requiredDevices: 1,
      spareType: null,
      spareQuantity: 0,
      priority: 1,
      maxWorkTimeRefMinutes: 75,
      jobs: [
        {
          activityCode: "OPS-101",
          workName: "回收检查",
          predecessors: [],
          durationMinutes: 35,
          durationProfile: { distributionType: "固定值", value: 35 },
          personnel: "机务/外场,2",
          servicePersonnel: "勤务一组,1",
          facility: "回收站位",
          equipment: "检测仪,DT-01,1",
          ammunition: "无",
          spare: "无"
        },
        {
          activityCode: "OPS-102",
          workName: "再次通电检查",
          predecessors: ["OPS-101"],
          durationMinutes: 40,
          durationProfile: { distributionType: "均匀分布", min: 35, max: 50 },
          personnel: "机务/航电,1",
          servicePersonnel: "勤务一组,1",
          facility: "保障站位-检查",
          equipment: "电源车,PW-01,1",
          ammunition: "无",
          spare: "无"
        }
      ]
    },
    {
      id: "logistics-support",
      activityType: "后勤保障",
      activityName: "多级保障组织后勤保障方案",
      planType: "后勤保障活动方案",
      durationHours: 2,
      requiredPersonnel: 2,
      requiredDevices: 2,
      spareType: "发动机备件",
      spareQuantity: 1,
      priority: 1,
      organizationStrategies: [
        { supportNodeId: "main-airbase", supportLevel: "一线保障", organizationStrategy: "任务优先 + 备件安全库存", lateralSupportNodes: ["forward-airport"] },
        { supportNodeId: "rear-stock", supportLevel: "后方保障", organizationStrategy: "集中库存 + 纵向补给", lateralSupportNodes: ["main-airbase"] }
      ],
      transportStrategies: [
        { direction: "\u7eb5\u5411\u8fd0\u8f93", spareType: "\u53d1\u52a8\u673a\u5907\u4ef6", triggerMode: "\u4e34\u754c\u5e93\u5b58", criticalInventory: 2, from: "rear-stock", to: "main-airbase", transportTimeHours: 2 },
        { direction: "\u6a2a\u5411\u8fd0\u8f93", spareType: "\u822a\u7535\u6a21\u5757", triggerMode: "\u5468\u671f\u6027\u8c03\u8fd0", transferCycleHours: 24, from: "main-airbase", to: "forward-airport", transportTimeHours: 1 }
      ]
    }
  ],
  reliabilityBlockDiagram: {
    nodes: [
      { id: "aircraft", name: "整机", type: "system", connectionType: "串联", failureRate: 0.01, mtbfHours: 300, parentId: null },
      { id: "engine", name: "发动机", type: "component", connectionType: "串联", failureRate: 0.07, mtbfHours: 80, parentId: "aircraft" },
      { id: "avionics", name: "航电系统", type: "component", connectionType: "并联", failureRate: 0.04, mtbfHours: 110, parentId: "aircraft" },
      { id: "hydraulic", name: "液压组件", type: "component", connectionType: "备用", failureRate: 0.06, mtbfHours: 95, parentId: "aircraft" }
    ],
    edges: [
      { from: "aircraft", to: "engine", type: "串联", weight: 1 },
      { from: "aircraft", to: "avionics", type: "并联", weight: 0.6 },
      { from: "aircraft", to: "hydraulic", type: "备用", weight: 0.8 }
    ]
  },
  monteCarlo: {
    failureRates: [0.04, 0.08, 0.12],
    spareMultipliers: [0.75, 1, 1.25],
    supportCapacities: [2, 3],
    minRequiredSorties: [4, 5, 6]
  }
};

export function cloneScenario(scenario = defaultScenario) {
  return JSON.parse(JSON.stringify(scenario));
}

export function createRng(seed = 1) {
  let state = Number(seed) % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export function validateScenario(scenario) {
  const issues = [];
  const requiredPaths = [
    ["scenarioId", scenario.scenarioId],
    ["experiment.steps", scenario.experiment?.steps],
    ["experiment.samples", scenario.experiment?.samples],
    ["basicMission.minRequiredSorties", scenario.basicMission?.minRequiredSorties],
    ["equipment.quantity", scenario.equipment?.quantity],
    ["supportNodes[0].inventory", scenario.supportNodes?.[0]?.inventory],
    ["components", scenario.components?.length],
    ["supportActivities", scenario.supportActivities?.length],
    ["reliabilityBlockDiagram.nodes", scenario.reliabilityBlockDiagram?.nodes?.length]
  ];
  for (const [path, value] of requiredPaths) {
    if (value === undefined || value === null || value === "" || value === 0) {
      issues.push(`${path} 未配置`);
    }
  }
  const nodeIds = new Set((scenario.reliabilityBlockDiagram?.nodes || []).map((node) => node.id));
  for (const edge of scenario.reliabilityBlockDiagram?.edges || []) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      issues.push(`可靠性框图边 ${edge.from}->${edge.to} 缺少端点`);
    }
  }
  return issues;
}

export function runSimulation(inputScenario = defaultScenario, overrides = {}) {
  const scenario = mergeScenario(inputScenario, overrides);
  const rng = createRng(overrides.seed ?? scenario.experiment.seed);
  const steps = Number(overrides.steps ?? scenario.experiment.steps);
  const quantity = Number(scenario.equipment.quantity);
  const minRequired = Number(overrides.minRequiredSorties ?? scenario.basicMission.minRequiredSorties);
  const supportCapacity = Number(overrides.supportCapacity ?? scenario.supportNodes[0].equipmentCapacity);
  const baseFailureRate = Number(overrides.failureRate ?? average(scenario.components.map((item) => item.failureRate)));
  const spareMultiplier = Number(overrides.spareMultiplier ?? 1);
  const inventory = scaleInventory(scenario.supportNodes[0].inventory, spareMultiplier);
  const equipment = Array.from({ length: quantity }, (_, index) => ({
    id: `EQ-${String(index + 1).padStart(2, "0")}`,
    status: index < scenario.equipment.initialReady ? "ready" : "idle",
    component: weightedComponent(scenario.components, rng()),
    remaining: 0,
    sorties: 0,
    failures: 0,
    blockedReason: ""
  }));

  const timeline = [];
  const events = [];
  const repairQueue = [];
  const spareDemand = {};
  const spareFilled = {};
  const spareShortage = {};
  const downtime = { failure: 0, spare_shortage: 0, resource_delay: 0, schedule_delay: 0 };
  const launchTimes = [];
  const recoveryTimes = [];
  const turnaroundTimes = [];
  let sortieAttempts = 0;
  let successfulSorties = 0;
  let missionChecks = 0;
  let missionSuccesses = 0;
  let currentWave = 0;

  const addEvent = (step, type, message, severity = "info") => {
    events.push({ step, type, message, severity });
  };

  for (let step = 1; step <= steps; step += 1) {
    if ((step - 1) % scenario.missionProfile.repeatCycleHours === 0) {
      currentWave += 1;
      const ready = equipment.filter((item) => item.status === "ready");
      const demand = Math.min(ready.length, minRequired);
      sortieAttempts += minRequired;
      launchTimes.push(1 + Math.max(0, minRequired - demand));
      for (const item of ready.slice(0, demand)) {
        item.status = "preparing";
        item.remaining = 1;
        addEvent(step, "wave", `${item.id} 进入飞行前准备`, "info");
      }
      if (demand < minRequired) {
        downtime.schedule_delay += minRequired - demand;
        addEvent(step, "mission-risk", `第 ${currentWave} 波次可用装备不足，需求 ${minRequired}，可用 ${demand}`, "warning");
      }
    }

    for (const item of equipment) {
      if (item.status === "preparing") {
        item.remaining -= 1;
        if (item.remaining <= 0) {
          item.status = "sortie";
          item.remaining = 3;
          item.sorties += 1;
          successfulSorties += 1;
          addEvent(step, "sortie", `${item.id} 完成准备并出动`, "success");
        }
      } else if (item.status === "sortie") {
        const componentRisk = item.component.failureRate || baseFailureRate;
        if (rng() < componentRisk) {
          item.status = "failed";
          item.failures += 1;
          item.blockedReason = "failure";
          repairQueue.push(item.id);
          downtime.failure += 1;
          addEvent(step, "failure", `${item.id} 的 ${item.component.name} 故障，创建修复性维修活动`, "danger");
        } else {
          item.remaining -= 1;
          if (item.remaining <= 0) {
            item.status = "ready";
            item.blockedReason = "";
            recoveryTimes.push(3);
            turnaroundTimes.push(5);
            addEvent(step, "recover", `${item.id} 回收检查完成，恢复 ready`, "success");
          }
        }
      } else if (item.status === "repairing") {
        item.remaining -= 1;
        if (item.remaining <= 0) {
          item.status = "ready";
          item.blockedReason = "";
          addEvent(step, "repair-complete", `${item.id} 修复完成`, "success");
        }
      }
    }

    let openCapacity = Math.max(0, supportCapacity - equipment.filter((item) => item.status === "repairing").length);
    const queueSnapshot = repairQueue.splice(0, repairQueue.length);
    for (const equipmentId of queueSnapshot) {
      const item = equipment.find((entry) => entry.id === equipmentId);
      if (!item || item.status !== "failed") continue;
      if (openCapacity <= 0) {
        downtime.resource_delay += 1;
        item.blockedReason = "resource_delay";
        repairQueue.push(equipmentId);
        continue;
      }
      const spareType = item.component.spareType;
      spareDemand[spareType] = (spareDemand[spareType] || 0) + 1;
      if ((inventory[spareType] || 0) > 0) {
        inventory[spareType] -= 1;
        spareFilled[spareType] = (spareFilled[spareType] || 0) + 1;
        item.status = "repairing";
        item.remaining = 3;
        item.blockedReason = "";
        openCapacity -= 1;
        addEvent(step, "repair-start", `${item.id} 消耗 ${spareType} 开始维修`, "info");
      } else {
        spareShortage[spareType] = (spareShortage[spareType] || 0) + 1;
        downtime.spare_shortage += 1;
        item.blockedReason = "spare_shortage";
        repairQueue.push(equipmentId);
        addEvent(step, "shortage", `${spareType} 库存不足，${item.id} 等待调运`, "danger");
      }
    }

    if (step % scenario.missionProfile.repeatCycleHours === 0) {
      missionChecks += 1;
      const waveTarget = missionChecks * minRequired;
      if (successfulSorties >= waveTarget) {
        missionSuccesses += 1;
        addEvent(step, "mission-success", `第 ${missionChecks} 个任务波次满足最低出动数量`, "success");
      } else {
        addEvent(step, "mission-failure", `第 ${missionChecks} 个任务波次未满足最低出动数量`, "danger");
      }
    }

    timeline.push(snapshot(step, equipment, inventory, {
      minRequired,
      sortieAttempts,
      successfulSorties,
      missionChecks,
      missionSuccesses,
      spareDemand,
      spareFilled,
      spareShortage,
      repairQueue,
      launchTimes,
      recoveryTimes,
      turnaroundTimes,
      downtime
    }));
  }

  const final = timeline.at(-1) || {};
  return {
    scenario,
    timeline,
    final,
    events,
    spareShortfalls: buildSpareShortfalls(spareDemand, spareFilled, spareShortage),
    carryList: buildCarryList(spareDemand, spareShortage, scenario.components),
    downtimeFactors: buildDowntimeFactors(downtime),
    reliability: buildReliabilityAnalysis(timeline, missionChecks, missionSuccesses)
  };
}

export function runMonteCarlo(inputScenario = defaultScenario, options = {}) {
  const scenario = mergeScenario(inputScenario, options);
  const samples = Number(options.samples ?? scenario.experiment.samples);
  const sweep = options.sweep ?? buildMonteCarloSweep(scenario);
  const runs = [];
  for (const group of sweep) {
    for (let index = 0; index < samples; index += 1) {
      const seed = Number(scenario.experiment.seed) + index + Math.floor((group.failureRate || 0) * 10000);
      const result = runSimulation(scenario, { ...group, seed, steps: scenario.experiment.steps });
      runs.push({
        sampleId: `${group.name}-${index + 1}`,
        group: group.name,
        seed,
        parameters: group,
        final: result.final,
        spareShortfalls: result.spareShortfalls,
        downtimeFactors: result.downtimeFactors
      });
    }
  }
  return summarizeMonteCarlo(runs);
}

function buildMonteCarloSweep(scenario) {
  const monteCarlo = scenario.monteCarlo || {};
  const failureRates = normalizeSweepValues(monteCarlo.failureRates, [0.08]);
  const spareMultipliers = normalizeSweepValues(monteCarlo.spareMultipliers, [1]);
  const supportCapacities = normalizeSweepValues(monteCarlo.supportCapacities, [3]);
  const minRequiredSorties = Number(scenario.basicMission?.minRequiredSorties ?? 5);
  const sweep = [];
  for (const failureRate of failureRates) {
    for (const spareMultiplier of spareMultipliers) {
      for (const supportCapacity of supportCapacities) {
        sweep.push({
          name: `F${failureRate}-S${spareMultiplier}-C${supportCapacity}`,
          failureRate,
          spareMultiplier,
          supportCapacity,
          minRequiredSorties
        });
      }
    }
  }
  return sweep;
}

function normalizeSweepValues(values, fallback) {
  const parsed = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return parsed.length ? parsed : fallback;
}

export function summarizeMonteCarlo(runs) {
  const groups = [...new Set(runs.map((run) => run.group))].map((group) => {
    const subset = runs.filter((run) => run.group === group);
    return {
      group,
      count: subset.length,
      mission_success_rate: summarizeMetric(subset, "mission_success_rate"),
      ready_rate: summarizeMetric(subset, "ready_rate"),
      sortie_rate: summarizeMetric(subset, "sortie_rate"),
      spare_fill_rate: summarizeMetric(subset, "spare_fill_rate"),
      spare_utilization: summarizeMetric(subset, "spare_utilization"),
      shortage_events: summarizeMetric(subset, "shortage_events"),
      repair_backlog: summarizeMetric(subset, "repair_backlog"),
      mean_launch_time: summarizeMetric(subset, "mean_launch_time"),
      mean_recovery_time: summarizeMetric(subset, "mean_recovery_time"),
      mean_turnaround_time: summarizeMetric(subset, "mean_turnaround_time")
    };
  });
  const aggregateShortfalls = {};
  const aggregateDowntime = {};
  for (const run of runs) {
    for (const row of run.spareShortfalls) {
      aggregateShortfalls[row.spareType] ||= { demand: 0, filled: 0, shortage: 0 };
      aggregateShortfalls[row.spareType].demand += row.demand;
      aggregateShortfalls[row.spareType].filled += row.filled;
      aggregateShortfalls[row.spareType].shortage += row.shortage;
    }
    for (const row of run.downtimeFactors) {
      aggregateDowntime[row.reason] = (aggregateDowntime[row.reason] || 0) + row.count;
    }
  }
  return {
    runs,
    groups,
    spareShortfalls: buildSpareShortfallsFromAggregate(aggregateShortfalls),
    carryList: buildCarryListFromAggregate(aggregateShortfalls),
    downtimeFactors: buildDowntimeFactors(aggregateDowntime)
  };
}

function mergeScenario(scenario, overrides) {
  const merged = cloneScenario(scenario);
  if (overrides.steps !== undefined) merged.experiment.steps = Number(overrides.steps);
  if (overrides.samples !== undefined) merged.experiment.samples = Number(overrides.samples);
  if (overrides.seed !== undefined) merged.experiment.seed = Number(overrides.seed);
  if (overrides.minRequiredSorties !== undefined) merged.basicMission.minRequiredSorties = Number(overrides.minRequiredSorties);
  if (overrides.supportCapacity !== undefined) merged.supportNodes[0].equipmentCapacity = Number(overrides.supportCapacity);
  if (overrides.failureRate !== undefined) {
    for (const component of merged.components) {
      component.failureRate = Number(overrides.failureRate);
    }
    for (const node of merged.reliabilityBlockDiagram.nodes) {
      if (node.type === "component") node.failureRate = Number(overrides.failureRate);
    }
  }
  return merged;
}

function snapshot(step, equipment, inventory, state) {
  const total = equipment.length || 1;
  const counts = statusCounts(equipment);
  const demandTotal = sumValues(state.spareDemand);
  const filledTotal = sumValues(state.spareFilled);
  const initialStock = demandTotal + sumValues(inventory);
  return {
    step,
    wave: Math.ceil(step / 6),
    ready_count: counts.ready || 0,
    preparing_count: counts.preparing || 0,
    sortie_count: counts.sortie || 0,
    failed_count: counts.failed || 0,
    repairing_count: counts.repairing || 0,
    ready_rate: (counts.ready || 0) / total,
    mission_success_rate: state.missionSuccesses / Math.max(1, state.missionChecks),
    sortie_rate: state.successfulSorties / Math.max(1, state.sortieAttempts),
    spare_fill_rate: filledTotal / Math.max(1, demandTotal),
    spare_utilization: filledTotal / Math.max(1, initialStock),
    shortage_events: sumValues(state.spareShortage),
    repair_backlog: state.repairQueue.length,
    mean_launch_time: average(state.launchTimes),
    mean_recovery_time: average(state.recoveryTimes),
    mean_turnaround_time: average(state.turnaroundTimes),
    downtime_failure_events: state.downtime.failure,
    downtime_spare_shortage_events: state.downtime.spare_shortage,
    downtime_resource_delay_events: state.downtime.resource_delay,
    downtime_schedule_delay_events: state.downtime.schedule_delay
  };
}

function statusCounts(equipment) {
  return equipment.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

function weightedComponent(components, value) {
  if (!components.length) return { name: "默认部件", spareType: "通用备件", failureRate: 0.05 };
  const total = components.reduce((sum, item) => sum + Number(item.failureRate || 0.01), 0);
  let cursor = 0;
  for (const component of components) {
    cursor += Number(component.failureRate || 0.01) / total;
    if (value <= cursor) return component;
  }
  return components.at(-1);
}

function scaleInventory(inventory, multiplier) {
  return Object.fromEntries(
    Object.entries(inventory || {}).map(([key, value]) => [key, Math.max(0, Math.round(Number(value) * multiplier))])
  );
}

function buildSpareShortfalls(spareDemand, spareFilled, spareShortage) {
  const keys = [...new Set([...Object.keys(spareDemand), ...Object.keys(spareFilled), ...Object.keys(spareShortage)])];
  return keys.map((spareType) => {
    const demand = spareDemand[spareType] || 0;
    const filled = spareFilled[spareType] || 0;
    const shortage = spareShortage[spareType] || 0;
    return {
      spareType,
      demand,
      filled,
      shortage,
      fillRate: filled / Math.max(1, demand),
      riskLevel: shortage >= 3 ? "高" : shortage > 0 ? "中" : "低"
    };
  }).sort((a, b) => b.shortage - a.shortage || b.demand - a.demand);
}

function buildSpareShortfallsFromAggregate(aggregate) {
  return Object.entries(aggregate).map(([spareType, row]) => ({
    spareType,
    demand: row.demand,
    filled: row.filled,
    shortage: row.shortage,
    fillRate: row.filled / Math.max(1, row.demand),
    riskLevel: row.shortage >= 10 ? "高" : row.shortage > 0 ? "中" : "低"
  })).sort((a, b) => b.shortage - a.shortage || b.demand - a.demand);
}

function buildCarryList(spareDemand, spareShortage, components) {
  const rows = components.map((component) => {
    const demand = spareDemand[component.spareType] || 0;
    const shortage = spareShortage[component.spareType] || 0;
    const recommended = Math.max(1, Math.ceil(demand * 1.15 + shortage * 1.5));
    return {
      spareType: component.spareType,
      component: component.name,
      recommended,
      demand,
      shortage,
      riskLevel: shortage >= 3 ? "高" : shortage > 0 ? "中" : "低"
    };
  });
  return rows.sort((a, b) => b.recommended - a.recommended);
}

function buildCarryListFromAggregate(aggregate) {
  return Object.entries(aggregate).map(([spareType, row]) => ({
    spareType,
    component: spareType,
    recommended: Math.max(1, Math.ceil((row.demand / 4) * 1.15 + row.shortage * 0.5)),
    demand: row.demand,
    shortage: row.shortage,
    riskLevel: row.shortage >= 10 ? "高" : row.shortage > 0 ? "中" : "低"
  })).sort((a, b) => b.recommended - a.recommended);
}

function buildDowntimeFactors(downtime) {
  const labels = {
    failure: "装备故障",
    spare_shortage: "备件短缺",
    resource_delay: "保障资源不足",
    schedule_delay: "任务需求变化"
  };
  const total = Math.max(1, sumValues(downtime));
  return Object.entries(downtime).map(([reason, count]) => ({
    reason,
    label: labels[reason] || reason,
    count,
    contribution: count / total
  })).sort((a, b) => b.count - a.count);
}

function buildReliabilityAnalysis(timeline, missionChecks, missionSuccesses) {
  const final = timeline.at(-1) || {};
  return {
    missionChecks,
    missionSuccesses,
    missionReliability: missionSuccesses / Math.max(1, missionChecks),
    readyRate: final.ready_rate || 0,
    sortieRate: final.sortie_rate || 0,
    meanLaunchTime: final.mean_launch_time || 0,
    meanRecoveryTime: final.mean_recovery_time || 0,
    meanTurnaroundTime: final.mean_turnaround_time || 0
  };
}

function summarizeMetric(runs, metric) {
  const values = runs.map((run) => Number(run.final[metric] || 0));
  return {
    mean: average(values),
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

function average(values) {
  const valid = values.map(Number).filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function sumValues(record) {
  return Object.values(record || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}
