import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = new URL('../../supabase/migrations/20261127000000_identity_and_teams.sql', import.meta.url);
const fixture = new URL('../../supabase/fixtures/dev_teams.sql', import.meta.url);
const firstTeam = '3e5d1e3d-2d06-460b-86b7-ac47af63a600';
const secondTeam = 'c909f9f4-e896-4be1-aacb-9c2d10a595ff';
const firstUser = '7028db8e-5845-453c-8c2f-6c6ca5b130d8';
const secondUser = '20e0411b-7d33-4bde-b37c-e692e347f0aa';

describe('Phase 1 PostgreSQL migration', () => {
  const db = new PGlite();

  beforeAll(async () => {
    // Stand-ins for platform roles and the Auth foreign-key target.
    await db.exec(`
      create schema auth;
      create table auth.users (id uuid primary key);
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
    `);
    await db.exec(await readFile(migration, 'utf8'));
    const sampleTeams = await readFile(fixture, 'utf8');
    await db.exec(sampleTeams);
    await db.exec(sampleTeams);
    await db.query('insert into auth.users values ($1), ($2)', [firstUser, secondUser]);
    await db.query("insert into profiles (user_id, display_name) values ($1, 'Player A'), ($2, 'Player B')", [firstUser, secondUser]);
  }, 15_000);

  afterAll(() => db.close());

  it('supports one identity in multiple teams and rejects duplicate or reserved codes within a team', async () => {
    const add = (team: string, user: string, code: string) => db.query(
      "insert into team_memberships (team_id, user_id, role, player_code) values ($1, $2, 'player', $3)",
      [team, user, code],
    );
    await add(firstTeam, firstUser, 'P006');
    await add(secondTeam, firstUser, 'P006');
    await expect(add(firstTeam, secondUser, 'P006')).rejects.toMatchObject({ code: '23505' });
    await expect(add(firstTeam, secondUser, 'ALL')).rejects.toMatchObject({ code: '23514' });
    await expect(add(secondTeam, firstUser, 'P008')).rejects.toMatchObject({ code: '23505' });
  });

  it('keeps app tables inaccessible to browser roles and readable by the server role', async () => {
    const tables = ['profiles', 'teams', 'team_memberships'];
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      'select relname, relrowsecurity from pg_class where relname = any($1) order by relname', [tables],
    );
    expect(rls.rows).toEqual(tables.toSorted().map((table) => ({ relname: table, relrowsecurity: true })));

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        for (const table of tables) {
          await expect(db.query(`select * from public.${table}`)).rejects.toMatchObject({ code: '42501' });
        }
      } finally {
        await db.exec('reset role');
      }
    }

    await db.exec('set role service_role');
    try {
      const teams = await db.query('select id from public.teams order by id');
      expect(teams.rows).toEqual([{ id: firstTeam }, { id: secondTeam }]);
    } finally {
      await db.exec('reset role');
    }
  });
});
