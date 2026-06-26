
import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';

export async function GET(req: NextRequest) {
  const redirect = req.nextUrl.searchParams.get('redirect') || '/';

  // Patch: Falla al arrancar si la variable no está definida.
  const base = process.env.NEXT_PUBLIC_BASE_URL;
  if (!base) throw new Error('NEXT_PUBLIC_BASE_URL no está definida');

  // Patch contra CSFR: Nonce criptográfico de un solo uso.
  const nonce = randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${base}/api/auth/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state: nonce,
  });

  // Guardamos nonce + redirect juntos en una cookie HttpOnly de 10 minutos.
  // El callback leerá de aquí, nunca del parámetro state que llega por URL.
  const cookieValue = `${nonce}|${encodeURIComponent(redirect)}`;
  const res = new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'Set-Cookie': `oauth_state=${cookieValue}; HttpOnly; SameSite=Lax; Max-Age=600; Path=/api/auth${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    },
  });
  return res;
}