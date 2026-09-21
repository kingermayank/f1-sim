/**
 * Recorded sound effects, loaded best-effort.
 *
 * The game is fully playable on its synthesised audio; these recordings layer
 * on top when present. Files live in `public/assets/audio/sfx/` and are not
 * committed: they come from freesfx.co.uk, whose licence allows use in games
 * with a credit link (see `public/assets/audio/sfx/README.md` and
 * `src/assets/credits.json`). A missing file simply means that layer is silent.
 */
export type SfxName = 'onboard' | 'passby' | 'ambience' | 'straight';

export const SFX_FILES: Record<SfxName, { file: string; source: string }> = {
  /** A steady full-throttle stretch from "Inside Formula Car Around Track", looped and pitched by RPM. */
  onboard: { file: '/assets/audio/sfx/f1-onboard-loop.mp3', source: 'Inside Formula Car Around Track' },
  /** "Formula 1 Race Cars Pass By Fast": one-shot when a rival goes by. */
  passby: { file: '/assets/audio/sfx/f1-passby.mp3', source: 'Formula 1 Race Cars Pass By Fast' },
  /** "Formula 500 General Ambience": paddock and crowd bed under the intro and grid. */
  ambience: { file: '/assets/audio/sfx/f1-ambience.mp3', source: 'Formula 500 General Ambience' },
  /** "Formula 1 Cars on Straight Away": the flyover bed. */
  straight: { file: '/assets/audio/sfx/f1-straight.mp3', source: 'Formula 1 Cars on Straight Away' },
};

export type SfxLibrary = Partial<Record<SfxName, AudioBuffer>>;

/** Fetches and decodes whichever recordings exist. Never throws; never blocks the game. */
export async function loadSfx(context: AudioContext, names: SfxName[] = Object.keys(SFX_FILES) as SfxName[]): Promise<SfxLibrary> {
  const library: SfxLibrary = {};
  await Promise.all(names.map(async (name) => {
    try {
      const response = await fetch(SFX_FILES[name].file, { cache: 'force-cache' });
      if (!response.ok) return;
      const type = response.headers.get('content-type') ?? '';
      // A dev server answers a missing file with the app's HTML; only decode audio.
      if (type.includes('text/html')) return;
      library[name] = await context.decodeAudioData(await response.arrayBuffer());
    } catch {
      // Missing or undecodable: the synthesised layer covers it.
    }
  }));
  return library;
}
