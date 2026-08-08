import { parsePlanningCsv } from '../adapters/planningImport/csvParser';

export interface ParsedParticipant {
  seed: number;
  name: string;
  category: string;
  country?: string;
  license?: string;
}

export interface ParseResult {
  rows: ParsedParticipant[];
  errors: string[];
}

export function parseCSVParticipants(content: string, source: 'csv' | 'google_sheets' = 'csv'): ParseResult {
  const result = parsePlanningCsv(content, { source });
  return {
    rows: result.validRows.map(({ seed, name, category, country, license }) => ({
      seed, name, category,
      country: country ?? undefined,
      license: license ?? undefined,
    })),
    errors: result.errors.map((diagnostic) => diagnostic.message),
  };
}

export function buildGoogleSheetCsvUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('google.com')) {
      return null;
    }

    const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (!match) return null;
    const sheetId = match[1];
    const gid = parsed.searchParams.get('gid') ?? '0';
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  } catch {
    return null;
  }
}
