CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  thread_id UUID PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user', 'apiKey')),
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  prd JSONB,
  prd_markdown TEXT NOT NULL DEFAULT '',
  prototype_html TEXT NOT NULL DEFAULT '',
  error TEXT,
  gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_text TEXT NOT NULL DEFAULT '',
  structured_requirements JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS usage_daily (
  principal_key TEXT NOT NULL,
  day DATE NOT NULL,
  token_total BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (principal_key, day)
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS tasks_expires_at_idx ON tasks (expires_at);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);
