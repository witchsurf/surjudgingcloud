import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import * as Sentry from '@sentry/react';

// Initialize Sentry (only in production with DSN configured)
if (import.meta.env.VITE_SENTRY_DSN && !import.meta.env.DEV) {
    Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration({
                maskAllText: false,
                blockAllMedia: false,
            }),
        ],
        // Performance Monitoring
        tracesSampleRate: 0.1, // 10% of transactions for performance
        // Session Replay
        replaysSessionSampleRate: 0.1, // 10% of sessions
        replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors
    });
}

// Providers - Only SyncProvider needed now (Zustand handles Auth, Config, Judging)
import { SyncProvider } from './contexts/SyncContext';
import { AuthGuard } from './components/AuthGuard';

// Layouts
import AdminLayout from './layouts/AdminLayout';
import JudgeLayout from './layouts/JudgeLayout';
import PublicLayout from './layouts/PublicLayout';

// Pages
import AdminPage from './pages/AdminPage';
import JudgePage from './pages/JudgePage';
import DisplayPage from './pages/DisplayPage';
import MyEventsPage from './pages/MyEvents';
import LandingPage from './components/LandingPage';
import CreateEvent from './components/CreateEvent';
import PaymentPage from './components/PaymentPage';
import ParticipantsPage from './components/ParticipantsPage';
import GenerateHeatsPage from './components/GenerateHeatsPage';
import FixScores from './pages/FixScores';

function App() {
    return (
        <SyncProvider>
            <Router>
                <Routes>
                    <Route path="/fix" element={<FixScores />} />
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/create-event" element={<CreateEvent />} />
                    <Route path="/login" element={<MyEventsPage />} />
                    <Route path="/my-events" element={<MyEventsPage />} />
                    <Route path="/payment" element={<PaymentPage />} />
                    <Route path="/participants" element={<ParticipantsPage />} />
                    <Route path="/generate-heats" element={<GenerateHeatsPage />} />

                    {/* Admin Routes - REQUIRE AUTHENTICATION */}
                    <Route path="/admin" element={
                        <AuthGuard requireAuth={true}>
                            <AdminLayout />
                        </AuthGuard>
                    }>
                        <Route index element={<AdminPage />} />
                    </Route>

                    {/* Legacy route for chief-judge to redirect to admin */}
                    <Route path="/chief-judge" element={
                        <AuthGuard requireAuth={true}>
                            <Navigate to="/admin" replace />
                        </AuthGuard>
                    } />

                    {/* Judge Routes */}
                    <Route path="/judge" element={<JudgeLayout />}>
                        <Route index element={<JudgePage />} />
                    </Route>

                    {/* Public Display Routes */}
                    <Route path="/display" element={<PublicLayout />}>
                        <Route index element={<DisplayPage />} />
                    </Route>

                    {/* Fallback */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </Router>
        </SyncProvider>
    );
}

// Wrap with Sentry Error Boundary
export default Sentry.withErrorBoundary(App, {
    fallback: ({ error }) => (
        <div style={{ padding: '40px', textAlign: 'center' }}>
            <h1>⚠️ Une erreur est survenue</h1>
            <p>L'équipe a été notifiée. Veuillez rafraîchir la page.</p>
            {import.meta.env.DEV && (
                <details style={{ marginTop: '20px', textAlign: 'left' }}>
                    <summary>Détails de l'erreur (dev only)</summary>
                    <pre style={{ background: '#f5f5f5', padding: '10px' }}>
                        {error?.toString()}
                    </pre>
                </details>
            )}
        </div>
    ),
    showDialog: false,
});
