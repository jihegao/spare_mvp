PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  session_token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS project_access (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  access_role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, project_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_event_id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS system_configs (
  config_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  project_version TEXT NOT NULL,
  scenario_id TEXT,
  active_module TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS aircraft_mission_reliability_analyses (
  analysis_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  aircraft_model TEXT NOT NULL,
  mission_profile_id TEXT NOT NULL,
  mission_profile_name TEXT NOT NULL,
  duration_hours REAL NOT NULL,
  aircraft_reliability REAL NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_aircraft_mission_reliability_analyses_project_created
ON aircraft_mission_reliability_analyses(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS modeling_imports (
  import_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  import_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  referenced_run_ids_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  draft_payload_json TEXT,
  published_payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS experiment_plans (
  experiment_plan_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  modeling_snapshot_id TEXT,
  schema_version TEXT NOT NULL,
  project_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  canonical_fingerprint TEXT,
  frozen_at TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id),
  FOREIGN KEY (modeling_snapshot_id) REFERENCES modeling_snapshots(snapshot_id)
);

CREATE TABLE IF NOT EXISTS modeling_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  project_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

CREATE TABLE IF NOT EXISTS scenarios (
  scenario_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  scenario_version TEXT NOT NULL,
  simulation_model_family TEXT NOT NULL,
  simulation_model_id TEXT NOT NULL,
  mesa_contract_version TEXT,
  compiled_by TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

CREATE TABLE IF NOT EXISTS simulation_runs (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  experiment_plan_id TEXT,
  scenario_id TEXT,
  scenario_version TEXT,
  schema_version TEXT NOT NULL,
  model_family TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  run_type TEXT,
  seed INTEGER,
  result_summary_id TEXT,
  artifact_manifest_id TEXT NOT NULL,
  created_by TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'active',
  archived_at TEXT,
  deleted_at TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id),
  FOREIGN KEY (scenario_id) REFERENCES scenarios(scenario_id)
);

CREATE TABLE IF NOT EXISTS result_summaries (
  result_summary_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  scenario_version TEXT,
  schema_version TEXT NOT NULL,
  model_family TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES simulation_runs(run_id),
  FOREIGN KEY (scenario_id) REFERENCES scenarios(scenario_id)
);

CREATE TABLE IF NOT EXISTS artifact_manifests (
  artifact_manifest_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  scenario_id TEXT,
  scenario_version TEXT,
  schema_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES simulation_runs(run_id)
);
