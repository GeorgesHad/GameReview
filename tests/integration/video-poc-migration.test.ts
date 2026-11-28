import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';

const db = new PGlite();
const admin = '15d1490e-f758-4e1e-bcf2-c2d4fa63bf9d';
const player = '9165333d-ff15-4655-ac62-7a5c8aa34e2d';
const team = '8be46735-cf65-4baf-8610-a300114ecf48';
const first = 'a58701af-1f73-44fc-ace0-6d039a5860c3';
const second = '1c32e7fc-2aba-4b1c-bd6d-da74cee9dea3';

beforeAll(async () => {
  await db.exec(`create schema auth; create table auth.users (id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;`);
  for (const file of ['migrations/20261127000000_identity_and_teams.sql', 'dev-only/migrations/20261128000000_video_poc.sql']) {
    await db.exec(await readFile(new URL(`../../supabase/${file}`, import.meta.url), 'utf8'));
  }
  await db.query('insert into auth.users values ($1), ($2)', [admin, player]);
  await db.query("insert into profiles (user_id, display_name) values ($1, 'Admin'), ($2, 'Player')", [admin, player]);
  await db.query("insert into teams (id, name) values ($1, 'DEV team')", [team]);
  await db.query(`insert into team_memberships (team_id, user_id, role, player_code)
    values ($1, $2, 'admin', null), ($1, $3, 'player', 'P001')`, [team, admin, player]);
}, 25_000);

afterAll(() => db.close());

async function reserve(id: string, size: number, user = admin) {
  const result = await db.query<{ reservation: { result: string } }>(
    'select video_poc_reserve($1, $2, $3, $4, $5, $6, $7, $8) as reservation',
    [id, team, user, 'sample.mp4', size, 6000, 'c'.repeat(64), 250_000_000],
  );
  return result.rows[0]?.reservation.result;
}

it('keeps reservations transactional and idempotent, and blocks browser and player access', async () => {
  await db.exec('set role authenticated');
  await expect(db.query('select * from video_poc_recordings')).rejects.toMatchObject({ code: '42501' });
  await expect(reserve(first, 200_000_000)).rejects.toMatchObject({ code: '42501' });
  await db.exec('set role service_role');
  expect(await reserve(first, 200_000_000, player)).toBe('forbidden');
  expect(await reserve(first, 200_000_000)).toBe('created');
  expect(await reserve(first, 200_000_000)).toBe('existing');
  expect(await reserve(first, 199_000_000)).toBe('conflict');
  expect(await reserve(second, 100_000_000)).toBe('quota');
  await db.query("update video_poc_recordings set status = 'deleting' where id = $1", [first]);
  expect(await reserve(second, 100_000_000)).toBe('quota');
  await db.query('delete from video_poc_recordings where id = $1', [first]);
  expect(await reserve(second, 100_000_000)).toBe('created');
  expect((await db.query('select video_poc_usage() as bytes')).rows).toEqual([{ bytes: 100_000_000 }]);
});
