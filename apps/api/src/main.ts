import { createApplication } from './application';
import { readConfig } from './config';

async function start() {
  const config = readConfig(process.env);
  const app = await createApplication();
  await app.listen(config.port, config.host);
  console.log(`B2B API listening on port ${config.port}`);
}

start().catch(() => {
  console.error('API startup failed. Check configuration and port availability.');
  process.exitCode = 1;
});
