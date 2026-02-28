import { useNavigate } from 'react-router-dom';
import { Trophy, ClipboardList } from 'lucide-react';

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-700 via-primary-600 to-black text-white">
      {/* Background image overlay */}
      <div
        className="absolute inset-0 z-0 bg-cover bg-center opacity-20"
        style={{
          backgroundImage: 'url(/surf-background.jpg)',
          backgroundBlendMode: 'overlay'
        }}
      />

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <p className="text-accent uppercase tracking-widest font-semibold mb-4 text-sm md:text-base">
            LA PLATEFORME DÉDIÉE AUX JUGES
          </p>
          <h1 className="text-6xl md:text-8xl font-condensed font-bold mb-6 tracking-tight">
            SURF JUDGING SYSTEM
          </h1>
          <p className="text-xl md:text-2xl text-gray-200 max-w-2xl mx-auto font-light">
            Organisez vos compétitions de surf et accédez au scoring professionnel en temps réel.
          </p>
        </div>

        <div className="flex justify-center gap-6 flex-wrap">
          <button
            onClick={() => navigate('/create-event?fresh=1')}
            className="bg-primary hover:bg-primary-500 text-white px-8 py-4 rounded-xl text-lg font-medium flex items-center space-x-3 transition-all duration-200 transform hover:scale-105 active:scale-95 shadow-lg shadow-primary/30"
          >
            <Trophy className="w-6 h-6" />
            <span>Organiser un événement</span>
          </button>
          <button
            onClick={() => navigate('/my-events')}
            className="bg-white/10 hover:bg-white/20 text-white px-8 py-4 rounded-xl text-lg font-medium flex items-center space-x-3 transition-all duration-200 transform hover:scale-105 active:scale-95 border border-white/20 backdrop-blur-sm"
          >
            <ClipboardList className="w-6 h-6" />
            <span>Mes événements</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
