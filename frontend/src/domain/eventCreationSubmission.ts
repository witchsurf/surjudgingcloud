export interface EventCreationDraft {
  name: string;
  organizer: string;
  startDate: string;
  endDate: string;
}

type NativeFormValues = Pick<FormData, 'get'>;

const readText = (
  values: NativeFormValues,
  key: keyof EventCreationDraft,
  fallback: string,
) => {
  const nativeValue = values.get(key);
  return typeof nativeValue === 'string' ? nativeValue : fallback;
};

export const resolveEventCreationSubmission = (
  values: NativeFormValues,
  fallback: EventCreationDraft,
): EventCreationDraft => ({
  name: readText(values, 'name', fallback.name).trim(),
  organizer: readText(values, 'organizer', fallback.organizer).trim(),
  startDate: readText(values, 'startDate', fallback.startDate),
  endDate: readText(values, 'endDate', fallback.endDate),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const validateEventCreationSubmission = (draft: EventCreationDraft): string | null => {
  if (!draft.name || !draft.organizer) return 'Nom et organisateur sont requis.';
  if (!ISO_DATE.test(draft.startDate) || !ISO_DATE.test(draft.endDate)) {
    return 'Les dates de début et de fin sont requises.';
  }
  if (draft.endDate < draft.startDate) {
    return 'La date de fin doit être postérieure ou égale à la date de début.';
  }
  return null;
};
