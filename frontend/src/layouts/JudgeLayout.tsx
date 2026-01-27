import { Outlet } from 'react-router-dom';
import { User } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

export default function JudgeLayout() {
    const { currentJudge, logout } = useAuthStore();

    if (!currentJudge) {
        return <Outlet />; // Will render JudgeLogin
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
                <div className="flex items-center space-x-3">
                    <User className="w-5 h-5 text-blue-600" />
                    <span className="font-medium">Connecté: {currentJudge.name}</span>
                </div>
                <button
                    onClick={logout}
                    className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                >
                    Déconnexion
                </button>
            </div>
            <main className="max-w-7xl mx-auto px-4 py-6">
                <Outlet />
            </main>
        </div>
    );
}
