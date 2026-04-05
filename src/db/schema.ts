export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  team_id    TEXT NOT NULL,
  branch     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL,
  project_id   TEXT,
  sender       TEXT NOT NULL,
  content      TEXT NOT NULL,
  mentions     TEXT NOT NULL DEFAULT '[]',
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_team
  ON messages (team_id, project_id, created_at);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id              TEXT PRIMARY KEY,
  team_id         TEXT NOT NULL,
  project_id      TEXT,
  agent_name      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'idle',
  status_text     TEXT,
  sdk_session_id  TEXT,
  updated_at      INTEGER NOT NULL
);
`;
