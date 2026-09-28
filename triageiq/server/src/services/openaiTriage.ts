import OpenAI from 'openai';
import { assertOpenAiConfigured, env } from '../config.js';

export const TRIAGE_SYSTEM_PROMPT = `You are TriageIQ, a clinical decision-support assistant for urgent care intake.
Your role is ONLY to structure patient-reported information and recommend a provisional priority for a licensed nurse to review.

CRITICAL RULES:
- NEVER diagnose a condition.
- NEVER finalize triage or tell the patient they "have" a disease.
- NEVER replace the nurse's clinical judgment. Always frame output as a recommendation/flag.
- Flag red-flag symptoms explicitly when present or suspected from the history.

PRIORITY RUBRIC (ESI-inspired, 1 = most urgent, 5 = least urgent):
1 — Immediate life threat / resuscitation (e.g., unresponsive, severe respiratory distress, major hemorrhage). Recommend ED/EMS escalation.
2 — High risk / emergent (e.g., chest pain concerning for ACS, stroke signs F.A.S.T., severe shortness of breath, anaphylaxis signs, suicidal ideation with plan). Escalate to nurse immediately.
3 — Urgent but stable (significant pain, fever with concerning features, moderate injury needing timely eval).
4 — Semi-urgent (minor injuries, mild illness, stable vitals historically).
5 — Non-urgent (chronic mild symptoms, refill-type concerns, very minor complaints).

RED FLAGS to escalate (non-exhaustive): chest pain/pressure/tightness; difficulty breathing / SpO2 concern; stroke signs (face droop, arm weakness, speech difficulty); severe allergic reaction; uncontrolled bleeding; altered mental status; severe abdominal pain with rigidity; pregnancy + bleeding/severe pain; suicidal intent.

Respond with STRICT JSON only (no markdown):
{
  "priority_score": 1-5,
  "priority_label": "string",
  "rationale": "plain-language rationale for the nurse (2-4 sentences). Emphasize recommendation, not diagnosis.",
  "red_flags": ["list of specific red flags identified or empty"],
  "recommended_actions": ["nurse-facing suggested next steps, not orders"],
  "structured_intake": {
    "chief_complaint": "string",
    "symptom_summary": "string",
    "onset": "string or null",
    "severity": "string or null",
    "associated_symptoms": ["strings"],
    "relevant_history": "string or null",
    "medications": "string or null",
    "allergies": "string or null"
  }
}`;

export type TriageLlmResult = {
  priority_score: number;
  priority_label: string;
  rationale: string;
  red_flags: string[];
  recommended_actions: string[];
  structured_intake: {
    chief_complaint: string | null;
    symptom_summary: string | null;
    onset: string | null;
    severity: string | null;
    associated_symptoms: string[];
    relevant_history: string | null;
    medications: string | null;
    allergies: string | null;
  };
};

function clampPriority(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 3;
  return Math.min(5, Math.max(1, Math.round(v)));
}

export async function runTriageAssessment(input: {
  patientName: string;
  transcript: string;
}): Promise<{ result: TriageLlmResult; model: string; raw: unknown }> {
  assertOpenAiConfigured();

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const model = env.OPENAI_MODEL;

  console.log(`[openai] triage request starting model=${model} patient=${input.patientName}`);

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: TRIAGE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Patient name: ${input.patientName}\n\nConversational intake transcript:\n${input.transcript}\n\nProduce the JSON triage recommendation for the nurse queue.`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw Object.assign(new Error('OpenAI returned an empty triage response'), {
      statusCode: 502,
      code: 'OPENAI_EMPTY_RESPONSE',
    });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error('OpenAI returned non-JSON triage content'), {
      statusCode: 502,
      code: 'OPENAI_INVALID_JSON',
    });
  }

  const structured = (parsed.structured_intake ?? {}) as Record<string, unknown>;
  const result: TriageLlmResult = {
    priority_score: clampPriority(parsed.priority_score),
    priority_label: String(parsed.priority_label ?? `Priority ${clampPriority(parsed.priority_score)}`),
    rationale: String(parsed.rationale ?? 'No rationale provided by model.'),
    red_flags: Array.isArray(parsed.red_flags)
      ? parsed.red_flags.map(String).filter(Boolean)
      : [],
    recommended_actions: Array.isArray(parsed.recommended_actions)
      ? parsed.recommended_actions.map(String).filter(Boolean)
      : [],
    structured_intake: {
      chief_complaint: structured.chief_complaint != null ? String(structured.chief_complaint) : null,
      symptom_summary:
        structured.symptom_summary != null ? String(structured.symptom_summary) : null,
      onset: structured.onset != null ? String(structured.onset) : null,
      severity: structured.severity != null ? String(structured.severity) : null,
      associated_symptoms: Array.isArray(structured.associated_symptoms)
        ? structured.associated_symptoms.map(String)
        : [],
      relevant_history:
        structured.relevant_history != null ? String(structured.relevant_history) : null,
      medications: structured.medications != null ? String(structured.medications) : null,
      allergies: structured.allergies != null ? String(structured.allergies) : null,
    },
  };

  console.log(
    `[openai] triage request complete priority=${result.priority_score} red_flags=${result.red_flags.length}`
  );

  return { result, model, raw: parsed };
}
