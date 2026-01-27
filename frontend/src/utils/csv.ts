import Papa from 'papaparse';

export interface RawParticipantRow {
  seed?: string | number;
  name?: string;
  category?: string;
  country?: string;
  license?: string;
  [key: string]: unknown;
}

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

const COLUMN_ALIASES: Record<string, keyof RawParticipantRow> = {
  seed: 'seed',
  classement: 'seed',
  ranking: 'seed',
  name: 'name',
  surfer: 'name',
  athlete: 'name',
  nom: 'name',
  category: 'category',
  division: 'category',
  categorie: 'category',
  country: 'country',
  nation: 'country',
  club: 'country',
  'pays/club': 'country',
  pays: 'country',
  license: 'license',
  licence: 'license',
  identifiant: 'license',
  id: 'license',
};

export function parseCSVParticipants(content: string): ParseResult {
  const parsed = Papa.parse<RawParticipantRow>(content, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.toLowerCase().trim(),
  });

  const errors: string[] = [];
  if (parsed.errors.length > 0) {
    parsed.errors.forEach((err) => {
      errors.push(`Ligne ${err.row ?? '?'}: ${err.message}`);
    });
  }

  const rows: ParsedParticipant[] = [];
  const seedTracker = new Map<string, Set<number>>();

  (parsed.data ?? []).forEach((raw, rowIndex) => {
    const normalised: RawParticipantRow = {};

    Object.entries(raw).forEach(([key, value]) => {
      const alias = COLUMN_ALIASES[key] ?? key;
      normalised[alias] = value;
    });

    const seedValue = Number(normalised.seed);
    const nameValue = typeof normalised.name === 'string' ? normalised.name.trim() : '';
    const categoryValue = typeof normalised.category === 'string' ? normalised.category.trim() : '';

    if (!Number.isInteger(seedValue) || seedValue <= 0) {
      errors.push(`Ligne ${rowIndex + 2}: Seed invalide (${normalised.seed ?? 'vide'})`);
      return;
    }

    if (!nameValue) {
      errors.push(`Ligne ${rowIndex + 2}: Nom manquant`);
      return;
    }

    if (!categoryValue) {
      errors.push(`Ligne ${rowIndex + 2}: Catégorie manquante`);
      return;
    }

    if (!seedTracker.has(categoryValue)) {
      seedTracker.set(categoryValue, new Set());
    }
    const tracker = seedTracker.get(categoryValue)!;
    if (tracker.has(seedValue)) {
      errors.push(`Doublon seed ${seedValue} pour la catégorie ${categoryValue}`);
      return;
    }
    tracker.add(seedValue);

    rows.push({
      seed: seedValue,
      name: nameValue,
      category: categoryValue,
      country: typeof normalised.country === 'string' ? normalised.country.trim() || undefined : undefined,
      license: typeof normalised.license === 'string' ? normalised.license.trim() || undefined : undefined,
    });
  });

  rows.sort((a, b) => a.seed - b.seed);

  return { rows, errors };
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
