'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import BottomNav from '@/components/BottomNav';
import Link from 'next/link';

interface Article { id: string; title: string; url: string; source: string | null; summary: string | null; published_at: string | null }

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

export default function NoticiasPage() {
  const [news, setNews] = useState<Article[] | null>(null);
  useEffect(() => { fetch('/api/news').then(r => r.json()).then(d => setNews(Array.isArray(d) ? d : [])).catch(() => setNews([])); }, []);

  return (
    <div className="min-h-screen pb-24" style={{ background: 'var(--bg)' }}>
      <div className="max-w-2xl mx-auto px-4 pt-8">
        <Link href="/" className="text-sm font-medium" style={{ color: 'var(--primary)' }}>← Inicio</Link>
        <h1 className="font-display text-2xl font-bold mt-3 mb-1 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>📰 Noticias</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
          Cobertura de prensa sobre el terremoto, actualizada automáticamente. Toca una nota para leer la fuente original.
        </p>

        {news === null ? (
          <div className="text-center py-16 text-sm" style={{ color: 'var(--text-3)' }}>Cargando…</div>
        ) : news.length === 0 ? (
          <div className="text-center py-16"><div className="text-4xl mb-3">📰</div><p style={{ color: 'var(--text-2)' }}>Sin noticias por ahora.</p></div>
        ) : (
          <div className="space-y-3">
            {news.map((a, i) => (
              <motion.a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.4) }}
                className="block rounded-2xl p-4 transition-transform hover:scale-[1.01]"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
                <div className="flex items-center gap-2 mb-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {a.source && <span className="font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(13,148,136,0.1)', color: 'var(--primary)' }}>{a.source}</span>}
                  <span>{timeAgo(a.published_at)}</span>
                </div>
                <div className="font-display font-bold text-[15px] leading-snug mb-1" style={{ color: 'var(--text-1)' }}>{a.title}</div>
                {a.summary && <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-2)' }}>{a.summary}</p>}
                <div className="text-[11px] font-semibold mt-1.5" style={{ color: 'var(--primary)' }}>Leer en la fuente ↗</div>
              </motion.a>
            ))}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
