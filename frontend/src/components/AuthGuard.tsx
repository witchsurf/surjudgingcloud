import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface AuthGuardProps {
    children: React.ReactNode;
    requireAuth?: boolean;
}

export function AuthGuard({ children, requireAuth = true }: AuthGuardProps) {
    const navigate = useNavigate();
    const [isChecking, setIsChecking] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [offlinePinAvailable, setOfflinePinAvailable] = useState(false);
    const [offlinePinInput, setOfflinePinInput] = useState('');
    const [offlinePinError, setOfflinePinError] = useState<string | null>(null);

    const getOfflinePin = () => {
        const envPin = (import.meta as { env?: Record<string, string> }).env?.VITE_ADMIN_OFFLINE_PIN;
        if (typeof window !== 'undefined') {
            try {
                return window.localStorage.getItem('admin_offline_pin') || envPin || '';
            } catch {
                return envPin || '';
            }
        }
        return envPin || '';
    };

    const hasOfflineAuth = () => {
        if (typeof window === 'undefined') return false;
        try {
            return window.sessionStorage.getItem('admin_offline_auth') === 'true';
        } catch {
            return false;
        }
    };

    const setOfflineAuth = () => {
        if (typeof window === 'undefined') return;
        try {
            window.sessionStorage.setItem('admin_offline_auth', 'true');
        } catch {
            // ignore
        }
    };

    useEffect(() => {
        setOfflinePinAvailable(Boolean(getOfflinePin()));

        if (!isSupabaseConfigured() || !supabase) {
            // Supabase not configured - allow access in offline mode
            setIsAuthenticated(true);
            setIsChecking(false);
            return;
        }

        // Check authentication
        const checkAuth = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();

                if (requireAuth && !session) {
                    if (hasOfflineAuth()) {
                        setIsAuthenticated(true);
                        return;
                    }
                    if (getOfflinePin()) {
                        setIsAuthenticated(false);
                        return;
                    }
                    // Not authenticated - redirect to login
                    console.warn('⚠️ Authentication required. Redirecting to /my-events...');
                    navigate('/my-events', { replace: true });
                    return;
                }

                setIsAuthenticated(!!session);
            } catch (error) {
                console.error('Auth check failed:', error);
                if (requireAuth) {
                    if (!getOfflinePin()) {
                        navigate('/my-events', { replace: true });
                    }
                }
            } finally {
                setIsChecking(false);
            }
        };

        checkAuth();

        // Subscribe to auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            setIsAuthenticated(!!session);

            if (requireAuth && !session) {
                if (!getOfflinePin()) {
                    console.warn('⚠️ Session expired. Redirecting to /my-events...');
                    navigate('/my-events', { replace: true });
                }
            }
        });

        return () => {
            subscription.unsubscribe();
        };
    }, [navigate, requireAuth]);

    if (isChecking) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
                <div className="text-white text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    <p>Vérification de l'authentification...</p>
                </div>
            </div>
        );
    }

    if (requireAuth && !isAuthenticated) {
        if (offlinePinAvailable) {
            return (
                <div className="min-h-screen bg-gray-900 flex items-center justify-center">
                    <div className="bg-white rounded-lg shadow p-6 w-full max-w-sm">
                        <h2 className="text-lg font-semibold text-gray-900 mb-2">Accès Admin Hors‑ligne</h2>
                        <p className="text-sm text-gray-600 mb-4">
                            Entrez le code admin local pour accéder à l’interface.
                        </p>
                        <input
                            type="password"
                            value={offlinePinInput}
                            onChange={(e) => {
                                setOfflinePinInput(e.target.value);
                                setOfflinePinError(null);
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Code admin"
                        />
                        {offlinePinError && (
                            <div className="text-sm text-red-600 mt-2">{offlinePinError}</div>
                        )}
                        <div className="mt-4 flex items-center gap-2">
                            <button
                                className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                                onClick={() => {
                                    const expected = getOfflinePin();
                                    if (offlinePinInput.trim() && offlinePinInput.trim() === expected) {
                                        setOfflineAuth();
                                        setIsAuthenticated(true);
                                        return;
                                    }
                                    setOfflinePinError('Code invalide.');
                                }}
                            >
                                Valider
                            </button>
                            <button
                                className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
                                onClick={() => navigate('/my-events')}
                            >
                                Connexion email
                            </button>
                        </div>
                    </div>
                </div>
            );
        }
        return null; // Will redirect via useEffect
    }

    return <>{children}</>;
}
