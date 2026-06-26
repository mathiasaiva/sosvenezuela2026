'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';

interface Article { id: string; title: string; url: string; source: string | null; published_at: string | null }

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

export default function NewsSection() {
  const [news, setNews] = useState<Article[]>([]);
  useEffect(() => { fetch('/api/news').then(r => r.json()).then((d: Article[]) => { if (Array.isArray(d)) setNews(d.slice(0, 5)); }).catch(() => {}); }, []);
  if (news.length === 0) return null;

  return (
    <section className="px-4 max-w-6xl mx-auto mb-12">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-xl sm:text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <span>📰</span> Noticias
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(13,148,136,0.1)', color: 'var(--primary)' }}>en vivo</span>
        </h2>
        <Link href="/noticias" className="text-xs font-bold whitespace-nowrap" style={{ color: 'var(--primary)' }}>Ver todas →</Link>
      </div>
      <div className="grid gap-2.5">
        {news.map((a, i) => (
          <motion.a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.05, 0.3) }}
            className="flex items-center gap-3 rounded-2xl px-4 py-3 transition-transform hover:scale-[1.005]"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-snug line-clamp-1" style={{ color: 'var(--text-1)' }}>{a.title}</div>
              <div className="flex items-center gap-2 mt-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
                {a.source && <span className="font-semibold" style={{ color: 'var(--primary)' }}>{a.source}</span>}
                <span>{timeAgo(a.published_at)}</span>
              </div>
            </div>
            <span className="text-xs flex-none" style={{ color: 'var(--text-3)' }}>↗</span>
          </motion.a>
        ))}
      </div>
    </section>
  );
}
