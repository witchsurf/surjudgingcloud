import { BaseRepository } from './BaseRepository';
import type { CreateJudgeInput, JudgePatch, JudgeRecord, JudgeRepositoryContract } from './contracts';
import {
  createJudge,
  deactivateJudge,
  fetchActiveJudges,
  fetchJudgeById,
  updateJudge,
  updateJudgeName,
  validateJudgeCode,
  type Judge,
} from '../api/modules/judges.api';

const toJudgeRecord = (judge: Judge): JudgeRecord => ({
  id: judge.id,
  name: judge.name,
  personalCode: judge.personal_code,
  email: judge.email ?? null,
  phone: judge.phone ?? null,
  certificationLevel: judge.certification_level ?? null,
  federation: judge.federation,
  active: judge.active,
  createdAt: judge.created_at,
});

export class JudgeRepository extends BaseRepository implements JudgeRepositoryContract {
  constructor() {
    super('judges');
  }

  async listActive(): Promise<JudgeRecord[]> {
    return (await fetchActiveJudges()).map(toJudgeRecord);
  }

  async getById(judgeId: string): Promise<JudgeRecord | null> {
    const judge = await fetchJudgeById(judgeId);
    return judge ? toJudgeRecord(judge) : null;
  }

  async validateCode(judgeId: string, personalCode: string): Promise<JudgeRecord | null> {
    const judge = await validateJudgeCode(judgeId, personalCode);
    return judge ? toJudgeRecord(judge) : null;
  }

  async create(input: CreateJudgeInput): Promise<JudgeRecord> {
    return toJudgeRecord(await createJudge({
      name: input.name,
      personal_code: input.personalCode,
      email: input.email,
      phone: input.phone,
      certification_level: input.certificationLevel,
      federation: input.federation,
    }));
  }

  async update(judgeId: string, patch: JudgePatch): Promise<JudgeRecord> {
    return toJudgeRecord(await updateJudge(judgeId, {
      name: patch.name,
      personal_code: patch.personalCode,
      email: patch.email,
      phone: patch.phone,
      certification_level: patch.certificationLevel,
      federation: patch.federation,
      active: patch.active,
    }));
  }

  async deactivate(judgeId: string): Promise<void> {
    await deactivateJudge(judgeId);
  }

  async updateEventDisplayName(eventId: number, judgeId: string, name: string): Promise<void> {
    await updateJudgeName(eventId, judgeId, name);
  }
}

export const judgeRepository = new JudgeRepository();
