import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Providers
import { AuthProvider } from './contexts/AuthContext';
import { ConfigProvider } from './contexts/ConfigContext';
import { JudgingProvider } from './contexts/JudgingContext';
import { SyncProvider } from './contexts/SyncContext';

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

export default function App() {
    return (
        <AuthProvider>
            <ConfigProvider>
                <JudgingProvider>
                    <SyncProvider>
                        <Router>
                            <Routes>
                                <Route path="/" element={<LandingPage />} />
                                <Route path="/create-event" element={<CreateEvent />} />
                                <Route path="/my-events" element={<MyEventsPage />} />
                                <Route path="/payment" element={<PaymentPage />} />
                                <Route path="/participants" element={<ParticipantsPage />} />
                                <Route path="/generate-heats" element={<GenerateHeatsPage />} />

                                {/* Admin Routes */}
                                <Route path="/admin" element={<AdminLayout />}>
                                    <Route index element={<AdminPage />} />
                                </Route>

                                {/* Legacy route for chief-judge to redirect to admin */}
                                <Route path="/chief-judge" element={<Navigate to="/admin" replace />} />

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
                </JudgingProvider>
            </ConfigProvider>
        </AuthProvider>
    );
}
