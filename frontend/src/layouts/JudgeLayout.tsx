import { Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

export default function JudgeLayout() {
    const { currentJudge } = useAuthStore();

    if (!currentJudge) {
        return <Outlet />; // Will render JudgeLogin
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <main className="max-w-7xl mx-auto px-4 py-4 sm:py-6">
                <Outlet />
            </main>
        </div>
    );
}
