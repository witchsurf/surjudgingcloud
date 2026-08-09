import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getDeploymentMode } from '../domain/deploymentMode';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { OfflineAuthWrapper } from './OfflineAuthWrapper';

interface DeploymentAuthWrapperProps {
  children: (user: User | null, isFieldMode: boolean) => React.ReactNode;
}

function CloudAuthBoundary({ children }: DeploymentAuthWrapperProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    let mounted = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUser(data.user ?? null);
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setUser(session?.user ?? null);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">Initialisation…</div>;
  }
  return <>{children(user, false)}</>;
}

export function DeploymentAuthWrapper(props: DeploymentAuthWrapperProps) {
  return getDeploymentMode() === 'cloud'
    ? <CloudAuthBoundary {...props} />
    : <OfflineAuthWrapper>{props.children}</OfflineAuthWrapper>;
}
