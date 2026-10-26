import type { RefObject } from 'react';
import type { HudEls } from '../game/engine';
import { MuteIcon, PauseIcon, SoundIcon } from './icons';

interface Props {
  els: RefObject<HudEls>;
  visible: boolean;
  soundOn: boolean;
  onPause: () => void;
  onToggleSound: () => void;
}

/**
 * The HUD is plain DOM whose text/transforms are written directly by the engine every frame
 * (no React re-renders during gameplay).
 */
export function Hud({ els, visible, soundOn, onPause, onToggleSound }: Props) {
  const set = (key: keyof HudEls) => (el: HTMLElement | null) => {
    if (els.current) els.current[key] = el;
  };
  return (
    <div
      className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      aria-hidden={!visible}
    >
      <div className="safe-top safe-x absolute inset-x-0 top-0 flex items-start justify-between gap-2">
        {/* score */}
        <div className="min-w-0 flex-1">
          <div className="font-display text-[9px] font-bold tracking-[0.35em] text-cyan-200/70 sm:text-[10px]">SCORE</div>
          <div ref={set('score')} className="origin-left font-display text-[26px] leading-tight font-black tabular-nums neon-cyan sm:text-4xl">
            0
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 font-display text-[10px] font-bold tracking-wider sm:text-xs">
            <span ref={set('dist')} className="text-fuchsia-200/90">
              0 m
            </span>
            <span className="text-white/45">
              BEST{' '}
              <span ref={set('best')} className="text-amber-200/90">
                0
              </span>
            </span>
          </div>
        </div>

        {/* multiplier + overdrive meter */}
        <div className="flex flex-col items-center pt-0.5">
          <div ref={set('mult')} data-level="1" className="hud-mult font-display text-2xl leading-none font-black sm:text-3xl">
            x1
          </div>
          <div className="mt-1.5 h-1 w-16 overflow-hidden rounded-full bg-white/10 sm:w-24">
            <div ref={set('multBar')} className="h-full w-full origin-left bg-cyan-300 shadow-[0_0_8px_#3cf2ff]" style={{ transform: 'scaleX(0)' }} />
          </div>
          <div
            ref={set('energyWrap')}
            data-od="0"
            className="energy-wrap mt-2 h-2.5 w-28 overflow-hidden rounded-sm border border-amber-300/40 bg-black/40 sm:w-40"
          >
            <div
              ref={set('energy')}
              className="energy-fill h-full w-full origin-left bg-gradient-to-r from-amber-300 via-orange-400 to-fuchsia-500"
              style={{ transform: 'scaleX(0)' }}
            />
          </div>
          <div className="mt-0.5 font-display text-[8px] font-bold tracking-[0.3em] text-amber-200/60">OVERDRIVE</div>
        </div>

        {/* buttons */}
        <div className="pointer-events-auto flex flex-1 justify-end gap-2">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onToggleSound}
            className="btn-ghost grid h-10 w-10 place-items-center rounded-lg"
            aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
          >
            {soundOn ? <SoundIcon /> : <MuteIcon />}
          </button>
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              onPause();
            }}
            onClick={(e) => {
              if (e.detail === 0) onPause();
            }}
            className="btn-ghost grid h-10 w-10 place-items-center rounded-lg"
            aria-label="Pause"
          >
            <PauseIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
