import type { ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { getDeploymentMode, type DeploymentMode } from '../domain/deploymentMode';
import { parseCanonicalEventId } from '../domain/eventWorkflow';

interface FieldEventContextGuardProps {
  children: ReactNode;
  mode?: DeploymentMode;
}

export const resolveFieldEventContextRedirect = (
  mode: DeploymentMode,
  eventId: string | null,
): '/my-events' | null => (
  mode === 'field' && !parseCanonicalEventId(eventId) ? '/my-events' : null
);

export default function FieldEventContextGuard({
  children,
  mode = getDeploymentMode(),
}: FieldEventContextGuardProps) {
  const [searchParams] = useSearchParams();
  const rawEventId = searchParams.get('eventId') || searchParams.get('event');
  const redirect = resolveFieldEventContextRedirect(mode, rawEventId);

  if (redirect) {
    return <Navigate to={redirect} replace />;
  }

  return children;
}
