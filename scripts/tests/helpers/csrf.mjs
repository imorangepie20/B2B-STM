import assert from 'node:assert/strict';

export const origin = 'http://127.0.0.1:3100';
export async function csrfHeaders(base, sessionCookie = '') {
  const response = await fetch(`${base}/api/auth/csrf`, { headers: { cookie: sessionCookie } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { csrfToken } = await response.json();
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  return { origin, 'x-csrf-token': csrfToken, cookie: [sessionCookie, cookie].filter(Boolean).join('; ') };
}
