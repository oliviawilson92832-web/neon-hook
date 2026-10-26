import { useEffect, useState, type PointerEvent as RPointerEvent } from 'react';
import type { RunResult } from '../game/engine';
import { fmt } from '../game/math';
import type { ScoreEntry } from '../game/storage';
import { Kbd } from './Menu';
import { ScoreTable } from './ScoreTable';

export type AdState = 'idle' | 'pending' | 'playing' | 'error';

interface Props {
  result: RunResult;
  scores: ScoreEntry[];
  touch: boolean;
  /** Rewarded revive may be offered (SDK ready, run long enough, none used yet). */
  reviveOffered: boolean;
  /** Milliseconds left before another rewarded ad may be requested. */
  reviveCooldown: number;
  adState: AdState;
  adMessage: string;
  onRevive: () => void;
  onRetryPointer: (e: RPointerEvent) => void;
  onRetryKey: () => void;
  onMenu: () => void;
}

const CAUSE: Record<RunResult['cause'], string> = {
  laser: 'VAPORIZED BY A LASER',
  void: 'SWALLOWED BY THE VOID',
  wall: 'PURGED BY THE FIREWALL',
};

function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(target * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Live countdown so the player knows when a revive can be requested again. */
function useCooldown(initialMs: number) {
  const [left, setLeft] = useState(initialMs);
  useEffect(() => {
    setLeft(initialMs);
    if (initialMs <= 0) return;
    const end = Date.now() + initialMs;
    const id = window.setInterval(() => {
      const ms = end - Date.now();
      setLeft(ms > 0 ? ms : 0);
      if (ms <= 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [initialMs]);
  return left;
}

export function GameOver({
  result,
  scores,
  touch,
  reviveOffered,
  reviveCooldown,
  adState,
  adMessage,
  onRevive,
  onRetryPointer,
  onRetryKey,
  onMenu,
}: Props) {
  const shown = useCountUp(result.score);
  const cooldownLeft = useCooldown(reviveCooldown);
  const busy = adState === 'pending' || adState === 'playing';
  const cooling = cooldownLeft > 0;
  // Once an ad errors we don't nag the player with the button again this screen.
  const showRevive = reviveOffered && adState !== 'error';

  const stats: [string, string][] = [
    ['DISTANCE', `${fmt(result.meters)} m`],
    ['GEMS', fmt(result.gems)],
    ['NEAR MISSES', fmt(result.nearMisses)],
    ['PERFECT FLINGS', fmt(result.perfects)],
    ['BEST MULTI', `x${result.maxMult}`],
    ['TIME', `${result.time.toFixed(1)} s`],
  ];

  return (
    <div
      className="fade-in scroll-thin absolute inset-0 overflow-y-auto bg-gradient-to-b from-[#16020f]/85 via-[#0b0320]/70 to-[#05010f]/90"
      onPointerDown={(e) => {
        // Never let a stray tap eat the revive offer or interrupt an ad.
        if (showRevive || busy) return;
        const el = e.target as HTMLElement;
        if (el.closest('button, a, input, [data-noretry]')) return;
        onRetryPointer(e);
      }}
    >
      <div className="go-wrap safe-x mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center gap-6 py-8 lg:flex-row lg:gap-12">
        <div className="go-left rise-in flex flex-col items-center text-center lg:flex-1">
          <div className="font-display text-[10px] font-bold tracking-[0.45em] text-rose-300/85 sm:text-xs">{CAUSE[result.cause]}</div>
          <h2 className="go-title glitch mt-2 font-display text-5xl font-black neon-red sm:text-7xl" data-text="SIGNAL LOST">
            SIGNAL LOST
          </h2>

          <div className="go-badge mt-4 h-8">
            {result.isBest ? (
              <div className="pop-in inline-block rounded-full border border-amber-300/80 bg-amber-300/10 px-4 py-1 font-display text-xs font-bold tracking-[0.3em] neon-gold">
                ★ NEW HIGH SCORE ★
              </div>
            ) : result.rank >= 0 ? (
              <div className="pop-in inline-block rounded-full border border-cyan-300/70 bg-cyan-300/10 px-4 py-1 font-display text-xs font-bold tracking-[0.3em] neon-cyan">
                RANK #{result.rank + 1} ON THE BOARD
              </div>
            ) : (
              <div className="font-display text-xs font-bold tracking-[0.25em] text-white/45">
                BEST {fmt(Math.max(result.prevBest, result.score))}
              </div>
            )}
          </div>

          <div className="short-hide mt-3 font-display text-[10px] font-bold tracking-[0.45em] text-white/50">FINAL SCORE</div>
          <div className="go-score font-display text-6xl font-black tabular-nums neon-cyan sm:text-7xl">{fmt(shown)}</div>

          <div className="short-tight mt-5 grid w-full max-w-md grid-cols-3 gap-2">
            {stats.map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2">
                <div className="font-display text-[8px] font-bold tracking-[0.2em] text-white/45 sm:text-[9px]">{k}</div>
                <div className="font-display text-sm font-black text-white sm:text-base">{v}</div>
              </div>
            ))}
          </div>

          {/* Actions. Revive and Retry are deliberately identical in size, font
              and colour — CrazyGames requires the free option to be as
              prominent as the rewarded one. */}
          <div className="short-tight mt-6 w-full max-w-md">
            {showRevive ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={busy || cooling}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={onRevive}
                    className="btn-neon relative rounded-xl px-4 py-3.5 text-lg disabled:cursor-not-allowed disabled:opacity-45 sm:text-xl"
                  >
                    {cooling ? `REVIVE ${Math.ceil(cooldownLeft / 1000)}s` : '▶ REVIVE'}
                    {!cooling && (
                      <span className="absolute -top-2 -right-2 rounded-full border border-cyan-200/80 bg-[#0b0320] px-1.5 py-0.5 font-display text-[9px] font-bold tracking-widest text-cyan-100">
                        AD
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (!busy) onRetryPointer(e);
                    }}
                    onClick={(e) => {
                      if (e.detail === 0 && !busy) onRetryKey();
                    }}
                    className="btn-neon rounded-xl px-4 py-3.5 text-lg disabled:cursor-not-allowed disabled:opacity-45 sm:text-xl"
                  >
                    ↻ RETRY
                  </button>
                </div>
                <p className="mt-2.5 text-[12px] leading-snug text-white/55">
                  {cooling
                    ? 'Revive is recharging — Retry starts a fresh run for free.'
                    : 'Watch a short ad to continue this run with your score and a shield. Retry is always free.'}
                </p>
              </>
            ) : (
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onRetryPointer(e);
                  }}
                  onClick={(e) => {
                    if (e.detail === 0) onRetryKey();
                  }}
                  className="btn-neon btn-pink pulse-glow rounded-xl px-10 py-3.5 text-xl"
                >
                  ↻ RETRY
                </button>
                <button type="button" onClick={onMenu} className="btn-ghost rounded-xl px-6 py-3.5 text-sm">
                  MENU
                </button>
              </div>
            )}
          </div>

          {adState === 'error' && adMessage && (
            <div className="pop-in mt-3 max-w-md rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-100">
              {adMessage}
            </div>
          )}

          {showRevive && (
            <button type="button" onClick={onMenu} disabled={busy} className="btn-ghost mt-3 rounded-xl px-6 py-2 text-xs disabled:opacity-45">
              MENU
            </button>
          )}

          <div className="kbd-hint mt-3 text-xs text-white/50">
            {touch ? (
              showRevive ? (
                'Choose Revive or Retry above'
              ) : (
                'Tap anywhere to retry instantly'
              )
            ) : showRevive ? (
              <>
                Press <Kbd>R</Kbd> for a fresh run
              </>
            ) : (
              <>
                Press <Kbd>SPACE</Kbd> or click anywhere to retry
              </>
            )}
          </div>
        </div>

        <div className="go-panel panel rise-in scroll-thin w-full max-w-md rounded-2xl p-4 sm:p-5 lg:flex-1" style={{ animationDelay: '100ms' }} data-noretry>
          <div className="mb-3 flex items-center justify-between">
            <div className="font-display text-xs font-bold tracking-[0.3em] text-violet-200/85">LOCAL LEGENDS</div>
            <div className="font-display text-[9px] font-bold tracking-[0.2em] text-white/35">TOP 10</div>
          </div>
          <ScoreTable scores={scores} highlight={result.rank} />
        </div>
      </div>

      {/* Blocking overlay: no input may reach the game while an ad is in flight. */}
      {busy && (
        <div className="fade-in absolute inset-0 z-10 grid place-items-center bg-[#05010f]/80 backdrop-blur-sm" onPointerDown={(e) => e.stopPropagation()}>
          <div className="flex flex-col items-center gap-4">
            <div className="spinner" />
            <div className="font-display text-sm font-bold tracking-[0.3em] neon-cyan">
              {adState === 'playing' ? 'AD PLAYING' : 'LOADING AD'}
            </div>
            <div className="text-xs text-white/55">{adState === 'playing' ? 'Your revive is on the way…' : 'Hang tight…'}</div>
          </div>
        </div>
      )}
    </div>
  );
}
