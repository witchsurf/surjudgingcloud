import { createContext, useContext, ReactNode } from 'react';
import { useSupabaseSync } from '../hooks/useSupabaseSync';

// We need to export the return type of useSupabaseSync or define an interface
// Since useSupabaseSync returns a lot of things, let's infer it or define it.
// Ideally useSupabaseSync should export its return type.
// For now, I'll use ReturnType<typeof useSupabaseSync> if possible, but that requires the hook to be imported.

type SyncContextType = ReturnType<typeof useSupabaseSync>;

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function SyncProvider({ children }: { children: ReactNode }) {
    const syncState = useSupabaseSync();

    return (
        <SyncContext.Provider value={syncState}>
            {children}
        </SyncContext.Provider>
    );
}

export function useSync() {
    const context = useContext(SyncContext);
    if (context === undefined) {
        throw new Error('useSync must be used within a SyncProvider');
    }
    return context;
}
