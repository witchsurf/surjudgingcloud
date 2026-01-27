
import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function FixScores() {
    const [status, setStatus] = useState('Ready');
    const HEAT_ID = 'chamionnats_du_senegal_2026_open_r1_h2';

    const runFix = async () => {
        setStatus('Running...');

        // 1. CHERIF DIOP (Red) -> Winner (Total ~15)
        await setSurferScores('CHERIF DIOP', 7.5, 8.0);

        // 2. LOUIS HOUMAIRE (Blue) -> 2nd (Total ~12)
        await setSurferScores('LOUIS HOUMAIRE', 6.0, 6.0);

        // 3. PAPE NGALLA (Yellow) -> 3rd (Total ~8)
        await setSurferScores('PAPE NGALLA', 4.0, 4.0);

        // 4. White (We need to find who is White)
        // We update whoever is NOT these 3 to be 4th
        await setOthersLow(['CHERIF DIOP', 'LOUIS HOUMAIRE', 'PAPE NGALLA']);

        setStatus('Done! Please check Past Results.');
    };

    const setSurferScores = async (name: string, s1: number, s2: number) => {
        // Determine surfer ID/Name match in DB
        // We update ALL waves for matching surfer to low, then set wave 1 & 2 to specific

        console.log(`Fixing ${name}...`);

        // 1. Reset all to 0.5 to clear previous high scores
        await supabase!.from('scores')
            .update({ score: 0.5 })
            .eq('heat_id', HEAT_ID)
            .ilike('surfer', `%${name}%`);

        // 2. Set Wave 1
        // We need to find specific Row IDs... this is tricky with update.
        // Easier strategy: Delete all scores for this heat/surfer and re-insert 2 valid scores?
        // Safety: NO deletion.

        // Better Strategy: fetch rows, update first 2.
        const { data: rows } = await supabase!.from('scores')
            .select('id')
            .eq('heat_id', HEAT_ID)
            .ilike('surfer', `%${name}%`)
            .order('wave_number');

        if (!rows || rows.length === 0) {
            console.warn(`Surfer ${name} not found!`);
            return;
        }

        // Update first row
        if (rows[0]) {
            await supabase!.from('scores').update({ score: s1 }).eq('id', rows[0].id);
        }
        // Update second row
        if (rows[1]) {
            await supabase!.from('scores').update({ score: s2 }).eq('id', rows[1].id);
        }
        // Set rest low
        for (let i = 2; i < rows.length; i++) {
            await supabase!.from('scores').update({ score: 0.5 }).eq('id', rows[i].id);
        }
    };

    const setOthersLow = async (excludeNames: string[]) => {
        // Fetch all scores
        const { data: all } = await supabase!.from('scores').select('*').eq('heat_id', HEAT_ID);
        if (!all) return;

        const others = all.filter(s => !excludeNames.some(n => s.surfer.toUpperCase().includes(n)));

        for (const row of others) {
            await supabase!.from('scores').update({ score: 1.0 }).eq('id', row.id);
        }
    };

    const swapSurferR2H3 = async () => {
        setStatus('Swapping Djibril Tall -> Adama Samb...');
        const TARGET_HEAT = 'championnats_du_senegal_2026_open_r2_h3';
        const NEW_NAME = 'Adama Samb';

        try {
            // 1. Update Heat Config (UI Display)
            const { data: config } = await supabase!.from('heat_configs').select('*').eq('heat_id', TARGET_HEAT).maybeSingle();

            if (config) {
                let updated = false;
                // Update Surfers Array check loosely
                const newSurfers = (config.surfers || []).map((s: string) => {
                    if (s && s.toLowerCase().includes('djibril')) {
                        updated = true;
                        return NEW_NAME;
                    }
                    return s;
                });

                if (updated) {
                    await supabase!.from('heat_configs').update({ surfers: newSurfers }).eq('heat_id', TARGET_HEAT);
                    console.log('Updated heat_configs surfers array.');
                } else {
                    console.warn('Old surfer not found in config.surfers');
                }
            }

            // 2. Update Scores (Preserve History)
            await supabase.from('scores')
                .update({ surfer: NEW_NAME })
                .eq('heat_id', TARGET_HEAT)
                .ilike('surfer', `%djibril%`);

            setStatus('Swap Complete! Adama Samb is now in. Check Judge/Display.');
        } catch (e: any) {
            setStatus('Error: ' + e.message);
        }
    };

    const [manualHeatId, setManualHeatId] = useState('');

    const clearHeatScores = async () => {
        if (!manualHeatId) {
            setStatus('Please enter a Heat ID');
            return;
        }
        if (!window.confirm(`Are you sure you want to DELETE ALL scores for heat:\n${manualHeatId}\n\nThis cannot be undone.`)) {
            return;
        }

        setStatus(`Deleting scores for ${manualHeatId}...`);
        try {
            const { error, count } = await supabase!
                .from('scores')
                .delete({ count: 'exact' })
                .eq('heat_id', manualHeatId);

            if (error) throw error;

            setStatus(`✅ Success! Deleted ${count} scores from ${manualHeatId}.\nPlease instruct judges to REFRESH their screens.`);
        } catch (e: any) {
            setStatus('❌ Error: ' + e.message);
        }
    };

    return (
        <div className="p-8 text-black bg-white">
            <h1 className="text-2xl mb-4">Fix Tools</h1>
            <div className="flex gap-4">
                <div className="border p-4 rounded">
                    <h2 className="font-bold mb-2">Fix Rankings OPEN R1 H2</h2>
                    <button
                        onClick={runFix}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                        Apply Ranking Fix (Cherif &gt; Louis...)
                    </button>
                </div>

                <div className="border p-4 rounded">
                    <h2 className="font-bold mb-2">Swap Surfer R2 H3</h2>
                    <button
                        onClick={swapSurferR2H3}
                        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                        Swap Djibril (Out) / Adama (In)
                    </button>
                </div>
                <div className="border p-4 rounded border-red-200 bg-red-50">
                    <h2 className="font-bold mb-2 text-red-700">Danger Zone: Clear Heat Scores</h2>
                    <p className="text-sm mb-2 text-red-600">Deletes ALL scores for the specified heat. Use with caution.</p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            className="border p-2 rounded flex-1"
                            placeholder="Heat ID (e.g. championnats_...)"
                            value={manualHeatId}
                            onChange={(e) => setManualHeatId(e.target.value)}
                        />
                        <button
                            onClick={clearHeatScores}
                            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 font-bold"
                        >
                            DELETE SCORES
                        </button>
                    </div>
                </div>
            </div>
            <pre className="mt-4 p-4 bg-gray-100 whitespace-pre-wrap">{status}</pre>
        </div>
    );
}
