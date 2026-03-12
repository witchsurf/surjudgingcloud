import { useState } from 'react';

interface PriorityJudgeLoginProps {
    onSuccess: (judge: { id: string; name: string }) => void;
}

export const PriorityJudgeLogin = ({ onSuccess }: PriorityJudgeLoginProps) => {
    const [judgeName, setJudgeName] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = judgeName.trim();
        if (!trimmedName) return;

        setLoading(true);
        try {
            sessionStorage.setItem('authenticated_judge_id', 'priority-judge');
            sessionStorage.setItem('authenticated_judge_name', trimmedName);
            onSuccess({
                id: 'priority-judge',
                name: trimmedName,
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 flex items-center justify-center px-4">
            <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="w-20 h-20 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4 text-white text-3xl font-bold">
                        P
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">
                        Juge Priorité
                    </h1>
                    <p className="text-gray-600">
                        Tablette dédiée à la gestion de la priorité
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="priority-judge-name" className="block text-sm font-medium text-gray-700 mb-2">
                            Votre nom
                        </label>
                        <input
                            id="priority-judge-name"
                            type="text"
                            value={judgeName}
                            onChange={(e) => setJudgeName(e.target.value)}
                            placeholder="Entrez votre nom"
                            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 text-lg"
                            autoFocus
                            required
                            disabled={loading}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !judgeName.trim()}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200 text-lg"
                    >
                        {loading ? 'Connexion...' : 'Ouvrir la priorité'}
                    </button>
                </form>
            </div>
        </div>
    );
};
