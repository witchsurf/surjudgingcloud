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

    useEffect(() => {
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
                    // Not authenticated - redirect to login
                    console.warn('⚠️ Authentication required. Redirecting to /my-events...');
                    navigate('/my-events', { replace: true });
                    return;
                }

                setIsAuthenticated(!!session);
            } catch (error) {
                console.error('Auth check failed:', error);
                if (requireAuth) {
                    navigate('/my-events', { replace: true });
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
                console.warn('⚠️ Session expired. Redirecting to /my-events...');
                navigate('/my-events', { replace: true });
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
        return null; // Will redirect via useEffect
    }

    return <>{children}</>;
}
