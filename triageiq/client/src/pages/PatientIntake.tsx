import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, type ChatMessage } from '../api';

type Phase = 'checkin' | 'chat' | 'submitting' | 'done' | 'error';

export function PatientIntake() {
  const [phase, setPhase] = useState<Phase>('checkin');
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [phone, setPhone] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [intakeComplete, setIntakeComplete] = useState(false);
  const [progress, setProgress] = useState({ q: 0, total: 5 });
  const [doneSummary, setDoneSummary] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, phase]);

  async function startCheckin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    if (!name.trim()) {
      setError('Please enter your name to begin.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.createSession({
        patientName: name.trim(),
        dateOfBirth: dob || null,
        contactPhone: phone || null,
      });
      setSessionId(res.session.id);
      setMessages(res.messages);
      setProgress({ q: res.questionIndex + 1, total: res.totalQuestions });
      setPhase('chat');
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.message);
      setErrorCode(ae.code || null);
      setPhase('error');
    } finally {
      setLoading(false);
    }
  }

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    if (!sessionId || !draft.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.sendMessage(sessionId, draft.trim());
      setMessages(res.messages);
      setDraft('');
      setProgress({ q: Math.min(res.questionIndex + 1, res.totalQuestions), total: res.totalQuestions });
      setIntakeComplete(res.intakeComplete);
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.message);
      setErrorCode(ae.code || null);
    } finally {
      setLoading(false);
    }
  }

  async function submitTriage() {
    if (!sessionId) return;
    setPhase('submitting');
    setError(null);
    setErrorCode(null);
    setLoading(true);
    try {
      const res = await api.runTriage(sessionId);
      setDoneSummary(
        `You're on the nurse queue (recommended priority ${res.assessment.priorityScore}). ${res.disclaimer}`
      );
      setPhase('done');
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.message);
      setErrorCode(ae.code || null);
      setPhase('error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="patient-shell">
      <header className="patient-top">
        <div className="brand">TriageIQ</div>
        <p className="brand-sub">Urgent care check-in · AI recommends, nurse decides</p>
      </header>

      {phase === 'checkin' && (
        <form className="checkin-form" onSubmit={startCheckin}>
          <h1>Check in</h1>
          <p className="lede">Answer a few questions on this tablet. A nurse reviews priority — not the AI alone.</p>
          <label>
            Full name
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </label>
          <label>
            Date of birth (optional)
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          </label>
          <label>
            Phone (optional)
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Starting…' : 'Begin intake'}
          </button>
        </form>
      )}

      {(phase === 'chat' || phase === 'submitting') && (
        <div className="chat-panel">
          <div className="progress" aria-live="polite">
            Question {progress.q} of {progress.total}
          </div>
          <div className="chat-log" role="log">
            {messages.map((m, i) => (
              <div key={i} className={`bubble ${m.role === 'patient' ? 'patient' : 'assistant'}`}>
                {m.content}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {error && (
            <div className="inline-error" role="alert">
              <strong>{errorCode === 'OPENAI_NOT_CONFIGURED' ? 'Configuration error' : 'Error'}</strong>
              <p>{error}</p>
            </div>
          )}

          {!intakeComplete ? (
            <form className="composer" onSubmit={sendReply}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your answer…"
                rows={3}
                disabled={loading}
                required
              />
              <button type="submit" className="btn-primary" disabled={loading || !draft.trim()}>
                {loading ? 'Sending…' : 'Send'}
              </button>
            </form>
          ) : (
            <div className="submit-bar">
              <p>Ready for nurse review. TriageIQ will recommend a priority — a licensed nurse confirms.</p>
              <button
                type="button"
                className="btn-primary"
                onClick={submitTriage}
                disabled={loading || phase === 'submitting'}
              >
                {phase === 'submitting' ? 'Submitting to triage…' : 'Submit for nurse review'}
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className="done-card">
          <h1>Check-in complete</h1>
          <p>{doneSummary}</p>
          <p className="muted">Please remain in the waiting area. Staff will call you by name.</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setPhase('checkin');
              setName('');
              setDob('');
              setPhone('');
              setSessionId(null);
              setMessages([]);
              setIntakeComplete(false);
              setDoneSummary(null);
              setError(null);
            }}
          >
            New check-in
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="done-card error-card" role="alert">
          <h1>{errorCode === 'OPENAI_NOT_CONFIGURED' ? 'Server configuration error' : 'Unable to finish'}</h1>
          <p>{error}</p>
          {errorCode === 'OPENAI_NOT_CONFIGURED' && (
            <p className="muted">
              Set <code>OPENAI_API_KEY</code> in <code>triageiq/.env</code> and restart the server. There is no silent
              mock fallback.
            </p>
          )}
          <button type="button" className="btn-secondary" onClick={() => setPhase(sessionId ? 'chat' : 'checkin')}>
            Go back
          </button>
        </div>
      )}
    </div>
  );
}
