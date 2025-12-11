import { useState, useEffect } from 'react';
import { fetchActiveJudges } from '../api/supabaseClient';
import type { Judge } from '../api/supabaseClient';

interface JudgeSelectorSectionProps {
    selectedJudgeIds: string[];
    onSelectJudges: (judgeIds: string[]) => void;
    maxJudges?: number;
}

export const JudgeSelectorSection = ({
    selectedJudgeIds,
    onSelectJudges,
    maxJudges = 5
}: JudgeSelectorSectionProps) => {
    const [availableJudges, setAvailableJudges] = useState<Judge[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        loadJudges();
    }, []);

    const loadJudges = async () => {
        setLoading(true);
        setError('');
        try {
            const judges = await fetchActiveJudges();
            setAvailableJudges(judges);
        } catch (err) {
            console.error('Error loading judges:', err);
            setError('Erreur lors du chargement des juges');
        } finally {
            setLoading(false);
        }
    };

    const handleToggleJudge = (judgeId: string) => {
        if (selectedJudgeIds.includes(judgeId)) {
            // Remove judge
            onSelectJudges(selectedJudgeIds.filter(id => id !== judgeId));
        } else {
            // Add judge (if under limit)
            if (selectedJudgeIds.length < maxJudges) {
                onSelectJudges([...selectedJudgeIds, judgeId]);
            }
        }
    };

    if (loading) {
        return (
            <div className="bg-gray-800 rounded-lg p-6">
                <p className="text-gray-400">Chargement des juges...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-900/20 border border-red-500 rounded-lg p-6">
                <p className="text-red-400">{error}</p>
                <button
                    onClick={loadJudges}
                    className="mt-2 text-sm text-red-300 underline"
                >
                    Réessayer
                </button>
            </div>
        );
    }

    return (
        <div className="bg-gray-800 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Sélection des Juges FSS</h3>
                <span className="text-sm text-gray-400">
                    {selectedJudgeIds.length} / {maxJudges} sélectionné{selectedJudgeIds.length > 1 ? 's' : ''}
                </span>
            </div>

            {availableJudges.length === 0 ? (
                <p className="text-gray-400 text-sm">
                    Aucun juge disponible. Contactez l'administrateur pour ajouter des juges FSS.
                </p>
            ) : (
                <div className="space-y-2">
                    {availableJudges.map((judge) => {
                        const isSelected = selectedJudgeIds.includes(judge.id);
                        const canSelect = isSelected || selectedJudgeIds.length < maxJudges;

                        return (
                            <button
                                key={judge.id}
                                onClick={() => handleToggleJudge(judge.id)}
                                disabled={!canSelect}
                                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${isSelected
                                        ? 'border-blue-500 bg-blue-500/20 text-white'
                                        : canSelect
                                            ? 'border-gray-600 hover:border-gray-500 text-gray-300 hover:bg-gray-700/50'
                                            : 'border-gray-700 text-gray-600 cursor-not-allowed'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="font-medium">{judge.name}</div>
                                        {judge.certification_level && (
                                            <div className="text-xs text-gray-400 mt-1">
                                                {judge.certification_level} · {judge.federation}
                                            </div>
                                        )}
                                    </div>
                                    {isSelected && (
                                        <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {selectedJudgeIds.length >= maxJudges && (
                <p className="mt-3 text-sm text-yellow-400">
                    ℹ️ Limite de {maxJudges} juges atteinte
                </p>
            )}
        </div>
    );
};
