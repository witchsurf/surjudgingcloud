/**
 * JudgeSyncBadge
 *
 * Non-intrusive synchronization indicator for the judge tablet interface.
 * Shows the current sync status as a compact pill/badge:
 *
 * 🟢 Synced     – all scores transmitted, connection healthy
 * 🟡 Pending    – N scores waiting to be synced (with pulse animation)
 * 🔴 Error      – sync failed (tap to retry)
 * 🔵 Offline    – device is offline, scores saved locally
 */

import { useEffect, useState } from 'react';
import { useOfflineStore } from '../stores/offlineStore';

interface JudgeSyncBadgeProps {
  /** Additional pending count from localStorage-based scores (legacy path) */
  localPendingCount?: number;
  /** Compact mode for tight layouts */
  compact?: boolean;
  className?: string;
}

type SyncState = 'synced' | 'pending' | 'error' | 'offline' | 'syncing';

function JudgeSyncBadge({ localPendingCount = 0, compact = false, className = '' }: JudgeSyncBadgeProps) {
  const { isOnline, isSyncing, syncError, mutations } = useOfflineStore();
  const [showDetail, setShowDetail] = useState(false);

  const walPending = mutations.length;
  const totalPending = walPending + localPendingCount;

  const state: SyncState = (() => {
    if (!isOnline) return 'offline';
    if (syncError) return 'error';
    if (isSyncing) return 'syncing';
    if (totalPending > 0) return 'pending';
    return 'synced';
  })();

  // Auto-hide detail tooltip after a few seconds
  useEffect(() => {
    if (!showDetail) return;
    const timer = setTimeout(() => setShowDetail(false), 4000);
    return () => clearTimeout(timer);
  }, [showDetail]);

  const config: Record<SyncState, { bg: string; text: string; border: string; label: string; icon: string; pulse: boolean }> = {
    synced: {
      bg: 'rgba(34, 197, 94, 0.15)',
      text: '#16a34a',
      border: 'rgba(34, 197, 94, 0.3)',
      label: 'Sync OK',
      icon: '✓',
      pulse: false,
    },
    pending: {
      bg: 'rgba(234, 179, 8, 0.15)',
      text: '#ca8a04',
      border: 'rgba(234, 179, 8, 0.3)',
      label: `${totalPending} en attente`,
      icon: '↑',
      pulse: true,
    },
    syncing: {
      bg: 'rgba(59, 130, 246, 0.15)',
      text: '#2563eb',
      border: 'rgba(59, 130, 246, 0.3)',
      label: 'Envoi...',
      icon: '⟳',
      pulse: true,
    },
    error: {
      bg: 'rgba(239, 68, 68, 0.15)',
      text: '#dc2626',
      border: 'rgba(239, 68, 68, 0.3)',
      label: 'Erreur sync',
      icon: '!',
      pulse: false,
    },
    offline: {
      bg: 'rgba(59, 130, 246, 0.15)',
      text: '#2563eb',
      border: 'rgba(59, 130, 246, 0.3)',
      label: totalPending > 0 ? `Hors ligne (${totalPending})` : 'Hors ligne',
      icon: '⊘',
      pulse: false,
    },
  };

  const c = config[state];

  return (
    <div
      className={className}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
    >
      <button
        type="button"
        onClick={() => setShowDetail(!showDetail)}
        aria-label={`État synchronisation: ${c.label}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: compact ? '3px' : '5px',
          padding: compact ? '2px 6px' : '3px 10px',
          borderRadius: '999px',
          border: `1px solid ${c.border}`,
          backgroundColor: c.bg,
          color: c.text,
          fontSize: compact ? '11px' : '12px',
          fontWeight: 600,
          lineHeight: 1,
          cursor: 'pointer',
          outline: 'none',
          transition: 'all 150ms ease',
          animation: c.pulse ? 'judgeSyncPulse 2s ease-in-out infinite' : 'none',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: compact ? '6px' : '8px',
            height: compact ? '6px' : '8px',
            borderRadius: '50%',
            backgroundColor: c.text,
            flexShrink: 0,
          }}
        />
        {!compact && <span>{c.label}</span>}
      </button>

      {/* Detail tooltip */}
      {showDetail && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '6px',
            padding: '8px 12px',
            borderRadius: '8px',
            backgroundColor: 'white',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            fontSize: '11px',
            lineHeight: '1.5',
            color: '#334155',
            whiteSpace: 'nowrap',
            zIndex: 50,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '2px' }}>
            {c.icon} {c.label}
          </div>
          {walPending > 0 && (
            <div>WAL: {walPending} mutation(s)</div>
          )}
          {localPendingCount > 0 && (
            <div>Local: {localPendingCount} score(s)</div>
          )}
          {syncError && (
            <div style={{ color: '#dc2626', marginTop: '2px' }}>{syncError}</div>
          )}
        </div>
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes judgeSyncPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.65; }
        }
      `}</style>
    </div>
  );
}

export default JudgeSyncBadge;
