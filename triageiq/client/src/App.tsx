import type { ReactNode } from 'react';
import { Navigate, Route, Routes, Link, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NurseDashboard } from './pages/NurseDashboard';
import { PatientIntake } from './pages/PatientIntake';

function AppChrome({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const isPatient = loc.pathname.startsWith('/patient');
  return (
    <div className={`app ${isPatient ? 'mode-patient' : 'mode-nurse'}`}>
      {!isPatient && (
        <nav className="app-nav">
          <Link to="/patient">Patient intake</Link>
          <Link to="/nurse" className={loc.pathname.startsWith('/nurse') ? 'active' : ''}>
            Nurse dashboard
          </Link>
        </nav>
      )}
      {isPatient && (
        <div className="patient-nav-escape">
          <Link to="/nurse">Staff login →</Link>
        </div>
      )}
      {children}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary label="app">
      <AppChrome>
        <Routes>
          <Route path="/" element={<Navigate to="/patient" replace />} />
          <Route
            path="/patient"
            element={
              <ErrorBoundary label="patient">
                <PatientIntake />
              </ErrorBoundary>
            }
          />
          <Route
            path="/nurse"
            element={
              <ErrorBoundary label="nurse">
                <NurseDashboard />
              </ErrorBoundary>
            }
          />
          <Route path="*" element={<Navigate to="/patient" replace />} />
        </Routes>
      </AppChrome>
    </ErrorBoundary>
  );
}
