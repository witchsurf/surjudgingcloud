/**
 * Validation and sanitization utilities for user inputs
 * Prevents XSS, injection attacks, and ensures data integrity
 */

// Maximum lengths for various fields
export const MAX_LENGTHS = {
  NAME: 100,
  COUNTRY: 50,
  LICENSE: 50,
  COMPETITION_NAME: 100,
  DIVISION: 50,
  JUDGE_NAME: 50,
  COMMENT: 500,
} as const;

// Score validation constants
export const SCORE_CONSTRAINTS = {
  MIN: 0,
  MAX: 10,
  DECIMALS: 2,
} as const;

/**
 * Sanitizes a string by removing potentially dangerous characters
 * Prevents XSS while preserving unicode characters for international names
 */
export function sanitizeString(input: unknown): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .trim()
    // Remove control characters but preserve unicode letters/numbers
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove script-like patterns
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ');
}

/**
 * Validates and sanitizes a participant name
 */
export function validateParticipantName(name: unknown): { valid: boolean; value: string; error?: string } {
  const sanitized = sanitizeString(name);

  if (!sanitized) {
    return { valid: false, value: '', error: 'Le nom est requis' };
  }

  if (sanitized.length > MAX_LENGTHS.NAME) {
    return {
      valid: false,
      value: sanitized.slice(0, MAX_LENGTHS.NAME),
      error: `Le nom ne peut pas dépasser ${MAX_LENGTHS.NAME} caractères`,
    };
  }

  // Name should have at least 2 characters
  if (sanitized.length < 2) {
    return { valid: false, value: sanitized, error: 'Le nom doit contenir au moins 2 caractères' };
  }

  return { valid: true, value: sanitized };
}

/**
 * Validates a score value
 */
export function validateScore(score: unknown): { valid: boolean; value: number; error?: string } {
  const numericScore = typeof score === 'number' ? score : Number(score);

  if (Number.isNaN(numericScore)) {
    return { valid: false, value: 0, error: 'Le score doit être un nombre' };
  }

  if (numericScore < SCORE_CONSTRAINTS.MIN || numericScore > SCORE_CONSTRAINTS.MAX) {
    return {
      valid: false,
      value: Math.max(SCORE_CONSTRAINTS.MIN, Math.min(SCORE_CONSTRAINTS.MAX, numericScore)),
      error: `Le score doit être entre ${SCORE_CONSTRAINTS.MIN} et ${SCORE_CONSTRAINTS.MAX}`,
    };
  }

  // Round to 2 decimal places
  const rounded = Math.round(numericScore * 100) / 100;

  return { valid: true, value: rounded };
}

/**
 * Validates a wave number
 */
export function validateWaveNumber(wave: unknown, maxWaves: number): { valid: boolean; value: number; error?: string } {
  const waveNum = typeof wave === 'number' ? wave : Number(wave);

  if (Number.isNaN(waveNum) || !Number.isInteger(waveNum)) {
    return { valid: false, value: 1, error: 'Le numéro de vague doit être un entier' };
  }

  if (waveNum < 1 || waveNum > maxWaves) {
    return {
      valid: false,
      value: Math.max(1, Math.min(maxWaves, waveNum)),
      error: `Le numéro de vague doit être entre 1 et ${maxWaves}`,
    };
  }

  return { valid: true, value: waveNum };
}

/**
 * Validates a heat ID format
 * Expected format: EventName_Division_R{round}_H{heat}
 */
export function validateHeatId(heatId: unknown): { valid: boolean; value: string; error?: string } {
  const sanitized = sanitizeString(heatId);

  if (!sanitized) {
    return { valid: false, value: '', error: 'Heat ID est requis' };
  }

  // Basic format validation
  const heatIdPattern = /^[\w\-]+_[\w\-]+_R\d+_H\d+$/i;
  if (!heatIdPattern.test(sanitized)) {
    return {
      valid: false,
      value: sanitized,
      error: 'Format de Heat ID invalide (attendu: Event_Division_R#_H#)',
    };
  }

  return { valid: true, value: sanitized };
}

/**
 * Validates a judge ID
 */
export function validateJudgeId(judgeId: unknown): { valid: boolean; value: string; error?: string } {
  const sanitized = sanitizeString(judgeId);

  if (!sanitized) {
    return { valid: false, value: '', error: 'Judge ID est requis' };
  }

  // Judge ID should be alphanumeric with optional dashes/underscores
  const judgeIdPattern = /^[a-zA-Z0-9_\-]+$/;
  if (!judgeIdPattern.test(sanitized)) {
    return {
      valid: false,
      value: sanitized,
      error: 'Judge ID invalide (seuls les lettres, chiffres, - et _ sont autorisés)',
    };
  }

  if (sanitized.length > 50) {
    return { valid: false, value: sanitized.slice(0, 50), error: 'Judge ID trop long' };
  }

  return { valid: true, value: sanitized };
}

/**
 * Validates a surfer color code
 */
export function validateSurferColor(color: unknown): { valid: boolean; value: string; error?: string } {
  const sanitized = sanitizeString(color).toUpperCase();

  const validColors = ['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR', 'RED', 'WHITE', 'YELLOW', 'BLUE', 'GREEN', 'BLACK'];

  if (!validColors.includes(sanitized)) {
    return { valid: false, value: sanitized, error: 'Couleur de surfeur invalide' };
  }

  return { valid: true, value: sanitized };
}

/**
 * Validates a comment field
 */
export function validateComment(comment: unknown): { valid: boolean; value: string; error?: string } {
  const sanitized = sanitizeString(comment);

  if (sanitized.length > MAX_LENGTHS.COMMENT) {
    return {
      valid: false,
      value: sanitized.slice(0, MAX_LENGTHS.COMMENT),
      error: `Le commentaire ne peut pas dépasser ${MAX_LENGTHS.COMMENT} caractères`,
    };
  }

  return { valid: true, value: sanitized };
}

/**
 * Validates a country code or name
 */
export function validateCountry(country: unknown): { valid: boolean; value: string; error?: string } {
  const sanitized = sanitizeString(country);

  if (sanitized && sanitized.length > MAX_LENGTHS.COUNTRY) {
    return {
      valid: false,
      value: sanitized.slice(0, MAX_LENGTHS.COUNTRY),
      error: `Le pays ne peut pas dépasser ${MAX_LENGTHS.COUNTRY} caractères`,
    };
  }

  return { valid: true, value: sanitized };
}

/**
 * Validates a license number
 */
export function validateLicense(license: unknown): { valid: boolean; value: string; error?: string } {
  const sanitized = sanitizeString(license);

  if (sanitized && sanitized.length > MAX_LENGTHS.LICENSE) {
    return {
      valid: false,
      value: sanitized.slice(0, MAX_LENGTHS.LICENSE),
      error: `La licence ne peut pas dépasser ${MAX_LENGTHS.LICENSE} caractères`,
    };
  }

  return { valid: true, value: sanitized };
}

/**
 * Validates an event ID (positive integer)
 */
export function validateEventId(eventId: unknown): { valid: boolean; value: number; error?: string } {
  const numericId = typeof eventId === 'number' ? eventId : Number(eventId);

  if (Number.isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
    return { valid: false, value: 0, error: 'Event ID invalide' };
  }

  return { valid: true, value: numericId };
}

/**
 * Batch validation for a complete score submission
 */
export interface ScoreSubmission {
  heatId: string;
  judgeId: string;
  surfer: string;
  waveNumber: number;
  score: number;
  maxWaves: number;
}

export function validateScoreSubmission(submission: Partial<ScoreSubmission>): {
  valid: boolean;
  validated: Partial<ScoreSubmission>;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const validated: Partial<ScoreSubmission> = {};

  // Validate heat ID
  const heatResult = validateHeatId(submission.heatId);
  if (!heatResult.valid) {
    errors.heatId = heatResult.error ?? 'Heat ID invalide';
  } else {
    validated.heatId = heatResult.value;
  }

  // Validate judge ID
  const judgeResult = validateJudgeId(submission.judgeId);
  if (!judgeResult.valid) {
    errors.judgeId = judgeResult.error ?? 'Judge ID invalide';
  } else {
    validated.judgeId = judgeResult.value;
  }

  // Validate surfer color
  const surferResult = validateSurferColor(submission.surfer);
  if (!surferResult.valid) {
    errors.surfer = surferResult.error ?? 'Couleur surfeur invalide';
  } else {
    validated.surfer = surferResult.value;
  }

  // Validate wave number
  const maxWaves = submission.maxWaves ?? 20;
  const waveResult = validateWaveNumber(submission.waveNumber, maxWaves);
  if (!waveResult.valid) {
    errors.waveNumber = waveResult.error ?? 'Numéro de vague invalide';
  } else {
    validated.waveNumber = waveResult.value;
  }

  // Validate score
  const scoreResult = validateScore(submission.score);
  if (!scoreResult.valid) {
    errors.score = scoreResult.error ?? 'Score invalide';
  } else {
    validated.score = scoreResult.value;
  }

  return {
    valid: Object.keys(errors).length === 0,
    validated,
    errors,
  };
}

/**
 * Sanitizes data before storing in localStorage
 */
export function sanitizeForStorage<T>(data: T): T {
  if (typeof data === 'string') {
    return sanitizeString(data) as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForStorage(item)) as T;
  }

  if (data && typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    Object.entries(data).forEach(([key, value]) => {
      sanitized[key] = sanitizeForStorage(value);
    });
    return sanitized as T;
  }

  return data;
}
