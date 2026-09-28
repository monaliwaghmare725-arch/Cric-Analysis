import { Router } from 'express';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const queueRouter = Router();

queueRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT
         s.id,
         s.patient_name,
         s.status,
         s.created_at,
         s.updated_at,
         t.priority_score,
         t.priority_label,
         t.rationale,
         t.red_flags,
         t.recommended_actions,
         t.created_at AS assessed_at,
         si.chief_complaint,
         si.symptom_summary,
         si.onset,
         si.severity,
         si.associated_symptoms,
         si.relevant_history,
         si.medications,
         si.allergies,
         d.disposition,
         d.nurse_notes,
         d.confirmed_priority,
         d.nurse_name
       FROM patient_sessions s
       INNER JOIN triage_assessments t ON t.session_id = s.id
       LEFT JOIN structured_intakes si ON si.session_id = s.id
       LEFT JOIN nurse_dispositions d ON d.session_id = s.id
       WHERE s.status IN ('queued', 'in_review', 'dispositioned')
       ORDER BY
         CASE WHEN jsonb_array_length(COALESCE(t.red_flags, '[]'::jsonb)) > 0 THEN 0 ELSE 1 END,
         t.priority_score ASC,
         s.created_at ASC`
    );

    const items = result.rows.map((row) => {
      const redFlags = row.red_flags ?? [];
      return {
        id: row.id,
        patientName: row.patient_name,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        assessedAt: row.assessed_at,
        priorityScore: row.priority_score,
        priorityLabel: row.priority_label,
        rationale: row.rationale,
        redFlags,
        hasRedFlags: Array.isArray(redFlags) && redFlags.length > 0,
        recommendedActions: row.recommended_actions ?? [],
        structuredIntake: {
          chiefComplaint: row.chief_complaint,
          symptomSummary: row.symptom_summary,
          onset: row.onset,
          severity: row.severity,
          associatedSymptoms: row.associated_symptoms ?? [],
          relevantHistory: row.relevant_history,
          medications: row.medications,
          allergies: row.allergies,
        },
        disposition: row.disposition
          ? {
              disposition: row.disposition,
              nurseNotes: row.nurse_notes,
              confirmedPriority: row.confirmed_priority,
              nurseName: row.nurse_name,
            }
          : null,
      };
    });

    const escalations = items.filter((i) => i.hasRedFlags && i.status !== 'dispositioned');

    res.json({
      sortedBy: 'priority_then_red_flags',
      count: items.length,
      escalations: escalations.length,
      items,
    });
  })
);
