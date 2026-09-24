/**
 * Recorded sound effects, loaded best-effort.
 *
 * The game is fully playable on its synthesised audio; these recordings layer
 * on top when present. Files live in `public/assets/audio/sfx/` and are not
 * committed: they come from freesfx.co.uk, whose licence allows use in games
 * with a credit link (see `public/assets/audio/sfx/README.md` and
 * `src/assets/credits.json`). A missing file simply means that layer is silent.
 */
export type SfxName = 'onboard' | 'passby' | 'passbyB' | 'passbyC' | 'passbyD' | 'passbyE' | 'ambience' | 'straight';

export const SFX_FILES: Record<SfxName, { file: string; source: string }> = {
  /** A six-second steady stretch of the race start, crossfaded into a seamless loop and pitched by RPM. WAV so the loop is sample-exact. */
  onboard: { file: '/assets/audio/sfx/f1-onboard-loop.wav', source: 'Sound Ideas · start of the race, racing by (freesfx 13458)' },
  /** One car going past: one-shot when a rival goes by. */
  passby: { file: '/assets/audio/sfx/f1-passby.mp3', source: 'Sound Ideas · one car, racing by (freesfx 13461)' },
  /** Several cars passing, so a second pass does not sound identical. */
  passbyB: { file: '/assets/audio/sfx/f1-passby-b.mp3', source: 'Digiffects · Formula 1, several passing (freesfx 18920)' },
  /** Second lap, the first pack going by. */
  passbyC: { file: '/assets/audio/sfx/f1-passby-c.mp3', source: 'Sound Ideas · 2nd lap, racing by (freesfx 13459)' },
  /** Third lap, the first car going by. */
  passbyD: { file: '/assets/audio/sfx/f1-passby-d.mp3', source: 'Sound Ideas · 3rd lap, racing by (freesfx 13460)' },
  /** A car downshifting as it goes by. */
  passbyE: { file: '/assets/audio/sfx/f1-passby-e.mp3', source: 'Sound Ideas · down-shifting, racing by (freesfx 13464)' },
  /** Trackside racing, crossfaded into a loop: bed under the intro, grid and race. */
  ambience: { file: '/assets/audio/sfx/f1-ambience.mp3', source: 'Sound Ideas · Formula 1 racing (freesfx 13462)' },
  /** Cars on the straight: the flyover bed under the intro. */
  straight: { file: '/assets/audio/sfx/f1-straight.mp3', source: 'Sound Ideas · straight away (freesfx 13463)' },
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
