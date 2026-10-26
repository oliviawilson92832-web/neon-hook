import { useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { sanitizeName, type ScoreEntry, type Settings } from '../game/storage';
import { cn } from '../utils/cn';
import { BoltIcon, DangerIcon, FlingIcon, GemIcon, HookIcon } from './icons';
import { ScoreTable } from './ScoreTable';
import { Toggles } from './Toggles';

interface Props {
  scores: ScoreEntry[];
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onPlayPointer: (e: RPointerEvent) => void;
  onPlayKey: () => void;
  onClearScores: () => void;
}

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="mx-0.5 rounded border border-white/25 bg-white/10 px-1.5 py-0.5 font-display text-[10px] font-bold tracking-wider text-white/85">
    {children}
  </kbd>
);

function HowTo() {
  const rows: { icon: ReactNode; color: string; title: string; text: ReactNode }[] = [
    {
      icon: <HookIcon />,
      color: 'text-cyan-300',
      title: 'HOLD TO GRAPPLE',
      text: (
        <>
          Hold <Kbd>SPACE</Kbd>, click or touch — your hook snaps to the peg with the spinning reticle.
        </>
      ),
    },
    {
      icon: <FlingIcon />,
      color: 'text-fuchsia-300',
      title: 'RELEASE TO FLING',
      text: 'Let go on the upswing. Releasing around 45° gives a PERFECT speed boost.',
    },
    {
      icon: <GemIcon />,
      color: 'text-amber-300',
      title: 'CHAIN FOR MULTIPLIER',
      text: 'Gems, near-misses and new grabs build your combo — up to x8. Stall and it resets.',
    },
    {
      icon: <BoltIcon />,
      color: 'text-yellow-200',
      title: 'OVERDRIVE',
      text: 'Fill the meter with gems: double gem value and smash straight through lasers.',
    },
    {
      icon: <DangerIcon />,
      color: 'text-rose-400',
      title: 'STAY ALIVE',
      text: 'Dodge lasers, never touch the glowing void, and outrun the firewall behind you.',
    },
  ];
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.title} className="flex gap-3">
          <div className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5', r.color)}>{r.icon}</div>
          <div>
            <div className={cn('font-display text-[11px] font-bold tracking-[0.2em]', r.color)}>{r.title}</div>
            <div className="text-[13px] leading-snug text-white/75">{r.text}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Menu({ scores, settings, onSettings, onPlayPointer, onPlayKey, onClearScores }: Props) {
  const [tab, setTab] = useState<'how' | 'scores'>(scores.length ? 'scores' : 'how');
  const [name, setName] = useState(settings.name);
  const [confirmClear, setConfirmClear] = useState(false);

  const commit = () => {
    const clean = sanitizeName(name);
    setName(clean);
    if (clean !== settings.name) onSettings({ name: clean });
  };

  return (
    <div className="fade-in scroll-thin absolute inset-0 overflow-y-auto bg-gradient-to-b from-[#05010f]/85 via-[#0b0320]/45 to-[#05010f]/85">
      <div className="menu-wrap safe-x mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center gap-6 py-8 lg:flex-row lg:gap-14">
        {/* title + play */}
        <div className="menu-left rise-in flex flex-col items-center text-center lg:flex-1">
          <div className="font-display text-[10px] font-bold tracking-[0.5em] text-fuchsia-200/75 sm:text-xs">ARCADE GRAPPLE RUNNER</div>
          <h1 className="menu-title title-flicker mt-3 font-display text-6xl leading-[0.9] font-black sm:text-8xl">
            <span className="neon-cyan">NEON</span>
            <br />
            <span className="neon-pink">HOOK</span>
          </h1>
          <p className="short-hide mt-4 max-w-xs text-sm text-white/70 sm:text-base">
            Swing through a collapsing neon city. Grab, fling, thread the lasers — and outrun the firewall.
          </p>

          <label className="short-tight mt-5 flex items-center gap-3 rounded-lg border border-violet-400/40 bg-black/35 px-3 py-2 focus-within:border-cyan-300/80">
            <span className="font-display text-[10px] font-bold tracking-[0.25em] text-violet-200/75">CALLSIGN</span>
            <input
              value={name}
              maxLength={10}
              spellCheck={false}
              autoComplete="off"
              aria-label="Callsign for the high score table"
              onChange={(e) => setName(e.target.value.toUpperCase())}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commit();
                  e.currentTarget.blur();
                  onPlayKey();
                }
              }}
              className="w-32 bg-transparent font-display text-sm font-bold tracking-widest text-cyan-100 uppercase outline-none placeholder:text-white/30"
              placeholder="PILOT"
            />
          </label>

          <button
            type="button"
            onPointerDown={(e) => {
              commit();
              onPlayPointer(e);
            }}
            onClick={(e) => {
              if (e.detail === 0) onPlayKey();
            }}
            className="play-btn short-tight btn-neon pulse-glow mt-5 rounded-xl px-14 py-4 text-2xl sm:text-3xl"
          >
            ▶ PLAY
          </button>
          <div className="kbd-hint short-tight mt-3 text-xs text-white/55">
            <Kbd>SPACE</Kbd> start · <Kbd>ESC</Kbd> pause · <Kbd>M</Kbd> mute
          </div>
          <div className="short-hide mt-1 text-[11px] text-white/40">Tip: keep holding PLAY to grab the first peg instantly.</div>
          <Toggles settings={settings} onChange={onSettings} className="short-tight mt-4 justify-center" />
        </div>

        {/* info panel */}
        <div className="menu-panel panel rise-in scroll-thin w-full max-w-md rounded-2xl p-4 sm:p-5 lg:flex-1" style={{ animationDelay: '80ms' }}>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {(
              [
                ['how', 'HOW TO PLAY'],
                ['scores', 'HIGH SCORES'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  'rounded-lg py-2 font-display text-[11px] font-bold tracking-[0.2em] transition-colors',
                  tab === id ? 'bg-cyan-400/15 text-cyan-100 ring-1 ring-cyan-300/60' : 'text-white/50 hover:bg-white/5 hover:text-white/80',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'how' ? (
            <HowTo />
          ) : (
            <div>
              <ScoreTable scores={scores} />
              {scores.length > 0 && (
                <div className="mt-3 flex justify-end">
                  {confirmClear ? (
                    <div className="flex items-center gap-2 text-xs text-white/60">
                      Wipe all records?
                      <button
                        type="button"
                        className="rounded border border-rose-400/60 px-2 py-1 font-display text-[10px] font-bold tracking-wider text-rose-300 hover:bg-rose-400/10"
                        onClick={() => {
                          onClearScores();
                          setConfirmClear(false);
                        }}
                      >
                        YES
                      </button>
                      <button
                        type="button"
                        className="rounded border border-white/20 px-2 py-1 font-display text-[10px] font-bold tracking-wider text-white/60 hover:bg-white/5"
                        onClick={() => setConfirmClear(false)}
                      >
                        NO
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="font-display text-[10px] font-bold tracking-[0.2em] text-white/35 hover:text-rose-300"
                      onClick={() => setConfirmClear(true)}
                    >
                      RESET BOARD
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
