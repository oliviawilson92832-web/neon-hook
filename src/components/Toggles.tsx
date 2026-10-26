import type { Settings } from '../game/storage';
import { cn } from '../utils/cn';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  className?: string;
}

export function Toggles({ settings, onChange, className }: Props) {
  const items: { key: 'sfx' | 'music' | 'shake'; label: string }[] = [
    { key: 'sfx', label: 'SFX' },
    { key: 'music', label: 'MUSIC' },
    { key: 'shake', label: 'SHAKE' },
  ];
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          data-on={settings[it.key]}
          aria-pressed={settings[it.key]}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onChange({ [it.key]: !settings[it.key] })}
          className="chip rounded-full px-3 py-1.5"
        >
          {settings[it.key] ? '● ' : '○ '}
          {it.label}
        </button>
      ))}
    </div>
  );
}
