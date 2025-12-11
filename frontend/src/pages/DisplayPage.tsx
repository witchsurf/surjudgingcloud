import { useEffect } from 'react';
import ScoreDisplay from '../components/ScoreDisplay';
import { useConfig } from '../contexts/ConfigContext';
import { useJudging } from '../contexts/JudgingContext';
import { fetchEventConfigSnapshot } from '../api/supabaseClient';
import { supabase } from '../lib/supabase';

export default function DisplayPage() {
    const { config, configSaved, activeEventId, setConfig } = useConfig();
    const { scores, timer, heatStatus } = useJudging();

    // Subscribe to config changes for cross-device sync
    useEffect(() => {
        if (!activeEventId) return;

        console.log('📡 Display: subscribing to event config updates for event:', activeEventId);

        const channel = supabase
            ?.channel(`event-config-${activeEventId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'event_last_config',
                filter: `event_id=eq.${activeEventId}`
            }, async (payload) => {
                console.log('📡 Display: received config update:', payload);
                try {
                    const snapshot = await fetchEventConfigSnapshot(activeEventId);
                    if (snapshot) {
                        // Build config from snapshot - reuse logic from ConfigContext
                        const newConfig = {
                            competition: snapshot.event_name || '',
                            division: snapshot.division || 'OPEN',
                            round: snapshot.round || 1,
                            heatId: snapshot.heat_number || 1,
                            judges: snapshot.judges?.map(j => j.id) || [],
                            judgeNames: snapshot.judges?.reduce((acc, j) => ({ ...acc, [j.id]: j.name || j.id }), {}) || {},
                            surfers: snapshot.surfers || config.surfers,
                            surferNames: snapshot.surferNames || {},
                            surferCountries: snapshot.surferCountries || {},
                            surfersPerHeat: snapshot.surfers?.length || 4,
                            waves: config.waves,
                            tournamentType: config.tournamentType,
                            totalSurfers: config.totalSurfers,
                            totalHeats: config.totalHeats,
                            totalRounds: config.totalRounds
                        };
                        console.log('✅ Display: config updated with names:', newConfig.surferNames);
                        setConfig(newConfig as any);
                    }
                } catch (error) {
                    console.error('❌ Display: failed to fetch config update:', error);
                }
            })
            .subscribe();

        return () => {
            console.log('📡 Display: unsubscribing from event config');
            if (channel) {
                supabase?.removeChannel(channel);
            }
        };
    }, [activeEventId, setConfig]);

    return (
        <ScoreDisplay
            config={config}
            scores={scores}
            timer={timer}
            configSaved={configSaved}
            heatStatus={heatStatus}
        />
    );
}
