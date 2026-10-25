// Runs the Supabase integration tests, then always removes the players they created.
//
//   npm run test:supabase
//
// The tests sign in disposable anonymous players and record their ids in
// supabase/.temp/integration-users.json. Removing them needs more than a player's own rights, so
// it goes through the Supabase CLI's login (npx supabase login) on the linked project, and only
// touches anonymous users whose ids the run recorded.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const run = (command, args) => spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });

// Extra arguments go to Vitest: npm run test:supabase -- --reporter=verbose
const tests = run('npx', ['vitest', 'run', '--config', 'vitest.supabase.config.mts', ...process.argv.slice(2)]);

const record = 'supabase/.temp/integration-users.json';
if (existsSync(record)) {
  const ids = JSON.parse(readFileSync(record, 'utf8')).filter((id) => /^[0-9a-f-]{36}$/.test(id));
  if (ids.length) {
    const list = ids.map((id) => `'${id}'`).join(', ');
    console.log(`\nRemoving ${ids.length} test players and their couples...`);
    // Couples first (their rooms, progress and members go with them), then the players.
    const couples = run('npx', ['supabase', 'db', 'query', '--linked', `"delete from public.couples c where exists (select 1 from public.couple_members m where m.couple_id = c.id and m.user_id in (${list})) and not exists (select 1 from public.couple_members m where m.couple_id = c.id and m.user_id not in (${list}))"`]);
    const users = run('npx', ['supabase', 'db', 'query', '--linked', `"delete from auth.users where is_anonymous and id in (${list})"`]);
    if (couples.status === 0 && users.status === 0) rmSync(record);
    else console.error('Cleanup failed; the ids are still in', record);
  }
}

process.exit(tests.status ?? 1);
