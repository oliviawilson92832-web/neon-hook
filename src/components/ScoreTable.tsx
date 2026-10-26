import { fmt } from '../game/math';
import type { ScoreEntry } from '../game/storage';
import { cn } from '../utils/cn';

interface Props {
  scores: ScoreEntry[];
  highlight?: number;
}

const rankColor = ['text-amber-300', 'text-slate-200', 'text-orange-300'];

export function ScoreTable({ scores, highlight = -1 }: Props) {
  if (!scores.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <div className="font-display text-sm font-bold tracking-[0.2em] text-violet-200/80">NO RECORDS YET</div>
        <div className="text-sm text-white/50">Your first run will light up this board.</div>
      </div>
    );
  }
  return (
    <ol className="space-y-1">
      <li className="grid grid-cols-[1.75rem_1fr_auto] gap-2 px-2 pb-1 font-display text-[9px] font-bold tracking-[0.25em] text-white/35">
        <span>#</span>
        <span>PILOT</span>
        <span className="text-right">SCORE</span>
      </li>
      {scores.map((s, i) => (
        <li
          key={`${s.date}-${i}`}
          className={cn(
            'grid grid-cols-[1.75rem_1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 font-display text-xs transition-colors',
            i === highlight ? 'bg-cyan-400/15 ring-1 ring-cyan-300/70' : i % 2 === 0 ? 'bg-white/[0.03]' : '',
          )}
        >
          <span className={cn('font-black', rankColor[i] ?? 'text-white/50')}>{i + 1}</span>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={cn('truncate font-bold tracking-wider', i === highlight ? 'neon-cyan' : 'text-white/90')}>{s.name}</span>
            <span className="shrink-0 font-body text-[11px] text-white/40">
              {fmt(s.meters)}m · {s.gems}◆
            </span>
          </span>
          <span className={cn('text-right font-black tabular-nums', i === highlight ? 'neon-cyan' : i < 3 ? 'text-white' : 'text-white/75')}>
            {fmt(s.score)}
          </span>
        </li>
      ))}
    </ol>
  );
}
