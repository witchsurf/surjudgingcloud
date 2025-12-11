
import JudgeInterface from '../components/JudgeInterface';
import { JudgeLogin } from '../components/JudgeLogin';
import { useAuth } from '../contexts/AuthContext';
import { useConfig } from '../contexts/ConfigContext';
import { useJudging } from '../contexts/JudgingContext';
import { useScoreManager } from '../hooks/useScoreManager';
import { getHeatIdentifiers } from '../utils/heat';

export default function JudgePage() {
    const { currentJudge, login } = useAuth();
    const { config, configSaved } = useConfig();
    const { timer } = useJudging();
    const { handleScoreSubmit } = useScoreManager();

    const currentHeatId = getHeatIdentifiers(
        config.competition,
        config.division,
        config.round,
        config.heatId
    ).normalized;

    const searchParams = new URLSearchParams(window.location.search);
    const judgeIdFromUrl = searchParams.get('judge_id');

    // Fast path: always show the judge code screen when judge_id is present, skipping magic-link/user auth.
    if (!currentJudge && judgeIdFromUrl) {
        return (
            <JudgeLogin
                judgeId={judgeIdFromUrl}
                onSuccess={(judge) => login(judge.id, judge.name)}
            />
        );
    }

    if (!currentJudge && !judgeIdFromUrl) {
        return <div className="p-8 text-center text-white">Lien invalide. Veuillez utiliser le lien fourni par l'administrateur.</div>;
    }

    return (
        <JudgeInterface
            config={config}
            judgeId={currentJudge.id}
            onScoreSubmit={(score) => handleScoreSubmit(score, currentHeatId)}
            configSaved={configSaved}
            timer={timer}
        />
    );
}
