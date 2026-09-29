import { NextResponse, type NextRequest } from 'next/server';

// Two optional locks for a public deployment. Both are off when their variables are unset (local dev).
// SITE_PASSWORD: the browser asks for a password once (HTTP Basic auth, any user name).
// BACKEND_KEY: sent to the backend on every /api request; the backend rejects requests without it.

const sameText = (a: string, b: string) => {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
};

// A family opens their receipt without the site password. The unguessable token in the link is the key.
const isReceipt = (path: string) => /^\/r\/[\w-]+$/.test(path) || /^\/api\/receipts\/[\w-]+(\/confirm)?$/.test(path);

export function proxy(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (password && !isReceipt(req.nextUrl.pathname)) {
    const auth = req.headers.get('authorization') ?? '';
    let given = '';
    try {
      given = auth.startsWith('Basic ') ? atob(auth.slice(6)).split(':').slice(1).join(':') : '';
    } catch {
      given = '';
    }
    if (!sameText(given, password)) {
      return new NextResponse('Password required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Ansim", charset="UTF-8"' } });
    }
  }

  if (req.nextUrl.pathname.startsWith('/api/')) {
    const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
    const headers = new Headers(req.headers);
    headers.delete('authorization'); // the site password stays here
    if (process.env.BACKEND_KEY) headers.set('x-ansim-key', process.env.BACKEND_KEY);
    return NextResponse.rewrite(new URL(req.nextUrl.pathname + req.nextUrl.search, backend), { request: { headers } });
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'] };
