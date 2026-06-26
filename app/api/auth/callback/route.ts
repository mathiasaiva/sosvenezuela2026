import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { signToken, createTokenCookie } from '@/lib/auth';

// Cookie de nonce de un solo uso — se limpia siempre al salir de esta ruta.
const clearStateCookie = () =>
  `oauth_state=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/api/auth${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');

  // Patch: Igual que en google/route.ts: no usar el header Host.
  const base = process.env.NEXT_PUBLIC_BASE_URL;
  if (!base) throw new Error('NEXT_PUBLIC_BASE_URL no está definida');

  // Patch: Verificar el nonce antes de hacer algo mas.
  const stored = req.cookies.get('oauth_state')?.value ?? '';
  const [expectedNonce, encodedRedirect] = stored.split('|');

  if (!state || !expectedNonce || state !== expectedNonce) {
    const res = NextResponse.redirect(new URL('/login?error=csrf', base));
    res.headers.set('Set-Cookie', clearStateCookie());
    return res;
  }

  // La redirección viene de nuestra cookie, no del parámetro URL.
  const redirect = encodedRedirect ? decodeURIComponent(encodedRedirect) : '/';

  if (!code) {
    const res = NextResponse.redirect(new URL('/login?error=no_code', base));
    res.headers.set('Set-Cookie', clearStateCookie());
    return res;
  }

  try {
    // Intercambiar código por tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${base}/api/auth/callback`,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      const res = NextResponse.redirect(new URL('/login?error=token_fail', base));
      res.headers.set('Set-Cookie', clearStateCookie());
      return res;
    }

    // Obtener datos del usuario
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const googleUser = await userRes.json();
    const { email, name } = googleUser;
    if (!email) {
      const res = NextResponse.redirect(new URL('/login?error=no_email', base));
      res.headers.set('Set-Cookie', clearStateCookie());
      return res;
    }

    // Upsert usuario
    const dbRes = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, 'google-oauth', $2, 'citizen')
       ON CONFLICT (email) DO UPDATE SET full_name = COALESCE(users.full_name, $2)
       RETURNING id, email, role`,
      [email.toLowerCase(), name || null]
    );
    const user = dbRes.rows[0];
    const token = signToken({ id: user.id, email: user.email, role: user.role });

    const headers = new Headers();
    headers.append('Set-Cookie', createTokenCookie(token));
    headers.append('Set-Cookie', clearStateCookie()); // limpiar nonce
    headers.append('Location', redirect.startsWith('/') ? redirect : '/');
    return new Response(null, { status: 302, headers });

  } catch (e) {
    console.error('[google-callback]', e);
    const res = NextResponse.redirect(new URL('/login?error=server', base));
    res.headers.set('Set-Cookie', clearStateCookie());
    return res;
  }
}