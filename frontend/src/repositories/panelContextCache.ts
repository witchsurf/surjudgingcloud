import {
  clearPanelContextCache,
  getCachedPanelContexts,
} from '../domain/scoring/panelContextCache';
import { panelRepository } from './PanelRepository';
import type { RuntimePanelSnapshots } from './contracts';

const repositoryLoader = (heatIds: readonly string[], runtimeSnapshots?: RuntimePanelSnapshots) =>
  panelRepository.resolveContexts(heatIds, runtimeSnapshots);

export const getRepositoryPanelContexts = (
  heatIds: readonly string[],
  runtimeSnapshots?: RuntimePanelSnapshots,
) => getCachedPanelContexts(heatIds, runtimeSnapshots, repositoryLoader);

export { clearPanelContextCache };
