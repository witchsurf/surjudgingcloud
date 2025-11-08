import { useNavigate } from 'react-router-dom';

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 to-black text-white">
      {/* Background image overlay */}
      <div 
        className="absolute inset-0 z-0 bg-cover bg-center opacity-30"
        style={{ 
          backgroundImage: 'url(/surf-background.jpg)',
          backgroundBlendMode: 'overlay' 
        }}
      />

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <p className="text-blue-400 uppercase tracking-wider mb-4">
            LA PLATEFORME DÉDIÉE AUX JUGES
          </p>
          <h1 className="text-5xl md:text-7xl font-bold mb-6">
            SURF JUDGING SYSTEM
          </h1>
          <p className="text-xl md:text-2xl text-gray-300 max-w-2xl mx-auto">
            Organisez vos compétitions de surf et accédez au scoring temps réel.
          </p>
        </div>

        <div className="flex justify-center">
          <button
            onClick={() => navigate('/create-event')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-lg text-lg font-medium flex items-center space-x-2 transition-all duration-200 transform hover:scale-105"
          >
            <span className="text-2xl">🏄</span>
            <span>Organiser un événement</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;