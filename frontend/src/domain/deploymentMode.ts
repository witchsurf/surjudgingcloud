export type DeploymentMode = 'cloud' | 'field';

export const parseDeploymentMode = (value: unknown): DeploymentMode | null =>
  value === 'cloud' || value === 'field' ? value : null;

export const requireDeploymentMode = (value: unknown): DeploymentMode => {
  const mode = parseDeploymentMode(value);
  if (!mode) {
    throw new Error('VITE_DEPLOYMENT_MODE doit être explicitement défini à "cloud" ou "field".');
  }
  return mode;
};

export const getDeploymentMode = (): DeploymentMode =>
  requireDeploymentMode(import.meta.env.VITE_DEPLOYMENT_MODE);

export const allowsCloudAuth = (mode: DeploymentMode): boolean => mode === 'cloud';
export const allowsPayment = (mode: DeploymentMode): boolean => mode === 'cloud';
export const allowsCloudSync = (mode: DeploymentMode): boolean => mode === 'cloud';
