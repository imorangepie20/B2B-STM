import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
const require = createRequire(import.meta.url);
const { readConfig } = require('../../apps/api/dist/config.js');
const { createApplication } = require('../../apps/api/dist/application.js');

async function withPingServer(reply,run){
  const server=createServer(socket=>{
    let request=Buffer.alloc(0);
    socket.on('data',data=>{request=Buffer.concat([request,data]);const end=request.indexOf(0);if(end>=0&&request.subarray(0,end+1).equals(Buffer.from('zPING\0')))socket.end(`${reply}\0`);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run(server.address().port);}finally{await new Promise(resolve=>server.close(resolve));}
}

test('config rejects missing database and invalid ports without exposing secrets', () => {
  assert.throws(() => readConfig({}), /DATABASE_URL/);
  for (const port of ['abc', '-1', '65536', '1.5']) {
    assert.throws(() => readConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL, API_PORT: port }), /API_PORT/);
  }
  assert.throws(() => readConfig({ DATABASE_URL: 'postgres://user:secret@localhost/property_manager' }), /B2B database/);
  const performanceUrl = 'postgresql://user:secret@127.0.0.1:5432/b2b_stm_perf';
  assert.throws(() => readConfig({ DATABASE_URL: performanceUrl }), /performance/i);
  assert.equal(readConfig({ DATABASE_URL: performanceUrl, NODE_ENV: 'performance' }).databaseUrl, performanceUrl);
  assert.throws(() => readConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL, SMTP_URL: 'smtps://smtp.example.test' }), /MAIL_FROM/);
  const productionUrl = new URL(process.env.TEST_DATABASE_URL); productionUrl.pathname='/b2b_stm';
  assert.throws(() => readConfig({ DATABASE_URL: productionUrl.toString(), NODE_ENV: 'production', APP_ORIGIN: 'https://stm.example.test', CSRF_SECRET: 'a'.repeat(64) }), /SMTP/);
  const production={ DATABASE_URL:productionUrl.toString(),NODE_ENV:'production',APP_ORIGIN:'https://stm.example.test',CSRF_SECRET:'a'.repeat(64),SMTP_URL:'smtps://smtp.example.test',MAIL_FROM:'STM <no-reply@example.test>' };
  assert.throws(()=>readConfig(production),/CLAMAV_HOST/);
  assert.deepEqual(readConfig({...production,CLAMAV_HOST:'clamav'}).attachmentScanner,{host:'clamav',port:3310,timeoutMs:5000});
  assert.throws(()=>readConfig({DATABASE_URL:process.env.TEST_DATABASE_URL,ATTACHMENT_SCAN_MODE:'clamav',CLAMAV_HOST:'clamav',CLAMAV_PORT:'0'}),/CLAMAV_PORT/);
  assert.equal(readConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL, MAIL_TRANSPORT: 'json', MAIL_FROM: 'STM <no-reply@example.test>' }).mail?.transport, 'json');
});

test('real Nest HTTP health, database readiness, unknown route and DB outage', async () => {
  const app = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    assert.deepEqual(await (await fetch(`${base}/api/health/live`)).json(), { status: 'ok' });
    const ready = await fetch(`${base}/api/health/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'ok' });
    assert.equal((await fetch(`${base}/api/not-a-route`)).status, 404);
  } finally { await app.close(); }
  const unreachable = new URL(process.env.TEST_DATABASE_URL);
  unreachable.port = '1';
  const failed = await createApplication({ DATABASE_URL: unreachable.toString() });
  try {
    await failed.listen(0, '127.0.0.1');
    const response = await fetch(`${await failed.getUrl()}/api/health/ready`);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert(!body.includes(unreachable.password));
    assert(!body.includes('postgresql://'));
  } finally { await failed.close(); }
});

test('readiness requires a healthy configured attachment scanner',async()=>{
  for(const [reply,status] of [['PONG',200],['UNKNOWN',503]])await withPingServer(reply,async port=>{
    const app=await createApplication({DATABASE_URL:process.env.TEST_DATABASE_URL,ATTACHMENT_SCAN_MODE:'clamav',CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:String(port),CLAMAV_TIMEOUT_MS:'500'});
    try{await app.listen(0,'127.0.0.1');assert.equal((await fetch(`${await app.getUrl()}/api/health/ready`)).status,status);}finally{await app.close();}
  });
});

test('API emits a server request ID and a safe structured completion log', async () => {
  const lines = [];
  const originalLog = console.log;
  console.log = value => lines.push(String(value));
  const app = await createApplication({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  try {
    await app.listen(0, '127.0.0.1');
    const supplied = 'client-controlled-request-id';
    const response = await fetch(`${await app.getUrl()}/api/health/live?ignored=secret`, { headers: { 'x-request-id': supplied } });
    assert.equal(response.status, 200);
    const requestId = response.headers.get('x-request-id');
    assert.match(requestId, /^[0-9a-f-]{36}$/i);
    assert.notEqual(requestId, supplied);
    const entry = lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).find(value => value?.requestId === requestId);
    assert(entry);
    assert.deepEqual(Object.keys(entry).sort(), ['durationMs','level','method','requestId','route','status','timestamp'].sort());
    assert.equal(entry.route, '/api/health/live');
    assert.equal(entry.status, 200);
    assert.equal(JSON.stringify(entry).includes('ignored'), false);
    assert.equal(JSON.stringify(entry).includes('cookie'), false);
  } finally {
    console.log = originalLog;
    await app.close();
  }
});

test('unexpected API errors log classification without the exception message', () => {
  const { SafeExceptionFilter } = require('../../apps/api/dist/observability/request-observability.js');
  const lines = [];
  const originalError = console.error;
  console.error = value => lines.push(String(value));
  let status;
  let body;
  const response = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
  const host = { switchToHttp: () => ({ getRequest: () => ({ res: { locals: { requestId: 'request-1' } } }), getResponse: () => response }) };
  try {
    new SafeExceptionFilter().catch(new Error('postgresql://user:secret@example.test/b2b_stm'), host);
  } finally { console.error = originalError; }
  assert.equal(status, 500);
  assert.deepEqual(body, { statusCode: 500, message: 'Internal server error' });
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.requestId, 'request-1');
  assert.equal(entry.errorClass, 'Error');
  assert.equal(lines[0].includes('postgresql://'), false);
  assert.equal(lines[0].includes('secret'), false);
});
