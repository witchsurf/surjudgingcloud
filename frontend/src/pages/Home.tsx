import { Link } from 'react-router-dom';

const backgroundImage =
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1600&q=80';

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden text-white">
      <div className="absolute inset-0">
        <img
          src={backgroundImage}
          alt="Compétition de surf"
          className="h-full w-full object-cover object-center"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-[1px]" />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
        <div className="max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-blue-200">
            La plateforme dédiée aux juges
          </p>
          <h1 className="mt-6 text-4xl font-black uppercase tracking-tight sm:text-5xl lg:text-6xl">
            Surf Judging System
          </h1>
          <p className="mt-6 text-lg text-blue-100 sm:text-xl">
            Organisez vos compétitions de surf et accédez au scoring temps réel.
          </p>

          <div className="mt-10 flex justify-center">
            <Link
              to="/events/new"
              className="group inline-flex items-center gap-2 rounded-full bg-blue-500 px-10 py-3 text-lg font-semibold text-white shadow-xl shadow-blue-500/35 transition hover:bg-blue-400 hover:shadow-blue-400/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-200"
            >
              <span role="img" aria-hidden="true">
                🏄‍♂️
              </span>
              Organiser un événement
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
