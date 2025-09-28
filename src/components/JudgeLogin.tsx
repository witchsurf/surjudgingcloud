import React, { useState } from 'react';
import { User, Lock, AlertTriangle } from 'lucide-react';

interface JudgeLoginProps {
  onLogin: (judgeId: string, judgeName: string) => void;
  availableJudges: Array<{ id: string; name: string }>;
}

function JudgeLogin({ onLogin, availableJudges }: JudgeLoginProps) {
  const [selectedJudge, setSelectedJudge] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedJudge) {
      setError('Veuillez sélectionner un juge');
      return;
    }

    // Code d'accès simple basé sur l'ID du juge
    const expectedCode = `SURF${selectedJudge}2024`;
    
    if (accessCode !== expectedCode) {
      setError('Code d\'accès incorrect');
      return;
    }

    const judge = availableJudges.find(j => j.id === selectedJudge);
    if (judge) {
      onLogin(judge.id, judge.name);
    }
  };

  const getJudgeAccessCode = (judgeId: string) => `SURF${judgeId}2024`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-cyan-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <User className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Interface Juge</h1>
          <p className="text-gray-600">Connectez-vous pour accéder à votre interface de notation</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sélectionnez votre nom
            </label>
            <select
              value={selectedJudge}
              onChange={(e) => {
                setSelectedJudge(e.target.value);
                setError('');
              }}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              required
            >
              <option value="">-- Choisir un juge --</option>
              {availableJudges.map(judge => (
                <option key={judge.id} value={judge.id}>
                  {judge.name || judge.id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Code d'accès
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={accessCode}
                onChange={(e) => {
                  setAccessCode(e.target.value.toUpperCase());
                  setError('');
                }}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Entrez votre code d'accès"
                required
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center space-x-2 text-red-600 bg-red-50 p-3 rounded-lg">
              <AlertTriangle className="w-5 h-5" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 font-medium transition-colors"
          >
            Se connecter
          </button>
        </form>

        {/* Aide pour les codes d'accès */}
        <div className="mt-8 p-4 bg-gray-50 rounded-lg">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Codes d'accès :</h3>
          <div className="space-y-1 text-xs text-gray-600">
            {availableJudges.map(judge => (
              <div key={judge.id} className="flex justify-between">
                <span>{judge.name || judge.id}:</span>
                <code className="bg-white px-2 py-1 rounded">{getJudgeAccessCode(judge.id)}</code>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            ℹ️ Ces codes sont temporaires et générés automatiquement
          </p>
        </div>
      </div>
    </div>
  );
}

export default JudgeLogin;