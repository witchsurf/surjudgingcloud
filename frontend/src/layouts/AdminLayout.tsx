import { Outlet, Link, useLocation } from 'react-router-dom';
import { Settings, Waves, AlertTriangle } from 'lucide-react';
import SyncStatus from '../components/SyncStatus';
import { useRealtimeSync } from '../hooks/useRealtimeSync';

import { useSync } from '../contexts/SyncContext';

// Note: SyncStatus props are currently passed from App.tsx. 
// We might need a SyncContext or similar if we want to avoid prop drilling here.
// For now, I'll assume we might need to pass props or use a hook.
// Actually, useSupabaseSync is a hook, so we can use it here!

export default function AdminLayout() {
    const location = useLocation();
    const { isConnected, lastUpdate, error: realtimeError } = useRealtimeSync();
    const { syncStatus: syncState, syncPendingScores } = useSync();
    // useSupabaseSync manages its own state, but we need the *global* sync status.
    // If we use useSupabaseSync here, it will be a *new* instance.
    // We should probably create a SyncContext or lift useSupabaseSync to a provider.
    // For this refactor, let's assume we will wrap App in a SyncProvider or similar.
    // OR, we can just use the hook here if it relies on global state (localStorage).
    // But the "pendingScores" count is local state in the hook.

    // DECISION: I will create a SyncContext to share the sync status across the app.
    // This is better than prop drilling or multiple hook instances.

    return (
        <div className="min-h-screen bg-gray-50">
            <nav className="bg-white border-b border-gray-200 shadow-sm">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="flex justify-between items-center h-16">
                        <div className="flex items-center space-x-3">
                            <Waves className="w-8 h-8 text-blue-600" />
                            <h1 className="text-xl font-bold text-gray-900">Surf Judging System</h1>
                        </div>

                        <div className="flex space-x-1">
                            <Link
                                to="/admin"
                                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center space-x-2 ${location.pathname === '/admin'
                                    ? 'bg-blue-600 text-white'
                                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                                    }`}
                            >
                                <Settings className="w-4 h-4" />
                                <span>Administration</span>
                            </Link>
                        </div>
                    </div>
                </div>
            </nav>

            <div className="max-w-7xl mx-auto px-4 py-2">
                <SyncStatus
                    isOnline={syncState.isOnline}
                    supabaseEnabled={syncState.supabaseEnabled}
                    lastSync={syncState.lastSync}
                    pendingScores={syncState.pendingScores}
                    syncError={syncState.syncError}
                    onManualSync={syncPendingScores}
                    realtimeConnected={isConnected}
                    realtimeLastUpdate={lastUpdate}
                />
            </div>

            <main className="max-w-7xl mx-auto px-4 py-6">
                <Outlet />
            </main>

            {realtimeError && (
                <div className="fixed bottom-4 right-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded max-w-md">
                    <div className="flex items-center">
                        <AlertTriangle className="w-5 h-5 mr-2" />
                        <div>
                            <strong>Erreur temps réel:</strong>
                            <p className="text-sm">{realtimeError}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
