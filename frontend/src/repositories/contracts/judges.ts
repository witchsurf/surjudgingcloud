export interface JudgeRecord {
  id: string;
  name: string;
  personalCode: string;
  email: string | null;
  phone: string | null;
  certificationLevel: string | null;
  federation: string;
  active: boolean;
  createdAt: string;
}

export interface CreateJudgeInput {
  name: string;
  personalCode: string;
  email?: string;
  phone?: string;
  certificationLevel?: string;
  federation?: string;
}

export type JudgePatch = Partial<Omit<CreateJudgeInput, 'personalCode'> & {
  personalCode: string;
  active: boolean;
}>;

export interface JudgeRepositoryContract {
  listActive(): Promise<readonly JudgeRecord[]>;
  getById(judgeId: string): Promise<JudgeRecord | null>;
  validateCode(judgeId: string, personalCode: string): Promise<JudgeRecord | null>;
  create(input: CreateJudgeInput): Promise<JudgeRecord>;
  update(judgeId: string, patch: JudgePatch): Promise<JudgeRecord>;
  deactivate(judgeId: string): Promise<void>;
  updateEventDisplayName(eventId: number, judgeId: string, name: string): Promise<void>;
}
