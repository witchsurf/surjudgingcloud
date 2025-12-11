import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import EventForm from './pages/EventForm';
import PaymentPage from './pages/PaymentPage';
import ParticipantsStructure from './pages/ParticipantsStructure';
import EventsApp from './events/EventsApp';
import LegacyApp from './App.tsx';

export default function RootRouter() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/events/new" element={<EventForm />} />
        <Route path="/events/payment/:id" element={<PaymentPage />} />
        <Route path="/events/participants" element={<ParticipantsStructure />} />
        <Route path="/events/*" element={<EventsApp />} />
        <Route path="/app/*" element={<LegacyApp />} />
        <Route path="/*" element={<LegacyApp />} />
      </Routes>
    </Router>
  );
}
