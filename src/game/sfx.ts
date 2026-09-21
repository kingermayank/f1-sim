/**
 * Recorded sound effects, loaded best-effort.
 *
 * The game is fully playable on its synthesised audio; these recordings layer
 * on top when present. Files live in `public/assets/audio/sfx/` and are not
 * committed: they come from freesfx.co.uk, whose licence allows use in games
 * with a credit link (see `public/assets/audio/sfx/README.md` and
 * `src/assets/credits.json`). A missing file simply means that layer is silent.
 */
export type SfxName = 'onboard' | 'passby' | 'passbyB' | 'ambience' | 'straight';

export const SFX_FILES: Record<SfxName, { file: string; source: string }> = {
  /** A six-second steady-revs stretch cut from a Sound Ideas F1 recording, crossfaded into a seamless loop and pitched by RPM. WAV so the loop is sample-exact. */
  onboard: { file: '/assets/audio/sfx/f1-onboard-loop.wav', source: 'Sound Ideas Series 1000 · Formula 1 (freesfx 13458)' },
  /** "Formula 1 Race Cars Pass By Fast", trimmed to the pass: one-shot when a rival goes by. */
  passby: { file: '/assets/audio/sfx/f1-passby.mp3', source: 'Formula 1 Race Cars Pass By Fast (freesfx 13461)' },
  /** Digiffects "Race car, Formula 1, several passing", trimmed: a second pass-by voice so repeats do not sound identical. */
  passbyB: { file: '/assets/audio/sfx/f1-passby-b.mp3', source: 'Digiffects Power Pack · Formula 1 several passing (freesfx 18920)' },
  /** "Formula 1 Racing", crossfaded into a loop: trackside bed under the intro and grid. */
  ambience: { file: '/assets/audio/sfx/f1-ambience.mp3', source: 'Formula 1 Racing (freesfx 13462)' },
  /** "Formula 1 Cars on Straight Away": the flyover bed. */
  straight: { file: '/assets/audio/sfx/f1-straight.mp3', source: 'Formula 1 Cars on Straight Away (freesfx 13463)' },
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
