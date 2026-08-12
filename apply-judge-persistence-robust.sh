#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
HEAT="$ROOT/frontend/src/repositories/HeatRepository.ts"
ADMIN="$ROOT/frontend/src/components/AdminInterface.tsx"

python3 <<'PY'
from pathlib import Path
import shutil, sys

root = Path.cwd()
heat_path = root / "frontend/src/repositories/HeatRepository.ts"
admin_path = root / "frontend/src/components/AdminInterface.tsx"

for p in (heat_path, admin_path):
    if not p.exists():
        raise SystemExit(f"ERREUR: fichier introuvable: {p}")

heat = heat_path.read_text(encoding="utf-8")
admin = admin_path.read_text(encoding="utf-8")

# ---------- HeatRepository ----------
import_line = "import { upsertRuntimeHeatConfig } from '../api/modules/runtimeHeatConfig.api';\n"
if import_line not in heat:
    raise SystemExit("ERREUR: HeatRepository inattendu: import upsertRuntimeHeatConfig introuvable. Aucun fichier modifié.")

old_heat = """                this.ensureSupabase();
                await upsertRuntimeHeatConfig(this.supabase!, payload);
                if (assignmentPayload.length > 0) {
                    const { error: assignmentError } = await this.supabase!
                        .from('heat_judge_assignments')
                        .upsert(assignmentPayload, { onConflict: 'heat_id,station' });

                    if (assignmentError) throw assignmentError;
                }
                await this.ensureHeatEntries(normalizedHeatId, config);
"""

new_heat = """                this.ensureSupabase();

                // Proven Field persistence order: runtime config first in the
                // canonical table, then official judge assignments.
                const { error: configError } = await this.supabase!
                    .from('heat_configs')
                    .upsert(payload, { onConflict: 'heat_id' });

                if (configError) throw configError;

                if (assignmentPayload.length > 0) {
                    const { error: assignmentError } = await this.supabase!
                        .from('heat_judge_assignments')
                        .upsert(assignmentPayload, { onConflict: 'heat_id,station' });

                    if (assignmentError) throw assignmentError;

                    const expectedStations = assignmentPayload.map((row) => row.station);
                    const { data: persistedAssignments, error: verifyError } = await this.supabase!
                        .from('heat_judge_assignments')
                        .select('heat_id, event_id, station, judge_id, judge_name')
                        .eq('heat_id', normalizedHeatId)
                        .in('station', expectedStations)
                        .order('station', { ascending: true });

                    if (verifyError) throw verifyError;

                    const persistedByStation = new Map(
                        ((persistedAssignments ?? []) as HeatJudgeAssignment[]).map((row) => [
                            row.station.trim().toUpperCase(),
                            row,
                        ])
                    );

                    const missingOrMismatched = assignmentPayload.filter((expected) => {
                        const persisted = persistedByStation.get(expected.station.trim().toUpperCase());
                        if (!persisted) return true;

                        return persisted.judge_id.trim() !== expected.judge_id.trim()
                            || persisted.judge_name.trim() !== expected.judge_name.trim()
                            || (
                                expected.event_id != null
                                && Number(persisted.event_id) !== Number(expected.event_id)
                            );
                    });

                    if (missingOrMismatched.length > 0) {
                        throw new Error(
                            `Affectations juges non persistées pour ${normalizedHeatId}: ${
                                missingOrMismatched.map((row) => row.station).join(', ')
                            }`
                        );
                    }

                    logger.info('HeatRepository', 'Official judge assignments verified', {
                        heatId: normalizedHeatId,
                        stations: expectedStations,
                    });
                }
                await this.ensureHeatEntries(normalizedHeatId, config);
"""

if heat.count(old_heat) != 1:
    raise SystemExit(
        f"ERREUR: HeatRepository inattendu: bloc saveHeatConfig trouvé {heat.count(old_heat)} fois. Aucun fichier modifié."
    )

heat_new = heat.replace(import_line, "", 1).replace(old_heat, new_heat, 1)

# ---------- AdminInterface ----------
old_prop = "  onConfigSaved: (saved: boolean, podiumId?: string) => void;"
new_prop = "  onConfigSaved: (saved: boolean, podiumId?: string) => Promise<void>;"
if admin.count(old_prop) != 1:
    raise SystemExit(
        f"ERREUR: AdminInterface inattendu: signature onConfigSaved trouvée {admin.count(old_prop)} fois. Aucun fichier modifié."
    )

old_admin = """    onConfigSaved(true, normalizePodiumId(selectedPodiumId));
    // Sauvegarder immédiatement dans localStorage
    localStorage.setItem('surfJudgingConfig', JSON.stringify(config));
    localStorage.setItem('surfJudgingConfigSaved', 'true');
"""

new_admin = """    try {
      // The parent owns the authoritative persistence chain and saved state.
      await onConfigSaved(true, normalizePodiumId(selectedPodiumId));

      // Keep the recovery snapshot only after the authoritative save resolves.
      localStorage.setItem('surfJudgingConfig', JSON.stringify(config));
      setSyncError(null);
    } catch (error) {
      localStorage.setItem('surfJudgingConfigSaved', 'false');

      const message = error instanceof Error
        ? error.message
        : 'La configuration du heat n’a pas pu être sauvegardée.';

      setSyncError(message);
      console.error('❌ Sauvegarde configuration heat échouée:', error);
      alert(`Sauvegarde impossible : ${message}`);
    }
"""

if admin.count(old_admin) != 1:
    raise SystemExit(
        f"ERREUR: AdminInterface inattendu: bloc handleSaveConfig trouvé {admin.count(old_admin)} fois. Aucun fichier modifié."
    )

admin_new = admin.replace(old_prop, new_prop, 1).replace(old_admin, new_admin, 1)

# Sanity checks before any write.
checks = [
    ("HeatRepository verification", "Official judge assignments verified" in heat_new),
    ("HeatRepository direct heat_configs", ".from('heat_configs')" in heat_new),
    ("AdminInterface awaits save", "await onConfigSaved(true" in admin_new),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit("ERREUR validation interne: " + ", ".join(failed) + ". Aucun fichier modifié.")

# Backups, then atomic-ish writes.
heat_bak = heat_path.with_suffix(heat_path.suffix + ".pre-judge-robust.bak")
admin_bak = admin_path.with_suffix(admin_path.suffix + ".pre-judge-robust.bak")
shutil.copy2(heat_path, heat_bak)
shutil.copy2(admin_path, admin_bak)

heat_path.write_text(heat_new, encoding="utf-8")
admin_path.write_text(admin_new, encoding="utf-8")

print("OK: corrections appliquées.")
print(f"Backup: {heat_bak}")
print(f"Backup: {admin_bak}")
PY

echo
echo "=== BUILD FIELD ==="
npm --prefix frontend run build:field
