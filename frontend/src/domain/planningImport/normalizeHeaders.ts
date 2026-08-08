import type { CanonicalPlanningColumn } from './contracts';

export const normalizePlanningToken = (value: unknown): string => String(value ?? '')
  .replace(/^\uFEFF/, '')
  .trim()
  .toLocaleLowerCase('fr')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const ALIASES: Readonly<Record<CanonicalPlanningColumn, readonly string[]>> = {
  seed: ['seed', 'classement', 'ranking', 'rank', 'tete', 'tête'],
  name: ['name', 'nom', 'surfer', 'surfeur', 'athlete', 'athlète'],
  category: ['category', 'categorie', 'catégorie', 'division'],
  country: ['country', 'pays', 'nation', 'club', 'team', 'pays/club'],
  license: ['license', 'licence', 'identifiant', 'id'],
};

const ALIAS_LOOKUP = new Map<string, CanonicalPlanningColumn>(
  Object.entries(ALIASES).flatMap(([column, aliases]) =>
    aliases.map((alias) => [normalizePlanningToken(alias), column as CanonicalPlanningColumn] as const)),
);

export interface PlanningHeaderResolution {
  indexes: Readonly<Partial<Record<CanonicalPlanningColumn, number>>>;
  normalizedHeaders: readonly string[];
}

export const normalizePlanningHeaders = (headers: readonly unknown[]): PlanningHeaderResolution => {
  const normalizedHeaders = headers.map(normalizePlanningToken);
  const indexes: Partial<Record<CanonicalPlanningColumn, number>> = {};

  normalizedHeaders.forEach((header, index) => {
    const column = ALIAS_LOOKUP.get(header);
    if (column && indexes[column] === undefined) indexes[column] = index;
  });

  return { indexes, normalizedHeaders };
};
