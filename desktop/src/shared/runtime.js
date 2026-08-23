import crypto from 'node:crypto';

export const OWNERSHIP_LABELS = Object.freeze({
  runtime: 'com.surfjudging.runtime',
  version: 'com.surfjudging.runtime.version',
  service: 'com.surfjudging.service',
  release: 'com.surfjudging.release',
  dataRoot: 'com.surfjudging.data-root'
});

export const BOOTSTRAP_STATES = Object.freeze([
  'CHECK_PLATFORM','CHECK_ARCH','CHECK_RUNTIME','CHECK_MANIFEST','CHECK_IMAGES',
  'CHECK_DATA_ROOT','CHECK_EXISTING_FIELD','COMPATIBILITY','READY_TO_START',
  'RUNTIME_MISSING','IMAGE_MISSING','INCOMPATIBLE','EXISTING_FIELD_FOUND',
  'MIGRATION_REQUIRED','ERROR'
]);

const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
export const stableSerialize = stable;
export function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex'); }
export function digestFiles(files = []) { return sha256(files.slice().sort((a,b)=>a.path.localeCompare(b.path)).map(f=>({path:f.path,content:f.content}))); }

export function classifyContainerOwnership(container) {
  const labels = container?.labels || {};
  if (labels[OWNERSHIP_LABELS.runtime] === 'true' && labels[OWNERSHIP_LABELS.service]) return 'OWNED_MANAGED_RUNTIME';
  if (labels['com.docker.compose.project'] === 'infra' && (container.networks || []).includes('infra_surfjudging_network')) return 'LEGACY_CERTIFIED_RUNTIME';
  if (labels['com.docker.compose.project']?.startsWith('supabase')) return 'DEVELOPMENT_BACKEND';
  if (!Object.keys(labels).length) return 'UNKNOWN';
  return 'UNRELATED';
}
export function listOwnedServices(containers = []) { return containers.filter(c => classifyContainerOwnership(c) === 'OWNED_MANAGED_RUNTIME'); }

export function validateRuntimeManifest(m) {
  const reasons=[]; const required=['runtimeVersion','composeVersion','frontend','services','schema'];
  if (!m || required.some(k=>!m[k])) reasons.push('manifest incomplete');
  if (m && m.integrity && m.integrity.sha256 !== sha256({...m, integrity: undefined})) reasons.push('manifest corruption');
  return { valid: reasons.length===0, reasons };
}
export function evaluateCompatibility({desktopVersion,platform,architecture,runtimeManifest,frontendManifest,actualSchema,observedServices={}}={}) {
  const reasons=[]; const p=['darwin','win32'].includes(platform), a=['arm64','x64'].includes(architecture);
  if(!p) reasons.push(`unsupported platform: ${platform}`); if(!a) reasons.push(`unsupported architecture: ${architecture}`);
  const v=validateRuntimeManifest(runtimeManifest); reasons.push(...v.reasons);
  if(frontendManifest && runtimeManifest?.frontend){ if(frontendManifest.releaseId!==runtimeManifest.frontend.releaseId) reasons.push('wrong frontend release'); if(frontendManifest.sourceRevision!==runtimeManifest.frontend.sourceRevision) reasons.push('wrong frontend revision'); }
  if(runtimeManifest?.schema?.expectedVersion && actualSchema && runtimeManifest.schema.expectedVersion!==actualSchema) reasons.push('wrong schema');
  for(const [name, spec] of Object.entries(runtimeManifest?.services||{})){ const got=observedServices[name]; if(!got) reasons.push(`missing service: ${name}`); else if(spec.image && got.image!==spec.image) reasons.push(`wrong service image: ${name}`); }
  const status = reasons.length ? 'INCOMPATIBLE' : 'COMPATIBLE';
  return {status, ready: status==='COMPATIBLE', reasons, legacy: Boolean(runtimeManifest?.legacyCertified)};
}
export function bootstrapStep(input = {}) {
  if (!input.platformOk) return {state:'CHECK_PLATFORM', next:'INCOMPATIBLE', reasons:['unsupported platform']};
  if (!input.archOk) return {state:'CHECK_ARCH', next:'INCOMPATIBLE', reasons:['unsupported architecture']};
  if (!input.runtimeAvailable) return {state:'CHECK_RUNTIME', next:'RUNTIME_MISSING', reasons:['runtime unavailable']};
  if (!input.manifestValid) return {state:'CHECK_MANIFEST', next:'INCOMPATIBLE', reasons:['manifest invalid']};
  if (!input.imagesValid) return {state:'CHECK_IMAGES', next:'IMAGE_MISSING', reasons:['required image missing']};
  if (input.existingField) return {state:'CHECK_EXISTING_FIELD', next:'EXISTING_FIELD_FOUND', reasons:['existing Field detected; adoption required']};
  return {state:'COMPATIBILITY', next: input.compatible ? 'READY_TO_START' : 'INCOMPATIBLE', reasons: input.reasons||[]};
}
export function planRepair(observed={}, expected={}) { const actions=[]; for(const k of Object.keys(expected.services||{})){ if(!observed.services?.[k]) actions.push({type:'missing-service',service:k}); else if(observed.services[k].image!==expected.services[k].image) actions.push({type:'wrong-image',service:k}); } return {dryRun:true, actions}; }

export function runtimeManifest({frontendRelease,sourceRevision,expectedSchema,services,migrationsDigest,runtimeDefinitionDigest,desktopVersion='0.3.0-p3.5'}={}) {
  const manifest={runtimeVersion:'0.1.0',composeVersion:'3.8',desktopVersion,frontend:{releaseId:frontendRelease,sourceRevision},services, schema:{expectedVersion:expectedSchema,migrationsDigest},runtimeDefinitionDigest};
  return {...manifest, integrity:{algorithm:'sha256',sha256:sha256(manifest)}};
}
