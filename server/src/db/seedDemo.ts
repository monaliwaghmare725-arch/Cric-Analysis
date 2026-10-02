/**
 * Seeds sample queued patients for UI/demo verification.
 * Does NOT mock the /triage OpenAI path — that endpoint still requires OPENAI_API_KEY.
 */
import { pool } from './pool.js';

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mild case
    const mild = await client.query(
      `INSERT INTO patient_sessions (patient_name, status)
       VALUES ('Jordan Lee', 'queued') RETURNING id`
    );
    const mildId = mild.rows[0].id as string;
    await client.query(
      `INSERT INTO structured_intakes (session_id, chief_complaint, symptom_summary, onset, severity, associated_symptoms, medications, allergies, raw_transcript)
       VALUES ($1, 'Ankle sprain', 'Twisted ankle playing basketball; ambulatory with limp', 'Yesterday evening', '4/10', '["swelling"]'::jsonb, 'Occasional ibuprofen', 'NKDA', 'seed')`,
      [mildId]
    );
    await client.query(
      `INSERT INTO triage_assessments (session_id, priority_score, priority_label, rationale, red_flags, recommended_actions, model, raw_response)
       VALUES ($1, 4, 'Semi-urgent', 'Recommend Priority 4 for isolated ankle injury without neurovascular red flags. Nurse should confirm weight-bearing and exam — AI recommendation only.', '[]'::jsonb, '["Nurse exam of ankle","Ice/elevate education"]'::jsonb, 'seed-fixture', '{}'::jsonb)`,
      [mildId]
    );

    // Red-flag case
    const hot = await client.query(
      `INSERT INTO patient_sessions (patient_name, status)
       VALUES ('Sam Okonkwo', 'queued') RETURNING id`
    );
    const hotId = hot.rows[0].id as string;
    await client.query(
      `INSERT INTO structured_intakes (session_id, chief_complaint, symptom_summary, onset, severity, associated_symptoms, relevant_history, medications, allergies, raw_transcript)
       VALUES ($1, 'Chest tightness with shortness of breath', 'Sudden chest pressure radiating to left arm with dyspnea', '45 minutes ago', '8/10', '["shortness of breath","diaphoresis"]'::jsonb, 'Hypertension', 'Lisinopril', 'NKDA', 'seed-red-flag')`,
      [hotId]
    );
    await client.query(
      `INSERT INTO triage_assessments (session_id, priority_score, priority_label, rationale, red_flags, recommended_actions, model, raw_response)
       VALUES ($1, 2, 'High risk / emergent', 'Recommend Priority 2 and immediate nurse escalation for chest tightness with dyspnea — possible ACS pattern. This is a flag for licensed clinician confirmation, not a diagnosis.', '["Chest pain/pressure","Difficulty breathing","Symptoms concerning for acute coronary syndrome"]'::jsonb, '["Immediate nurse assessment","Consider ED transfer per protocol","Do not leave unmonitored"]'::jsonb, 'seed-fixture', '{}'::jsonb)`,
      [hotId]
    );

    await client.query('COMMIT');
    console.log('[seed] queued Jordan Lee (P4) and Sam Okonkwo (P2 red-flag)');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
