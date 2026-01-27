import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useState } from 'react';
import LandingPage from './components/LandingPage';
import CreateEvent from './components/CreateEvent';
import PaymentPage from './components/PaymentPage';
import ParticipantsPage from './components/ParticipantsPage';
import GenerateHeatsPage from './components/GenerateHeatsPage';
import AdminInterface from './components/AdminInterface';
import type { AppConfig, HeatTimer } from './types';

function App() {
  const [config, setConfig] = useState<AppConfig>({
    competition: '',
    division: '',
    round: 1,
    heatId: 1,
    judges: ['J1', 'J2', 'J3'],
    surfers: ['ROUGE', 'BLANC'],
    waves: 15,
    judgeNames: {},
    tournamentType: 'elimination',
    totalSurfers: 0,
    surfersPerHeat: 2,
    totalHeats: 0,
    totalRounds: 1
  });

  const [timer, setTimer] = useState<HeatTimer>({
    isRunning: false,
    startTime: null,
    duration: 1200 // 20 minutes
  });

  const [configSaved, setConfigSaved] = useState(false);
  const [scores] = useState([]);
  const [overrideLogs] = useState([]);

  const handleConfigChange = (newConfig: AppConfig) => {
    setConfig(newConfig);
    setConfigSaved(false);
  };

  const handleTimerChange = (newTimer: HeatTimer) => {
    setTimer(newTimer);
  };

  const handleConfigSaved = (saved: boolean) => {
    setConfigSaved(saved);
  };

  const handleReloadData = () => {
    // Implement data reload logic
  };

  const handleResetAllData = () => {
    // Implement data reset logic
  };

  const handleCloseHeat = () => {
    // Implement heat closing logic
  };

  const handleScoreOverride = async () => {
    // Implement score override logic
    return undefined;
  };

  return (
    <Router>
      <div className="min-h-screen bg-gray-900">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/create-event" element={<CreateEvent />} />
          <Route path="/payment" element={<PaymentPage />} />
          <Route path="/participants" element={<ParticipantsPage />} />
          <Route path="/generate-heats" element={<GenerateHeatsPage />} />
          <Route path="/chief-judge" element={
            <AdminInterface
              config={config}
              onConfigChange={handleConfigChange}
              onConfigSaved={handleConfigSaved}
              configSaved={configSaved}
              timer={timer}
              onTimerChange={handleTimerChange}
              onReloadData={handleReloadData}
              onResetAllData={handleResetAllData}
              onCloseHeat={handleCloseHeat}
              judgeWorkCount={{}}
              scores={scores}
              overrideLogs={overrideLogs}
              onScoreOverride={handleScoreOverride}
            />
          } />
        </Routes>
      </div>
    </Router>
  );
}

export default App;