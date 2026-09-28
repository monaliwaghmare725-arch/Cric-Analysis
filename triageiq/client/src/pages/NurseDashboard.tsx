import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type QueueItem } from '../api';

const DISPOSITIONS = [
  { value: 'confirm_priority', label: 'Confirm AI priority' },
  { value: 'override_priority', label: 'Override priority' },
  { value: 'send_to_room', label: 'Send to room' },
  { value: 'discharge_advice', label: 'Discharge / advice' },
  { value: 'transfer_ed', label: 'Transfer / ED' },
];

export function NurseDashboard() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [escalations, setEscalations] = useState(0);
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [healthNote, setHealthNote] = useState<string | null>(null);
  const [nurseName, setNurseName] = useState('Nurse');
  const [notes, setNotes] = useState('');
  const [disposition, setDisposition] = useState('confirm_priority');
  const [overridePriority, setOverridePriority] = useState(3);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [queue, health] = await Promise.all([api.getQueue(), api.health()]);
      setItems(queue.items);
      setEscalations(queue.escalations);
      setHealthNote(health.openaiNote);
      setError(null);
      setSelected((prev) => {
        if (!prev) return queue.items[0] ?? null;
        return queue.items.find((i) => i.id === prev.id) ?? queue.items[0] ?? null;
      });
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function saveDisposition() {
    if (!selected) return;
    setSaving(true);
    try {
      await api.setDisposition(selected.id, {
        disposition,
        nurseNotes: notes || null,
        nurseName,
        confirmedPriority:
          disposition === 'override_priority' ? overridePriority : selected.priorityScore,
      });
      setNotes('');
      await refresh();
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="nurse-shell">
      <header className="nurse-top">
        <div>
          <div className="brand">TriageIQ</div>
          <p className="brand-sub">Nurse queue · sorted by AI priority (not arrival)</p>
        </div>
        <div className="nurse-meta">
          <button type="button" className="btn-secondary" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </header>

      {escalations > 0 && (
        <div className="escalation-banner" role="alert">
          <strong>Red-flag escalation:</strong> {escalations} patient
          {escalations === 1 ? '' : 's'} need immediate nurse attention.
        </div>
      )}

      {healthNote && !healthNote.includes('present') && (
        <div className="config-banner" role="status">
          {healthNote}
        </div>
      )}

      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="muted pad">Loading queue…</p>
      ) : (
        <div className="nurse-layout">
          <aside className="queue-list" aria-label="Priority queue">
            {items.length === 0 && <p className="muted pad">No patients in queue yet.</p>}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`queue-row ${selected?.id === item.id ? 'active' : ''} ${
                  item.hasRedFlags ? 'red-flag' : ''
                } ${item.status === 'dispositioned' ? 'done' : ''}`}
                onClick={() => setSelected(item)}
              >
                <span className={`prio p${item.priorityScore}`}>P{item.priorityScore}</span>
                <span className="q-main">
                  <span className="q-name">{item.patientName}</span>
                  <span className="q-cc">{item.structuredIntake.chiefComplaint || '—'}</span>
                </span>
                {item.hasRedFlags && <span className="flag-chip">RED FLAG</span>}
              </button>
            ))}
          </aside>

          <section className="detail-panel">
            {!selected ? (
              <p className="muted">Select a patient to review structured intake.</p>
            ) : (
              <>
                <div className="detail-head">
                  <h1>{selected.patientName}</h1>
                  <span className={`prio-lg p${selected.priorityScore}`}>
                    Priority {selected.priorityScore} · {selected.priorityLabel}
                  </span>
                </div>

                {selected.hasRedFlags && (
                  <div className="red-flag-box" role="alert">
                    <h2>Escalation alerts</h2>
                    <ul>
                      {selected.redFlags.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="detail-grid">
                  <article>
                    <h2>AI rationale (recommendation only)</h2>
                    <p>{selected.rationale}</p>
                    {selected.recommendedActions?.length > 0 && (
                      <>
                        <h3>Suggested actions</h3>
                        <ul>
                          {selected.recommendedActions.map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </article>
                  <article>
                    <h2>Structured intake</h2>
                    <dl className="intake-dl">
                      <dt>Chief complaint</dt>
                      <dd>{selected.structuredIntake.chiefComplaint || '—'}</dd>
                      <dt>Summary</dt>
                      <dd>{selected.structuredIntake.symptomSummary || '—'}</dd>
                      <dt>Onset</dt>
                      <dd>{selected.structuredIntake.onset || '—'}</dd>
                      <dt>Severity</dt>
                      <dd>{selected.structuredIntake.severity || '—'}</dd>
                      <dt>Associated</dt>
                      <dd>
                        {(selected.structuredIntake.associatedSymptoms || []).join(', ') || '—'}
                      </dd>
                      <dt>History</dt>
                      <dd>{selected.structuredIntake.relevantHistory || '—'}</dd>
                      <dt>Meds</dt>
                      <dd>{selected.structuredIntake.medications || '—'}</dd>
                      <dt>Allergies</dt>
                      <dd>{selected.structuredIntake.allergies || '—'}</dd>
                    </dl>
                  </article>
                </div>

                {selected.status === 'dispositioned' && selected.disposition ? (
                  <div className="disposition-done">
                    Disposition recorded: <strong>{selected.disposition.disposition}</strong>
                    {selected.disposition.nurseName ? ` by ${selected.disposition.nurseName}` : ''}
                    {selected.disposition.nurseNotes ? ` — ${selected.disposition.nurseNotes}` : ''}
                  </div>
                ) : (
                  <div className="disposition-form">
                    <h2>Nurse disposition</h2>
                    <label>
                      Your name
                      <input value={nurseName} onChange={(e) => setNurseName(e.target.value)} />
                    </label>
                    <label>
                      Disposition
                      <select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
                        {DISPOSITIONS.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {disposition === 'override_priority' && (
                      <label>
                        Confirmed priority
                        <select
                          value={overridePriority}
                          onChange={(e) => setOverridePriority(Number(e.target.value))}
                        >
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      Notes
                      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                    </label>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={saving || !nurseName.trim()}
                      onClick={() => void saveDisposition()}
                    >
                      {saving ? 'Saving…' : 'Record disposition'}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
