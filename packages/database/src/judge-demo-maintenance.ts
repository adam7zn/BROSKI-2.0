import type { Pool } from 'pg';

export interface ClearedJudgeDemoFixture {
  interactions: number;
  profiles: number;
}

export async function clearJudgeDemoFixture(
  pool: Pool,
  confirmation: string,
): Promise<ClearedJudgeDemoFixture> {
  if (confirmation !== 'demo-001') {
    throw new Error('Judge demo cleanup requires --confirm demo-001');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const interactions = await client.query(
      `DELETE FROM interactions
       WHERE interaction_id = 'demo-001'
       RETURNING interaction_id`,
    );
    const profiles = await client.query(
      `DELETE FROM demo_profiles
       WHERE profile_id = 'demo-student'
       RETURNING profile_id`,
    );
    await client.query('COMMIT');
    return {
      interactions: interactions.rowCount ?? 0,
      profiles: profiles.rowCount ?? 0,
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the cleanup error.
    }
    throw error;
  } finally {
    client.release();
  }
}
