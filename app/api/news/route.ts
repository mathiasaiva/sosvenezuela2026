import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// Feed público de noticias del terremoto (alimentado por scripts/newsfeed.cjs).
export async function GET() {
  const r = await pool.query(
    `SELECT id, title, url, source, summary, image_url, published_at
     FROM news_articles
     ORDER BY COALESCE(published_at, created_at) DESC
     LIMIT 60`
  );
  return NextResponse.json(r.rows, { headers: { 'Cache-Control': 'public, max-age=60' } });
}
