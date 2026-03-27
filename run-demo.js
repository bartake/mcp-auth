/**
 * Run the full auth demo: start all services, then run the agent.
 */
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const services = [];
function start(name, script, port) {
  const p = spawn('node', [script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: new URL('.', import.meta.url).pathname,
  });
  p.stdout?.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr?.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  services.push(p);
  return p;
}

async function main() {
  console.log('Starting services...\n');
  start('auth', 'auth-service.js');
  start('api', 'downstream-api.js');
  start('mcp', 'mcp-server.js');

  await setTimeout(2000);

  console.log('\n--- Running agent demo ---\n');
  const agent = spawn('node', ['agent.js', 'alice', 'pass123'], {
    stdio: 'inherit',
  });
  await new Promise((res, rej) => {
    agent.on('exit', (code) => (code === 0 ? res() : rej(new Error(`agent exit ${code}`))));
  });

  for (const p of services) {
    p.kill('SIGTERM');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  for (const p of services) {
    p.kill('SIGTERM');
  }
  process.exit(1);
});
