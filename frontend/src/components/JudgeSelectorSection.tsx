import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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
    const [isExpanded, setIsExpanded] = useState(false); // Collapsed by default

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
            onSelectJudges(selectedJudgeIds.filter(id => id !== judgeId));
        } else {
            if (selectedJudgeIds.length < maxJudges) {
                onSelectJudges([...selectedJudgeIds, judgeId]);
            }
        }
    };

    return (
        <div className="border border-gray-200 rounded-lg mb-4">
            {/* Collapsible Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-t-lg transition-colors"
            >
                <div className="flex items-center space-x-2">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                    <span className="font-medium text-gray-700 text-sm">Juges FSS officiels</span>
                </div>
                <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
                    {selectedJudgeIds.length}/{maxJudges}
                </span>
            </button>

            {/* Collapsible Content */}
            {isExpanded && (
                <div className="p-4 bg-white">
                    {loading ? (
                        <p className="text-gray-400 text-sm">Chargement...</p>
                    ) : error ? (
                        <div className="text-red-500 text-sm">
                            {error}
                            <button onClick={loadJudges} className="ml-2 underline">Réessayer</button>
                        </div>
                    ) : availableJudges.length === 0 ? (
                        <p className="text-gray-400 text-sm">Aucun juge FSS disponible</p>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {availableJudges.map((judge) => {
                                const isSelected = selectedJudgeIds.includes(judge.id);
                                const canSelect = isSelected || selectedJudgeIds.length < maxJudges;

                                return (
                                    <button
                                        key={judge.id}
                                        onClick={() => handleToggleJudge(judge.id)}
                                        disabled={!canSelect}
                                        className={`text-left px-3 py-2 rounded-lg border transition-all text-sm ${isSelected
                                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                                            : canSelect
                                                ? 'border-gray-200 hover:border-gray-300 text-gray-700 hover:bg-gray-50'
                                                : 'border-gray-100 text-gray-400 cursor-not-allowed'
                                            }`}
                                    >
                                        <div className="font-medium">{judge.name}</div>
                                        {judge.certification_level && (
                                            <div className="text-xs text-gray-400">{judge.certification_level}</div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
