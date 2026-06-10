import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import EventForm from './pages/EventForm';
import PaymentPage from './pages/PaymentPage';
import ParticipantsStructure from './pages/ParticipantsStructure';
import EventsApp from './events/EventsApp';
import LegacyApp from './App.tsx';
import OverlayPage from './pages/OverlayPage';

export default function RootRouter() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/events/new" element={<EventForm />} />
        <Route path="/events/payment/:id" element={<PaymentPage />} />
        <Route path="/events/participants" element={<ParticipantsStructure />} />
        <Route path="/events/*" element={<EventsApp />} />
        <Route path="/overlay" element={<OverlayPage />} />
        <Route path="/app/*" element={<LegacyApp />} />
        <Route path="/*" element={<LegacyApp />} />
      </Routes>
    </Router>
  );
}
