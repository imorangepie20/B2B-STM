export const API_CONFIG = Symbol('API_CONFIG');
export interface ApiConfig { databaseUrl: string; port: number; host: string; origin: string; secureCookies: boolean; csrfSecret?: string; mfaKey?: string; notificationWorkerEnabled:boolean; mail?: { transport: 'smtp'|'json'; smtpUrl?: string; from: string }; attachmentScanner?: { host:string; port:number; timeoutMs:number } }

export function readConfig(env: NodeJS.ProcessEnv): ApiConfig {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  let url: URL;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL is invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password) {
    throw new Error('DATABASE_URL must contain PostgreSQL credentials');
  }
  if (url.pathname === '/b2b_stm_perf' && env.NODE_ENV !== 'performance') throw new Error('Performance database requires NODE_ENV=performance');
  if (!['/b2b_stm', '/b2b_stm_test', '/b2b_stm_perf'].includes(url.pathname)) throw new Error('A B2B database is required');
  if (env.NODE_ENV === 'production' && url.pathname === '/b2b_stm_test') throw new Error('Production cannot use test database');
  if (env.NODE_ENV === 'production' && url.pathname === '/b2b_stm_perf') throw new Error('Production cannot use performance database');
  const value = env.API_PORT ?? '3200';
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) throw new Error('API_PORT must be 1..65535');
  const production = env.NODE_ENV === 'production';
  const origin = env.APP_ORIGIN ?? (production ? '' : 'http://127.0.0.1:3100');
  let parsedOrigin: URL;
  try { parsedOrigin = new URL(origin); } catch { throw new Error('APP_ORIGIN is required and must be an origin'); }
  if (parsedOrigin.origin !== origin || !['http:', 'https:'].includes(parsedOrigin.protocol) || (production && parsedOrigin.protocol !== 'https:')) {
    throw new Error('APP_ORIGIN must be an exact HTTP origin (HTTPS in production)');
  }
  if ((production || env.CSRF_SECRET !== undefined) && !/^[a-fA-F0-9]{64,}$/.test(env.CSRF_SECRET ?? '')) {
    throw new Error('CSRF_SECRET must contain at least 32 random bytes encoded as hex');
  }
  if (env.MFA_ENCRYPTION_KEY !== undefined && !/^[a-fA-F0-9]{64}$/.test(env.MFA_ENCRYPTION_KEY)) throw new Error('MFA_ENCRYPTION_KEY must be 32 bytes in hex');
  const wantsMail = env.SMTP_URL !== undefined || env.MAIL_FROM !== undefined || env.MAIL_TRANSPORT !== undefined;
  if (production && (!env.SMTP_URL || !env.MAIL_FROM)) throw new Error('Production SMTP_URL and MAIL_FROM are required');
  if (wantsMail && !env.MAIL_FROM?.trim()) throw new Error('MAIL_FROM is required for email delivery');
  const transport = env.MAIL_TRANSPORT ?? (env.SMTP_URL ? 'smtp' : undefined);
  if (transport && !['smtp','json'].includes(transport)) throw new Error('MAIL_TRANSPORT must be smtp or json');
  if (transport === 'smtp' && !env.SMTP_URL) throw new Error('SMTP_URL is required');
  if (transport === 'json' && production) throw new Error('JSON mail transport is unavailable in production');
  if (env.SMTP_URL) { const smtp = new URL(env.SMTP_URL); if (!['smtp:','smtps:'].includes(smtp.protocol)) throw new Error('SMTP_URL must use smtp or smtps'); }
  const mail = transport ? { transport: transport as 'smtp'|'json', smtpUrl: env.SMTP_URL, from: env.MAIL_FROM!.trim() } : undefined;
  if(env.NOTIFICATION_WORKER_ENABLED!==undefined&&!['true','false'].includes(env.NOTIFICATION_WORKER_ENABLED))throw new Error('NOTIFICATION_WORKER_ENABLED must be true or false');
  const notificationWorkerEnabled=env.NOTIFICATION_WORKER_ENABLED?env.NOTIFICATION_WORKER_ENABLED==='true':production;
  const scanMode=env.ATTACHMENT_SCAN_MODE??(production?'clamav':'disabled');
  if(!['disabled','clamav'].includes(scanMode))throw new Error('ATTACHMENT_SCAN_MODE must be disabled or clamav');
  if(production&&scanMode!=='clamav')throw new Error('Production attachment scanning must use clamav');
  let attachmentScanner:ApiConfig['attachmentScanner'];
  if(scanMode==='clamav'){
    const scannerHost=env.CLAMAV_HOST?.trim();
    if(!scannerHost||scannerHost.includes('://'))throw new Error('CLAMAV_HOST is required and must not contain a protocol');
    const scannerPortValue=env.CLAMAV_PORT??'3310',scannerPort=Number(scannerPortValue);
    if(!/^\d+$/.test(scannerPortValue)||scannerPort<1||scannerPort>65535)throw new Error('CLAMAV_PORT must be 1..65535');
    const timeoutValue=env.CLAMAV_TIMEOUT_MS??'5000',timeoutMs=Number(timeoutValue);
    if(!/^\d+$/.test(timeoutValue)||timeoutMs<100||timeoutMs>30000)throw new Error('CLAMAV_TIMEOUT_MS must be 100..30000');
    attachmentScanner={host:scannerHost,port:scannerPort,timeoutMs};
  }
  return { databaseUrl: env.DATABASE_URL, port, host: env.API_HOST ?? '127.0.0.1', origin, secureCookies: parsedOrigin.protocol === 'https:', csrfSecret: env.CSRF_SECRET, mfaKey: env.MFA_ENCRYPTION_KEY, notificationWorkerEnabled, mail, attachmentScanner };
}
