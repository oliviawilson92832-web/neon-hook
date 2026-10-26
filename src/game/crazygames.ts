/**
 * Thin, defensive wrapper around the official CrazyGames HTML5 SDK v3.
 *
 * Docs: https://docs.crazygames.com/sdk/intro/
 *   <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
 *   await window.CrazyGames.SDK.init();
 *   window.CrazyGames.SDK.game.gameplayStart() / gameplayStop()
 *   window.CrazyGames.SDK.ad.requestAd("rewarded", { adStarted, adFinished, adError })
 *
 * Every call is guarded: when the SDK script is missing (offline, self-hosting)
 * or the environment is "disabled" (any non-CrazyGames domain), all methods are
 * no-ops so the game stays fully playable.
 */

export type CgEnvironment = 'local' | 'crazygames' | 'disabled';
export type CgAdType = 'midgame' | 'rewarded';

export interface CgAdError {
  code?: string;
  message?: string;
}

interface CgGameModule {
  gameplayStart(): void;
  gameplayStop(): void;
  loadingStart(): void;
  loadingStop(): void;
  happytime(): void;
}

interface CgAdModule {
  requestAd(
    type: CgAdType,
    callbacks: { adStarted?: () => void; adFinished?: () => void; adError?: (e: CgAdError) => void },
  ): void;
  hasAdblock(): Promise<boolean>;
}

interface CgSdk {
  init(): Promise<void>;
  environment: CgEnvironment;
  game: CgGameModule;
  ad: CgAdModule;
}

export interface RewardedHandlers {
  /** The ad actually began playing — mute audio here (not on request). */
  onStarted: () => void;
  /** Ad watched to completion — this is the ONLY place a reward may be granted. */
  onFinished: () => void;
  /** No fill, adblock, cooldown, timeout… — never reward here. */
  onError: (e: CgAdError) => void;
}

/** Ad never started within this window → treat as an error so the UI can't get stuck. */
const AD_START_TIMEOUT = 9000;
/** Hard ceiling in case adFinished/adError never arrive. */
const AD_HARD_TIMEOUT = 180000;
const SDK_WAIT_TIMEOUT = 4000;

function getSdk(): CgSdk | null {
  const w = window as unknown as { CrazyGames?: { SDK?: CgSdk } };
  return w.CrazyGames?.SDK ?? null;
}

class CrazyGamesBridge {
  /** True only when the SDK initialised and the environment is local | crazygames. */
  available = false;
  environment: CgEnvironment | 'missing' = 'missing';
  adblock = false;
  private sdk: CgSdk | null = null;
  private gameplayActive = false;
  private initPromise: Promise<void> | null = null;
  private adInFlight = false;

  get isLocal() {
    return this.environment === 'local';
  }

  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit() {
    try {
      const sdk = await this.waitForSdk();
      if (!sdk) {
        this.environment = 'missing';
        return;
      }
      await sdk.init();
      this.sdk = sdk;
      this.environment = sdk.environment ?? 'disabled';
      this.available = this.environment === 'local' || this.environment === 'crazygames';
      if (this.available) {
        try {
          this.adblock = await sdk.ad.hasAdblock();
        } catch {
          this.adblock = false;
        }
      }
    } catch (e) {
      this.available = false;
      this.environment = 'disabled';
      console.warn('[CrazyGames] SDK init failed, running standalone.', e);
    }
  }

  private waitForSdk(): Promise<CgSdk | null> {
    const existing = getSdk();
    if (existing) return Promise.resolve(existing);
    // The script tag is in <head>, but it may still be in flight (or blocked).
    return new Promise((resolve) => {
      const t0 = Date.now();
      const poll = () => {
        const sdk = getSdk();
        if (sdk) return resolve(sdk);
        if (Date.now() - t0 > SDK_WAIT_TIMEOUT) return resolve(null);
        window.setTimeout(poll, 60);
      };
      poll();
    });
  }

  private safe(fn: (g: CgGameModule) => void) {
    if (!this.available || !this.sdk) return;
    try {
      fn(this.sdk.game);
    } catch (e) {
      console.warn('[CrazyGames] call failed', e);
    }
  }

  // ───────────── loading lifecycle ─────────────
  loadingStart() {
    this.safe((g) => g.loadingStart());
  }
  loadingStop() {
    this.safe((g) => g.loadingStop());
  }

  // ───────────── gameplay lifecycle ─────────────
  /** Idempotent: repeated calls without a matching stop are ignored. */
  gameplayStart() {
    if (this.gameplayActive) return;
    this.gameplayActive = true;
    this.safe((g) => g.gameplayStart());
  }

  /** Idempotent: only fires if gameplay is currently marked active. */
  gameplayStop() {
    if (!this.gameplayActive) return;
    this.gameplayActive = false;
    this.safe((g) => g.gameplayStop());
  }

  /** Positive moment (new record, big win) — helps CrazyGames promotion. */
  happytime() {
    this.safe((g) => g.happytime());
  }

  // ───────────── rewarded ads ─────────────
  get canRequestAd() {
    return this.available && !this.adInFlight && !this.adblock;
  }

  /**
   * Requests a rewarded ad. Exactly one of onFinished / onError is invoked,
   * guarded by watchdog timers so a silent SDK can never strand the player.
   */
  requestRewarded(handlers: RewardedHandlers) {
    if (!this.available || !this.sdk) {
      handlers.onError({ code: 'unavailable', message: 'CrazyGames SDK unavailable' });
      return;
    }
    if (this.adInFlight) {
      handlers.onError({ code: 'inFlight', message: 'An ad is already being requested' });
      return;
    }
    this.adInFlight = true;

    let settled = false;
    let started = false;
    let startTimer = 0;
    let hardTimer = 0;

    const settle = (ok: boolean, err?: CgAdError) => {
      if (settled) return;
      settled = true;
      this.adInFlight = false;
      window.clearTimeout(startTimer);
      window.clearTimeout(hardTimer);
      if (ok) handlers.onFinished();
      else handlers.onError(err ?? { code: 'other', message: 'Ad failed' });
    };

    startTimer = window.setTimeout(() => {
      if (!started) settle(false, { code: 'timeout', message: 'Ad did not start in time' });
    }, AD_START_TIMEOUT);
    hardTimer = window.setTimeout(() => settle(false, { code: 'timeout', message: 'Ad timed out' }), AD_HARD_TIMEOUT);

    try {
      this.sdk.ad.requestAd('rewarded', {
        adStarted: () => {
          started = true;
          window.clearTimeout(startTimer);
          handlers.onStarted();
        },
        adFinished: () => settle(true),
        adError: (e) => settle(false, e),
      });
    } catch (e) {
      settle(false, { code: 'other', message: String(e) });
    }
  }
}

export const cg = new CrazyGamesBridge();

/** Friendly, honest copy for each documented error code. */
export function adErrorMessage(e: CgAdError): string {
  switch (e?.code) {
    case 'adblock':
      return 'Ad blocker detected — turn it off to use revives.';
    case 'unfilled':
      return 'No ad available right now. Try again later.';
    case 'adCooldown':
      return 'Ads are cooling down. Try again in a moment.';
    case 'adsDisabledBasicLaunch':
      return 'Ads are disabled for this build.';
    case 'timeout':
      return "The ad didn't load in time.";
    case 'unavailable':
      return 'Revives are only available on CrazyGames.';
    default:
      return 'The ad could not be shown. Your run is safe.';
  }
}
