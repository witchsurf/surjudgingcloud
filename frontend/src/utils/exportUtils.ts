import type { Score } from '../types';

interface CompetitionExportData {
  competition: string;
  heats: unknown[];
  scores: Score[];
}

export async function downloadSimpleExport(competition: string) {
  try {
    // Simuler l'export - dans une vraie app, ceci ferait appel à Supabase
    const mockData: CompetitionExportData = {
      competition,
      heats: [],
      scores: []
    };

    // Créer le rapport TXT
    const reportContent = generateTextReport(mockData);
    downloadFile(`${competition}_rapport.txt`, reportContent, 'text/plain');

    // Créer le CSV
    const csvContent = generateCSV(mockData.scores);
    downloadFile(`${competition}_scores.csv`, csvContent, 'text/csv');

  } catch (error) {
    console.error('Erreur lors de l\'export:', error);
    throw error;
  }
}

function generateTextReport(data: CompetitionExportData): string {
  const now = new Date().toLocaleString('fr-FR');
  
  return `RAPPORT DE COMPÉTITION
========================

Compétition: ${data.competition}
Date d'export: ${now}

Nombre de heats: ${data.heats.length}
Nombre de scores: ${data.scores.length}

Ce rapport a été généré automatiquement par l'application de jugement de surf.
`;
}

function generateCSV(scores: Score[]): string {
  const headers = [
    'Heat ID',
    'Compétition', 
    'Division',
    'Tour',
    'Juge ID',
    'Nom du Juge',
    'Surfeur',
    'Numéro de Vague',
    'Score',
    'Timestamp'
  ];

  const rows = scores.map(score => [
    score.heat_id,
    score.competition,
    score.division,
    score.round,
    score.judge_id,
    score.judge_name,
    score.surfer,
    score.wave_number,
    score.score,
    score.timestamp
  ]);

  return [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
