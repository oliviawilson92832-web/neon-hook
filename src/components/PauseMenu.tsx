import type { PointerEvent as RPointerEvent } from 'react';
import type { Settings } from '../game/storage';
import { Kbd } from './Menu';
import { Toggles } from './Toggles';

interface Props {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onResume: () => void;
  onRestartPointer: (e: RPointerEvent) => void;
  onRestartKey: () => void;
  onMenu: () => void;
}

export function PauseMenu({ settings, onSettings, onResume, onRestartPointer, onRestartKey, onMenu }: Props) {
  return (
    <div className="fade-in scroll-thin absolute inset-0 overflow-y-auto bg-[#05010f]/70">
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="pause-panel panel rise-in w-full max-w-sm rounded-2xl p-6 text-center">
        <div className="font-display text-[10px] font-bold tracking-[0.5em] text-violet-200/70">SYSTEM HALTED</div>
        <h2 className="mt-1 font-display text-5xl font-black neon-cyan">PAUSED</h2>
        <div className="pause-actions mt-6 flex flex-col gap-3">
          <button type="button" autoFocus className="btn-neon rounded-xl py-3 text-lg" onClick={onResume}>
            ▶ RESUME
          </button>
          <button
            type="button"
            className="btn-ghost rounded-xl py-3 text-sm"
            onPointerDown={onRestartPointer}
            onClick={(e) => {
              if (e.detail === 0) onRestartKey();
            }}
          >
            ↻ RESTART RUN
          </button>
          <button type="button" className="btn-ghost rounded-xl py-3 text-sm" onClick={onMenu}>
            ⌂ MAIN MENU
          </button>
        </div>
        <Toggles settings={settings} onChange={onSettings} className="short-tight mt-5 justify-center" />
        <p className="kbd-hint short-hide mt-4 text-xs text-white/50">
          <Kbd>ESC</Kbd> resume · <Kbd>R</Kbd> restart
        </p>
      </div>
      </div>
    </div>
  );
}
