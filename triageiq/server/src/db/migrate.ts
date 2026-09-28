import { pool } from './pool.js';

const schema = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS patient_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_name TEXT NOT NULL,
  date_of_birth DATE,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'intake'
    CHECK (status IN ('intake', 'awaiting_triage', 'queued', 'in_review', 'dispositioned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intake_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES patient_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('assistant', 'patient', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS structured_intakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES patient_sessions(id) ON DELETE CASCADE,
  chief_complaint TEXT,
  symptom_summary TEXT,
  onset TEXT,
  severity TEXT,
  associated_symptoms JSONB NOT NULL DEFAULT '[]'::jsonb,
  relevant_history TEXT,
  medications TEXT,
  allergies TEXT,
  raw_transcript TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS triage_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES patient_sessions(id) ON DELETE CASCADE,
  priority_score INTEGER NOT NULL CHECK (priority_score BETWEEN 1 AND 5),
  priority_label TEXT NOT NULL,
  rationale TEXT NOT NULL,
  red_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  model TEXT NOT NULL,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nurse_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES patient_sessions(id) ON DELETE CASCADE,
  disposition TEXT NOT NULL
    CHECK (disposition IN ('confirm_priority', 'override_priority', 'send_to_room', 'discharge_advice', 'transfer_ed')),
  nurse_notes TEXT,
  confirmed_priority INTEGER CHECK (confirmed_priority BETWEEN 1 AND 5),
  nurse_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON patient_sessions(status);
CREATE INDEX IF NOT EXISTS idx_assessments_priority ON triage_assessments(priority_score);
CREATE INDEX IF NOT EXISTS idx_messages_session ON intake_messages(session_id, created_at);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(schema);
    console.log('[migrate] schema applied successfully');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('[migrate] failed', err);
  process.exit(1);
});
