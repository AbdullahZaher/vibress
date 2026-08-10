import { buildApp } from './main';
async function main() {
  const app = buildApp();
  await app.ready();
  const routes = app.printRoutes().split('\n').filter((l) => l.includes('machine'));
  console.log('MACHINE ROUTES:', routes.join('\n') || 'NONE');
  const res = await app.inject({ method: 'GET', url: '/api/machine/v1/status' });
  console.log('status:', res.statusCode, res.body.slice(0, 100));
  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
