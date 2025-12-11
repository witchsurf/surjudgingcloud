import { useState, useEffect } from 'react';
import { validateJudgeCode, fetchJudgeById } from '../api/supabaseClient';
import type { Judge } from '../api/supabaseClient';

interface JudgeLoginProps {
    judgeId: string;
    onSuccess: (judge: Judge) => void;
}

export const JudgeLogin = ({ judgeId, onSuccess }: JudgeLoginProps) => {
    const [personalCode, setPersonalCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [judgeName, setJudgeName] = useState<string>('');

    // Load judge name on mount
    useEffect(() => {
        fetchJudgeById(judgeId).then(judge => {
            if (judge) {
                setJudgeName(judge.name);
            }
        }).catch(err => {
            console.error('Error fetching judge:', err);
            setError('Juge introuvable');
        });
    }, [judgeId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const judge = await validateJudgeCode(judgeId, personalCode.trim());

            if (judge) {
                // Store authentication in session
                sessionStorage.setItem('authenticated_judge_id', judge.id);
                sessionStorage.setItem('authenticated_judge_name', judge.name);
                onSuccess(judge);
            } else {
                setError('Code incorrect. Veuillez réessayer.');
                setPersonalCode('');
            }
        } catch (err) {
            console.error('Validation error:', err);
            setError('Erreur de connexion. Veuillez réessayer.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center px-4">
            <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">
                        Interface Juge
                    </h1>
                    {judgeName && (
                        <p className="text-lg text-gray-700">
                            Bonjour <span className="font-semibold text-blue-600">{judgeName}</span>
                        </p>
                    )}
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="personal-code" className="block text-sm font-medium text-gray-700 mb-2">
                            Code Personnel
                        </label>
                        <input
                            id="personal-code"
                            type="text"
                            value={personalCode}
                            onChange={(e) => setPersonalCode(e.target.value)}
                            placeholder="Entrez votre code"
                            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 text-lg text-center font-mono tracking-wider uppercase"
                            autoFocus
                            required
                            disabled={loading}
                        />
                    </div>

                    {error && (
                        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
                            <p className="text-red-700 text-sm font-medium text-center">{error}</p>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !personalCode.trim()}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200 text-lg"
                    >
                        {loading ? 'Vérification...' : 'Se Connecter'}
                    </button>
                </form>

                <div className="mt-6 pt-6 border-t border-gray-200">
                    <p className="text-xs text-gray-500 text-center">
                        🔒 Connexion sécurisée · Fédération Sénégalaise de Surf
                    </p>
                </div>
            </div>
        </div>
    );
};
