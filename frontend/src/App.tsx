import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import * as Sentry from '@sentry/react';
import { isLocalSupabaseMode } from './lib/supabase';

// Initialize Sentry (only in production with DSN configured)
if (import.meta.env.VITE_SENTRY_DSN && !import.meta.env.DEV && !isLocalSupabaseMode()) {
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
import FieldEventContextGuard from './components/FieldEventContextGuard';

import OverlayPage from './pages/OverlayPage';
import LiveOverlayPage from './pages/LiveOverlayPage';

const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const JudgeLayout = lazy(() => import('./layouts/JudgeLayout'));
const PublicLayout = lazy(() => import('./layouts/PublicLayout'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const JudgePage = lazy(() => import('./pages/JudgePage'));
const PriorityJudgePage = lazy(() => import('./pages/PriorityJudgePage'));
const DisplayPage = lazy(() => import('./pages/DisplayPage'));
const MyEventsPage = lazy(() => import('./pages/MyEvents'));
const LandingPage = lazy(() => import('./components/LandingPage'));
const CreateEvent = lazy(() => import('./components/CreateEvent'));
const PaymentPage = lazy(() => import('./components/PaymentPage'));
const ParticipantsPage = lazy(() => import('./components/ParticipantsPage'));
const GenerateHeatsPage = lazy(() => import('./components/GenerateHeatsPage'));
const FixScores = lazy(() => import('./pages/FixScores'));

const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isPublicDisplayHostname = hostname === 'display.surfjudging.cloud';

function App() {
    return (
        <SyncProvider>
            <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
                <Router>
                    <Routes>
                        <Route path="/overlay" element={<OverlayPage />} />
                        <Route path="/live-overlay" element={<LiveOverlayPage />} />
                        <Route path="/fix" element={<FixScores />} />
                        <Route
                            path="/"
                            element={isPublicDisplayHostname ? <Navigate to="/display" replace /> : <LandingPage />}
                        />
                        <Route path="/create-event" element={<CreateEvent />} />
                        <Route path="/login" element={<MyEventsPage />} />
                        <Route path="/my-events" element={<MyEventsPage />} />
                        <Route path="/payment" element={<PaymentPage />} />
                        <Route path="/participants" element={
                            <FieldEventContextGuard>
                                <ParticipantsPage />
                            </FieldEventContextGuard>
                        } />
                        <Route path="/generate-heats" element={<GenerateHeatsPage />} />

                        {/* Admin Routes - REQUIRE AUTHENTICATION */}
                        <Route path="/admin" element={
                            <FieldEventContextGuard>
                                <AuthGuard requireAuth={true}>
                                    <AdminLayout />
                                </AuthGuard>
                            </FieldEventContextGuard>
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

                        <Route path="/priority" element={<JudgeLayout />}>
                            <Route index element={<PriorityJudgePage />} />
                        </Route>

                        <Route path="/priority-judge" element={<JudgeLayout />}>
                            <Route index element={<PriorityJudgePage />} />
                        </Route>

                        {/* Public Display Routes */}
                        <Route path="/display" element={<PublicLayout />}>
                            <Route index element={<DisplayPage />} />
                        </Route>

                        {/* Fallback */}
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </Router>
            </Suspense>
        </SyncProvider>
    );
}

// Wrap with Sentry Error Boundary
export default Sentry.withErrorBoundary(App, {
    fallback: ({ error }) => (
        <div style={{ padding: '40px', textAlign: 'center', minHeight: '100vh', background: '#ffffff', color: '#111827' }}>
            <h1>⚠️ Une erreur est survenue</h1>
            <p>L'équipe a été notifiée. Veuillez rafraîchir la page.</p>
            {import.meta.env.DEV && (
                <details open style={{ marginTop: '20px', textAlign: 'left', border: '2px solid #dc2626', borderRadius: '8px', padding: '16px' }}>
                    <summary>Détails techniques temporaires</summary>
                    <pre style={{ background: '#f3f4f6', color: '#991b1b', padding: '10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {error instanceof Error
                            ? `${error.name}: ${error.message}\n${(error.stack || '').split('\n').slice(0, 8).join('\n')}`
                            : String(error)}
                    </pre>
                </details>
            )}
        </div>
    ),
    showDialog: false,
});
