CREATE TABLE IF NOT EXISTS athlete (
 id uuid PRIMARY KEY, timezone text NOT NULL DEFAULT 'Europe/Brussels', weekly_hours numeric NOT NULL DEFAULT 6 CHECK(weekly_hours BETWEEN 1 AND 40)
);
INSERT INTO athlete(id) VALUES ('00000000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS athlete_metric_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, athlete_id uuid NOT NULL REFERENCES athlete(id), kind text NOT NULL CHECK(kind IN ('ftp','weight')), value numeric NOT NULL CHECK(value>0), valid_from timestamptz NOT NULL, confirmed boolean NOT NULL DEFAULT true,
 UNIQUE(athlete_id,kind,valid_from)
);
CREATE TABLE IF NOT EXISTS garmin_connection (
 athlete_id uuid PRIMARY KEY REFERENCES athlete(id), token_ciphertext text, token_fingerprint text, token_expires_at timestamptz, last_poll_at timestamptz, last_success_at timestamptz, last_error text, next_poll_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO garmin_connection(athlete_id) SELECT id FROM athlete ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS activity (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_id uuid NOT NULL REFERENCES athlete(id), provider text NOT NULL DEFAULT 'garmin', external_id text NOT NULL, name text NOT NULL, start_time timestamptz, sport text, metadata jsonb NOT NULL DEFAULT '{}', analysis jsonb, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete','failed')), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(athlete_id,provider,external_id)
);
CREATE INDEX IF NOT EXISTS activity_start ON activity(athlete_id,start_time DESC);
CREATE TABLE IF NOT EXISTS fit_file (
 activity_id uuid PRIMARY KEY REFERENCES activity(id) ON DELETE CASCADE, object_key text NOT NULL, archive_key text NOT NULL, sha256 text NOT NULL, bytes integer NOT NULL CHECK(bytes>0), parser_version text NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS activity_lap (
 activity_id uuid NOT NULL REFERENCES activity(id) ON DELETE CASCADE, lap_index integer NOT NULL, data jsonb NOT NULL, PRIMARY KEY(activity_id,lap_index)
);
CREATE TABLE IF NOT EXISTS sync_job (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_id uuid NOT NULL REFERENCES athlete(id), kind text NOT NULL CHECK(kind IN ('poll','import')), dedupe_key text NOT NULL UNIQUE, payload jsonb NOT NULL DEFAULT '{}', state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','done','failed')), attempts integer NOT NULL DEFAULT 0, next_run_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_due ON sync_job(state,next_run_at);
CREATE TABLE IF NOT EXISTS audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, athlete_id uuid NOT NULL REFERENCES athlete(id), action text NOT NULL, entity_id text, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE athlete ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete_metric_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE garmin_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE fit_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_lap ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
-- No browser policies: only the server database role accesses these tables.

CREATE TABLE IF NOT EXISTS chatgpt_connection (
  athlete_id uuid PRIMARY KEY REFERENCES athlete(id),
  host_id text NOT NULL,
  client_id text,
  subject text,
  credential_ciphertext text,
  state text NOT NULL DEFAULT 'disconnected' CHECK (state IN ('disconnected','active','refreshing','reauth_required')),
  version integer NOT NULL DEFAULT 1,
  operation_started_at timestamptz,
  retry_after timestamptz,
  access_expires_at timestamptz,
  checked_at timestamptz,
  next_test_at timestamptz NOT NULL DEFAULT now(),
  error_code text,
  pair_hash text,
  pair_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state IN ('active','refreshing') AND credential_ciphertext IS NOT NULL AND client_id IS NOT NULL AND subject IS NOT NULL)
    OR (state IN ('disconnected','reauth_required') AND credential_ciphertext IS NULL))
);
ALTER TABLE chatgpt_connection ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON chatgpt_connection FROM PUBLIC;
-- No browser policies: only the application's authenticated server accesses this table.
