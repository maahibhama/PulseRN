import { createSign } from 'node:crypto';
import { connect } from 'node:http2';
import type { RemoteNotificationRequest, RemoteNotificationResult } from '@pulse-rn/api-contract';

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');
function jwt(
  header: { alg: 'ES256' | 'RS256'; kid?: string; typ?: string },
  claims: object,
  privateKey: string,
): string {
  const unsigned = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
  const signature = createSign('SHA256')
    .update(unsigned)
    .sign(header.alg === 'ES256' ? { key: privateKey, dsaEncoding: 'ieee-p1363' } : privateKey);
  return `${unsigned}.${signature.toString('base64url')}`;
}
function safeError(status: number, body: string): { code: string; message: string } {
  try {
    const parsed = JSON.parse(body) as {
      reason?: string;
      error?: { status?: string; message?: string };
    };
    const code = parsed.reason ?? parsed.error?.status ?? `http_${status}`;
    return {
      code,
      message: parsed.error?.message ?? parsed.reason ?? `Provider rejected the push (${status}).`,
    };
  } catch {
    return { code: `http_${status}`, message: `Provider rejected the push (${status}).` };
  }
}

async function sendApns(input: RemoteNotificationRequest): Promise<RemoteNotificationResult> {
  if (input.credentials.provider !== 'apns') throw new Error('APNs credentials are required.');
  const started = Date.now();
  const c = input.credentials;
  const host =
    c.environment === 'production'
      ? 'https://api.push.apple.com'
      : 'https://api.sandbox.push.apple.com';
  const token = jwt(
    { alg: 'ES256', kid: c.keyId },
    { iss: c.teamId, iat: Math.floor(Date.now() / 1000) },
    c.key,
  );
  return new Promise((resolve, reject) => {
    const client = connect(host);
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('APNs request timed out.'));
    }, 15_000);
    client.once('error', reject);
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${encodeURIComponent(input.token)}`,
      authorization: `bearer ${token}`,
      'apns-topic': c.topic,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    });
    let status = 0;
    let body = '';
    req.on('response', (headers) => {
      status = Number(headers[':status'] ?? 0);
    });
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => {
      clearTimeout(timeout);
      client.close();
      const success = status === 200;
      resolve({
        success,
        provider: 'apns',
        status,
        durationMs: Date.now() - started,
        ...(success ? {} : { error: safeError(status, body) }),
      });
    });
    req.end(JSON.stringify(input.payload));
  });
}

async function sendFcm(input: RemoteNotificationRequest): Promise<RemoteNotificationResult> {
  if (input.credentials.provider !== 'fcm') throw new Error('FCM credentials are required.');
  const started = Date.now();
  const account = JSON.parse(input.credentials.serviceAccountJson) as {
    client_email?: string;
    private_key?: string;
    project_id?: string;
    token_uri?: string;
  };
  if (!account.client_email || !account.private_key)
    throw new Error('Service account JSON is missing client_email or private_key.');
  const projectId = input.credentials.projectId || account.project_id;
  if (!projectId) throw new Error('FCM project ID is required.');
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: account.token_uri ?? 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    account.private_key,
  );
  const tokenResponse = await fetch(account.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenResponse.ok)
    return {
      success: false,
      provider: 'fcm',
      status: tokenResponse.status,
      durationMs: Date.now() - started,
      error: {
        code: 'authentication_failed',
        message: 'FCM service-account authentication failed.',
      },
    };
  const access = (await tokenResponse.json()) as { access_token?: string };
  if (!access.access_token) throw new Error('FCM authentication returned no access token.');
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${access.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: { token: input.token, ...input.payload } }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = await response.text();
  if (!response.ok)
    return {
      success: false,
      provider: 'fcm',
      status: response.status,
      durationMs: Date.now() - started,
      error: safeError(response.status, body),
    };
  const parsed = JSON.parse(body) as { name?: string };
  return {
    success: true,
    provider: 'fcm',
    status: response.status,
    durationMs: Date.now() - started,
    messageId: parsed.name,
  };
}

export async function sendRemoteNotification(
  input: RemoteNotificationRequest,
): Promise<RemoteNotificationResult> {
  return input.provider === 'apns' ? sendApns(input) : sendFcm(input);
}
