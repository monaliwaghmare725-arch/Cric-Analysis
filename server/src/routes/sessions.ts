import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { runTriageAssessment } from '../services/openaiTriage.js';

export const sessionsRouter = Router();

const createSessionSchema = z.object({
  patientName: z.string().trim().min(1).max(120),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  contactPhone: z.string().trim().max(40).optional().nullable(),
});

const messageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
});

const dispositionSchema = z.object({
  disposition: z.enum([
    'confirm_priority',
    'override_priority',
    'send_to_room',
    'discharge_advice',
    'transfer_ed',
  ]),
  nurseNotes: z.string().trim().max(2000).optional().nullable(),
  confirmedPriority: z.number().int().min(1).max(5).optional().nullable(),
  nurseName: z.string().trim().min(1).max(120).optional().nullable(),
});

const INTAKE_QUESTIONS = [
  "Hi, I'm TriageIQ — I'll ask a few questions so a nurse can prioritize your visit. What is the main reason you're here today?",
  'When did this start, and has it gotten better, worse, or stayed the same?',
  'On a scale of 0–10, how bad is it right now? Any other symptoms along with it?',
  'Do you have any medical conditions, medications, or allergies we should know about?',
  'Is there anything else important for the nurse to know before they see you?',
];

function buildTranscript(
  messages: Array<{ role: string; content: string }>
): string {
  return messages
    .map((m) => `${m.role === 'patient' ? 'Patient' : 'Assistant'}: ${m.content}`)
    .join('\n');
}

sessionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSessionSchema.parse(req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sessionResult = await client.query(
        `INSERT INTO patient_sessions (patient_name, date_of_birth, contact_phone, status)
         VALUES ($1, $2, $3, 'intake')
         RETURNING *`,
        [body.patientName, body.dateOfBirth ?? null, body.contactPhone ?? null]
      );
      const session = sessionResult.rows[0];
      const greeting = INTAKE_QUESTIONS[0];
      await client.query(
        `INSERT INTO intake_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
        [session.id, greeting]
      );
      await client.query('COMMIT');

      res.status(201).json({
        session: mapSession(session),
        messages: [{ role: 'assistant', content: greeting }],
        questionIndex: 0,
        totalQuestions: INTAKE_QUESTIONS.length,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

sessionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const session = await getSessionBundle(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
      return;
    }
    res.json(session);
  })
);

sessionsRouter.post(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const body = messageSchema.parse(req.body);
    const sessionId = req.params.id;

    const sessionRes = await pool.query(`SELECT * FROM patient_sessions WHERE id = $1`, [
      sessionId,
    ]);
    if (!sessionRes.rowCount) {
      res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
      return;
    }
    const session = sessionRes.rows[0];
    if (session.status !== 'intake') {
      res.status(409).json({
        error: 'Intake already completed for this session',
        code: 'INTAKE_CLOSED',
      });
      return;
    }

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM intake_messages WHERE session_id = $1 AND role = 'patient'`,
      [sessionId]
    );
    const answered = countRes.rows[0].c as number;
    if (answered >= INTAKE_QUESTIONS.length) {
      res.status(409).json({
        error: 'All intake questions already answered. Submit for triage.',
        code: 'INTAKE_COMPLETE',
      });
      return;
    }

    await pool.query(
      `INSERT INTO intake_messages (session_id, role, content) VALUES ($1, 'patient', $2)`,
      [sessionId, body.content]
    );

    const nextIndex = answered + 1;
    let assistantReply: string | null = null;
    let intakeComplete = false;

    if (nextIndex < INTAKE_QUESTIONS.length) {
      assistantReply = INTAKE_QUESTIONS[nextIndex];
      await pool.query(
        `INSERT INTO intake_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
        [sessionId, assistantReply]
      );
    } else {
      assistantReply =
        'Thank you. Review your answers, then tap Submit for nurse review. A licensed nurse will confirm priority — TriageIQ only recommends.';
      await pool.query(
        `INSERT INTO intake_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
        [sessionId, assistantReply]
      );
      await pool.query(
        `UPDATE patient_sessions SET status = 'awaiting_triage', updated_at = NOW() WHERE id = $1`,
        [sessionId]
      );
      intakeComplete = true;
    }

    const messages = await pool.query(
      `SELECT role, content, created_at FROM intake_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    );

    res.json({
      messages: messages.rows,
      questionIndex: Math.min(nextIndex, INTAKE_QUESTIONS.length - 1),
      totalQuestions: INTAKE_QUESTIONS.length,
      intakeComplete,
      assistantReply,
    });
  })
);

sessionsRouter.post(
  '/:id/triage',
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    console.log(`[triage] endpoint hit session=${sessionId}`);

    const sessionRes = await pool.query(`SELECT * FROM patient_sessions WHERE id = $1`, [
      sessionId,
    ]);
    if (!sessionRes.rowCount) {
      res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
      return;
    }
    const session = sessionRes.rows[0];

    const existing = await pool.query(
      `SELECT id FROM triage_assessments WHERE session_id = $1`,
      [sessionId]
    );
    if (existing.rowCount) {
      const bundle = await getSessionBundle(sessionId);
      res.json({ ...bundle, alreadyAssessed: true });
      return;
    }

    const messagesRes = await pool.query(
      `SELECT role, content FROM intake_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    );
    if (messagesRes.rows.filter((m) => m.role === 'patient').length < 1) {
      res.status(400).json({
        error: 'Cannot triage: no patient responses yet',
        code: 'INSUFFICIENT_INTAKE',
      });
      return;
    }

    const transcript = buildTranscript(messagesRes.rows);
    const { result, model, raw } = await runTriageAssessment({
      patientName: session.patient_name,
      transcript,
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO structured_intakes (
          session_id, chief_complaint, symptom_summary, onset, severity,
          associated_symptoms, relevant_history, medications, allergies, raw_transcript
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
        ON CONFLICT (session_id) DO UPDATE SET
          chief_complaint = EXCLUDED.chief_complaint,
          symptom_summary = EXCLUDED.symptom_summary,
          onset = EXCLUDED.onset,
          severity = EXCLUDED.severity,
          associated_symptoms = EXCLUDED.associated_symptoms,
          relevant_history = EXCLUDED.relevant_history,
          medications = EXCLUDED.medications,
          allergies = EXCLUDED.allergies,
          raw_transcript = EXCLUDED.raw_transcript`,
        [
          sessionId,
          result.structured_intake.chief_complaint,
          result.structured_intake.symptom_summary,
          result.structured_intake.onset,
          result.structured_intake.severity,
          JSON.stringify(result.structured_intake.associated_symptoms),
          result.structured_intake.relevant_history,
          result.structured_intake.medications,
          result.structured_intake.allergies,
          transcript,
        ]
      );

      const assessmentRes = await client.query(
        `INSERT INTO triage_assessments (
          session_id, priority_score, priority_label, rationale,
          red_flags, recommended_actions, model, raw_response
        ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb)
        RETURNING *`,
        [
          sessionId,
          result.priority_score,
          result.priority_label,
          result.rationale,
          JSON.stringify(result.red_flags),
          JSON.stringify(result.recommended_actions),
          model,
          JSON.stringify(raw),
        ]
      );

      await client.query(
        `UPDATE patient_sessions SET status = 'queued', updated_at = NOW() WHERE id = $1`,
        [sessionId]
      );
      await client.query('COMMIT');

      console.log(
        `[triage] persisted session=${sessionId} priority=${result.priority_score} red_flags=${result.red_flags.length}`
      );

      res.status(201).json({
        session: mapSession({ ...session, status: 'queued' }),
        assessment: mapAssessment(assessmentRes.rows[0]),
        structuredIntake: result.structured_intake,
        disclaimer:
          'AI recommendation only — a licensed nurse must confirm priority. TriageIQ does not diagnose or finalize triage.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

sessionsRouter.patch(
  '/:id/disposition',
  asyncHandler(async (req, res) => {
    const body = dispositionSchema.parse(req.body);
    const sessionId = req.params.id;

    const sessionRes = await pool.query(`SELECT * FROM patient_sessions WHERE id = $1`, [
      sessionId,
    ]);
    if (!sessionRes.rowCount) {
      res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const disp = await client.query(
        `INSERT INTO nurse_dispositions (session_id, disposition, nurse_notes, confirmed_priority, nurse_name)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (session_id) DO UPDATE SET
           disposition = EXCLUDED.disposition,
           nurse_notes = EXCLUDED.nurse_notes,
           confirmed_priority = EXCLUDED.confirmed_priority,
           nurse_name = EXCLUDED.nurse_name,
           created_at = NOW()
         RETURNING *`,
        [
          sessionId,
          body.disposition,
          body.nurseNotes ?? null,
          body.confirmedPriority ?? null,
          body.nurseName ?? null,
        ]
      );
      await client.query(
        `UPDATE patient_sessions SET status = 'dispositioned', updated_at = NOW() WHERE id = $1`,
        [sessionId]
      );
      await client.query('COMMIT');
      res.json({ disposition: mapDisposition(disp.rows[0]) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

function mapSession(row: Record<string, unknown>) {
  return {
    id: row.id,
    patientName: row.patient_name,
    dateOfBirth: row.date_of_birth,
    contactPhone: row.contact_phone,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAssessment(row: Record<string, unknown>) {
  return {
    id: row.id,
    sessionId: row.session_id,
    priorityScore: row.priority_score,
    priorityLabel: row.priority_label,
    rationale: row.rationale,
    redFlags: row.red_flags,
    recommendedActions: row.recommended_actions,
    model: row.model,
    createdAt: row.created_at,
  };
}

function mapDisposition(row: Record<string, unknown>) {
  return {
    id: row.id,
    sessionId: row.session_id,
    disposition: row.disposition,
    nurseNotes: row.nurse_notes,
    confirmedPriority: row.confirmed_priority,
    nurseName: row.nurse_name,
    createdAt: row.created_at,
  };
}

function mapStructured(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return {
    chiefComplaint: row.chief_complaint,
    symptomSummary: row.symptom_summary,
    onset: row.onset,
    severity: row.severity,
    associatedSymptoms: row.associated_symptoms,
    relevantHistory: row.relevant_history,
    medications: row.medications,
    allergies: row.allergies,
  };
}

async function getSessionBundle(sessionId: string) {
  const sessionRes = await pool.query(`SELECT * FROM patient_sessions WHERE id = $1`, [
    sessionId,
  ]);
  if (!sessionRes.rowCount) return null;

  const [messages, intake, assessment, disposition] = await Promise.all([
    pool.query(
      `SELECT role, content, created_at AS "createdAt" FROM intake_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    ),
    pool.query(`SELECT * FROM structured_intakes WHERE session_id = $1`, [sessionId]),
    pool.query(`SELECT * FROM triage_assessments WHERE session_id = $1`, [sessionId]),
    pool.query(`SELECT * FROM nurse_dispositions WHERE session_id = $1`, [sessionId]),
  ]);

  return {
    session: mapSession(sessionRes.rows[0]),
    messages: messages.rows,
    structuredIntake: mapStructured(intake.rows[0]),
    assessment: assessment.rows[0] ? mapAssessment(assessment.rows[0]) : null,
    disposition: disposition.rows[0] ? mapDisposition(disposition.rows[0]) : null,
  };
}
