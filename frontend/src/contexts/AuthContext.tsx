import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

const SESSION_JUDGE_KEY = 'surfJudgingCurrentJudge';

interface Judge {
  id: string;
  name: string;
}

interface AuthContextType {
  currentJudge: Judge | null;
  login: (judgeId: string, judgeName: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentJudge, setCurrentJudge] = useState<Judge | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_JUDGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
          setCurrentJudge({ id: parsed.id, name: parsed.name || parsed.id });
        }
      }
    } catch (error) {
      console.error('❌ Erreur lecture juge session:', error);
    }
  }, []);

  const login = (judgeId: string, judgeName: string) => {
    const judge = { id: judgeId, name: judgeName };
    setCurrentJudge(judge);
    try {
      sessionStorage.setItem(SESSION_JUDGE_KEY, JSON.stringify(judge));
    } catch (error) {
      console.error('❌ Erreur sauvegarde juge session:', error);
    }
  };

  const logout = () => {
    setCurrentJudge(null);
    try {
      sessionStorage.removeItem(SESSION_JUDGE_KEY);
    } catch (error) {
      console.error('❌ Erreur suppression juge session:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ currentJudge, login, logout, isAuthenticated: !!currentJudge }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
