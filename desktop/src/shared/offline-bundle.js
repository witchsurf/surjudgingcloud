import crypto from 'node:crypto';

const stable = (v) => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v==='object' ? `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v);
export function payloadDigest(payload) { return crypto.createHash('sha256').update(typeof payload==='string'?payload:stable(payload)).digest('hex'); }
export function createBundleManifest({desktopVersion,platform='darwin',architecture,runtimeVersion,frontend,images,runtimeDefinitionDigest,migrationsDigest,expectedSchema,payloads=[]}) {
  const files=payloads.slice().sort((a,b)=>a.path.localeCompare(b.path)).map(p=>({path:p.path,size:p.size,digest:p.digest}));
  const manifest={bundleVersion:'0.1.0',desktopVersion,platform,architecture,runtimeVersion,frontend,images,runtimeDefinitionDigest,migrationsDigest,expectedSchema,files,signature:{algorithm:'sha256',keyId:null,value:null}};
  return {...manifest, bundleDigest:payloadDigest(manifest)};
}
export function verifyBundleManifest(manifest, payloads={}) { const reasons=[]; if(!manifest?.bundleDigest) reasons.push('missing bundle digest'); else { const copy={...manifest}; delete copy.bundleDigest; if(payloadDigest(copy)!==manifest.bundleDigest) reasons.push('bundle manifest checksum mismatch'); } for(const f of manifest?.files||[]){ if(!payloads[f.path]) reasons.push(`missing payload: ${f.path}`); else if(payloads[f.path].digest!==f.digest) reasons.push(`payload checksum mismatch: ${f.path}`); } return {ok:reasons.length===0,reasons}; }
export function requiredServices() { return ['frontend','postgres','rest','realtime','auth','kong','storage']; }
export function excludedServices() { return ['studio','meta','analytics','vector','edge-runtime','mailpit']; }
export function offlineFirstRun({internet=false,preloadedBundle=false,repo=false,npm=false,imagePulls=0}={}) { const reasons=[]; if(internet) reasons.push('public internet available (not a proof of offline operation)'); if(!preloadedBundle) reasons.push('offline bundle missing'); if(repo||npm||imagePulls) reasons.push('external dependency used'); return {ready:reasons.length===0,reasons}; }
