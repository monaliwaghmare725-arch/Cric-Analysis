const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '';

export class ApiError extends Error {
  status: number;
  code?: string;
  issues?: unknown;

  constructor(message: string, status: number, code?: string, issues?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new ApiError(
      `Cannot reach TriageIQ API at ${API_BASE}. Is the server running?`,
      0,
      'NETWORK_ERROR'
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string }).error || `Request failed (${res.status})`,
      res.status,
      (data as { code?: string }).code,
      (data as { issues?: unknown }).issues
    );
  }
  return data as T;
}

export type ChatMessage = { role: string; content: string; createdAt?: string };

export type QueueItem = {
  id: string;
  patientName: string;
  status: string;
  createdAt: string;
  priorityScore: number;
  priorityLabel: string;
  rationale: string;
  redFlags: string[];
  hasRedFlags: boolean;
  recommendedActions: string[];
  structuredIntake: {
    chiefComplaint: string | null;
    symptomSummary: string | null;
    onset: string | null;
    severity: string | null;
    associatedSymptoms: string[];
    relevantHistory: string | null;
    medications: string | null;
    allergies: string | null;
  };
  disposition: {
    disposition: string;
    nurseNotes: string | null;
    confirmedPriority: number | null;
    nurseName: string | null;
  } | null;
};

export const api = {
  health: () =>
    request<{
      ok: boolean;
      db: string;
      openaiConfigured: boolean;
      openaiNote: string;
    }>('/api/health'),

  createSession: (body: {
    patientName: string;
    dateOfBirth?: string | null;
    contactPhone?: string | null;
  }) =>
    request<{
      session: { id: string; patientName: string; status: string };
      messages: ChatMessage[];
      questionIndex: number;
      totalQuestions: number;
    }>('/api/sessions', { method: 'POST', body: JSON.stringify(body) }),

  sendMessage: (sessionId: string, content: string) =>
    request<{
      messages: ChatMessage[];
      questionIndex: number;
      totalQuestions: number;
      intakeComplete: boolean;
      assistantReply: string | null;
    }>(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  runTriage: (sessionId: string) =>
    request<{
      session: { id: string; status: string };
      assessment: {
        priorityScore: number;
        priorityLabel: string;
        rationale: string;
        redFlags: string[];
        recommendedActions: string[];
      };
      structuredIntake: unknown;
      disclaimer: string;
    }>(`/api/sessions/${sessionId}/triage`, { method: 'POST' }),

  getQueue: () =>
    request<{ sortedBy: string; count: number; escalations: number; items: QueueItem[] }>(
      '/api/queue'
    ),

  setDisposition: (
    sessionId: string,
    body: {
      disposition: string;
      nurseNotes?: string | null;
      confirmedPriority?: number | null;
      nurseName?: string | null;
    }
  ) =>
    request<{ disposition: unknown }>(`/api/sessions/${sessionId}/disposition`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};
