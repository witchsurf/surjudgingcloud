import { useState } from 'react';

interface KioskJudgeLoginProps {
    position: string; // "J1", "J2", "J3", etc.
    onSuccess: (judge: { id: string; name: string }) => void;
}

export const KioskJudgeLogin = ({ position, onSuccess }: KioskJudgeLoginProps) => {
    const [judgeName, setJudgeName] = useState('');
    const [loading, setLoading] = useState(false);

    // Extract position number for display
    const positionNumber = position.replace('J', '');
    const kioskId = `kiosk-${position.toLowerCase()}`;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const trimmedName = judgeName.trim();
        if (!trimmedName) {
            return;
        }

        setLoading(true);

        try {
            // Store in session storage
            sessionStorage.setItem('authenticated_judge_id', kioskId);
            sessionStorage.setItem('authenticated_judge_name', trimmedName);
            sessionStorage.setItem('kiosk_position', position);

            // Call success callback
            onSuccess({
                id: kioskId,
                name: trimmedName
            });
        } catch (err) {
            console.error('Kiosk login error:', err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center px-4">
            <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <span className="text-4xl font-bold text-white">{positionNumber}</span>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">
                        Mode Kiosque
                    </h1>
                    <p className="text-lg text-gray-700">
                        Position: <span className="font-semibold text-blue-600">Juge {positionNumber}</span>
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="judge-name" className="block text-sm font-medium text-gray-700 mb-2">
                            Votre Nom
                        </label>
                        <input
                            id="judge-name"
                            type="text"
                            value={judgeName}
                            onChange={(e) => setJudgeName(e.target.value)}
                            placeholder="Entrez votre nom complet"
                            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 text-lg"
                            autoFocus
                            required
                            disabled={loading}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !judgeName.trim()}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200 text-lg"
                    >
                        {loading ? 'Connexion...' : 'Commencer à Juger'}
                    </button>
                </form>

                <div className="mt-6 pt-6 border-t border-gray-200">
                    <p className="text-xs text-gray-500 text-center">
                        🏄 Mode Tablette Fixe · Position {position}
                    </p>
                </div>
            </div>
        </div>
    );
};
