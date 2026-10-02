import type { TriageLlmResult } from './openaiTriage.js';

/**
 * Explicit local rules engine for workshop/demo use when TRIAGE_MODE=demo.
 * Not a silent fallback for openai mode — only used when demo is selected on purpose.
 */
const RED_FLAG_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(chest pain|chest pressure|chest tightness|crushing chest)\b/i, label: 'Chest pain / pressure / tightness' },
  { re: /\b(short(ness)? of breath|difficulty breathing|can'?t breathe|dyspnea)\b/i, label: 'Difficulty breathing' },
  { re: /\b(face droop|arm weakness|slurred speech|stroke|f\.?a\.?s\.?t)\b/i, label: 'Stroke-like signs (F.A.S.T.)' },
  { re: /\b(anaphylaxis|throat swelling|severe allergic)\b/i, label: 'Severe allergic reaction signs' },
  { re: /\b(uncontrolled bleeding|bleeding heavily)\b/i, label: 'Uncontrolled bleeding' },
  { re: /\b(suicidal|want to die|kill myself)\b/i, label: 'Suicidal ideation' },
  { re: /\b(unresponsive|passed out|loss of consciousness)\b/i, label: 'Altered / loss of consciousness' },
];

function findRedFlags(text: string): string[] {
  const flags: string[] = [];
  for (const { re, label } of RED_FLAG_PATTERNS) {
    if (re.test(text)) flags.push(label);
  }
  return flags;
}

function extractSeverity(text: string): number | null {
  const m = text.match(/\b([0-9]|10)\s*\/\s*10\b/) || text.match(/\bseverity[^0-9]{0,12}([0-9]|10)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function firstPatientLine(transcript: string): string {
  const lines = transcript.split('\n').filter((l) => l.startsWith('Patient:'));
  const first = lines[0]?.replace(/^Patient:\s*/i, '').trim();
  return first || 'Symptom intake (demo)';
}

export function runDemoTriageAssessment(input: {
  patientName: string;
  transcript: string;
}): { result: TriageLlmResult; model: string; raw: unknown } {
  const text = input.transcript;
  const red_flags = findRedFlags(text);
  const severity = extractSeverity(text);
  const mild =
    /\b(mild|sprain|cold|refill|rash|sore throat|minor|bruise)\b/i.test(text) &&
    red_flags.length === 0;

  let priority_score = 3;
  let priority_label = 'Urgent but stable (demo)';
  let recommended_actions = [
    'Nurse review structured intake',
    'Confirm vitals and history',
    'Decide disposition (AI recommendation only)',
  ];

  if (red_flags.length > 0 || (severity !== null && severity >= 8)) {
    priority_score = 2;
    priority_label = 'High risk / emergent (demo)';
    recommended_actions = [
      'Escalate to nurse immediately',
      'Do not delay for non-urgent queue order',
      'Reassess airway/breathing/circulation as indicated',
    ];
  } else if (mild || (severity !== null && severity <= 3)) {
    priority_score = 4;
    priority_label = 'Semi-urgent (demo)';
    recommended_actions = [
      'Routine nurse review',
      'Confirm no red-flag symptoms missed',
    ];
  }

  const chief = firstPatientLine(text);
  const result: TriageLlmResult = {
    priority_score,
    priority_label,
    rationale: `Demo rules engine recommendation for ${input.patientName}. Priority ${priority_score} based on keyword/ESI-inspired heuristics${
      red_flags.length ? ` with red flags: ${red_flags.join('; ')}` : ''
    }. A licensed nurse must confirm disposition — this is not a diagnosis.`,
    red_flags,
    recommended_actions,
    structured_intake: {
      chief_complaint: chief,
      symptom_summary: text.slice(0, 500),
      onset: /\b(started|began|onset|since|yesterday|today|hours?|days?)\b/i.test(text)
        ? 'See transcript'
        : null,
      severity: severity !== null ? `${severity}/10` : null,
      associated_symptoms: [],
      relevant_history: /\b(history|condition|diabetes|hypertension|asthma)\b/i.test(text)
        ? 'See transcript'
        : null,
      medications: /\b(medication|meds|taking|prescription)\b/i.test(text) ? 'See transcript' : null,
      allergies: /\b(allerg(y|ies)|allergic)\b/i.test(text) ? 'See transcript' : null,
    },
  };

  console.log(
    `[demo] triage complete priority=${result.priority_score} red_flags=${result.red_flags.length}`
  );

  return {
    result,
    model: 'demo-rules-v1',
    raw: { mode: 'demo', priority_score, red_flags },
  };
}
