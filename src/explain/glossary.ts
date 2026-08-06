/**
 * Plain-language definitions for the jargon that research repeatedly identifies
 * as the wall newcomers hit — tyre strategy and DRS above all.
 *
 * One source of truth: the tooltips in Explain Mode and the questions in the
 * quiz both read from here, so what we teach and what we test cannot drift.
 */
export interface GlossaryEntry {
  term: string;
  short: string;
  long: string;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: 'DRS',
    short: 'A rear wing flap that reduces drag on straights.',
    long:
      'Drag Reduction System. A driver within one second of the car ahead at a fixed detection point '
      + 'may open a flap in their rear wing along marked straights, which cuts drag and adds speed. It '
      + 'is not a pass button — the driver still has to get the previous corner right and brake later '
      + 'than the car ahead.',
  },
  {
    term: 'undercut',
    short: 'Pitting earlier than a rival to jump ahead using fresh tyres.',
    long:
      'You pit before the car you are chasing. New tyres are fast immediately, so you set quick laps '
      + 'while they are still on worn rubber. When they finally pit, you have banked enough time to '
      + 'come out ahead.',
  },
  {
    term: 'overcut',
    short: 'Staying out longer than a rival to jump ahead.',
    long:
      'The opposite of an undercut. You stay out while a rival pits, and if you can keep your pace up '
      + 'in clear air you gain more than their fresh tyres do — then pit and emerge in front.',
  },
  {
    term: 'degradation',
    short: 'Tyres losing grip, and lap time, as they wear.',
    long:
      'Tyres get slower as they wear. A tyre losing a second per lap will eventually cost more than the '
      + 'roughly twenty-four seconds a pit stop takes, and that trade is the heart of race strategy.',
  },
  {
    term: 'dirty air',
    short: 'Turbulent air behind another car that reduces grip.',
    long:
      'F1 cars generate downforce from clean airflow. Following closely disrupts that flow, costing '
      + 'grip and overheating the tyres — which is exactly why overtaking is hard and why DRS exists.',
  },
  {
    term: 'stint',
    short: 'The laps run on one set of tyres.',
    long: 'The period between pit stops. A two-stop race has three stints.',
  },
  {
    term: 'pit window',
    short: 'The range of laps where stopping makes sense.',
    long:
      'Stop too early and the new tyres will not last to the end. Stop too late and you have already '
      + 'lost time on worn rubber. The window is the span where the trade works out.',
  },
  {
    term: 'safety car',
    short: 'A car that neutralises the race and bunches the field.',
    long:
      'Deployed when the track is unsafe. Everyone slows and closes up behind it, which erases leads '
      + 'and makes pit stops much cheaper — so it often reshuffles the entire race.',
  },
  {
    term: 'yellow flag',
    short: 'Danger ahead — slow down, no overtaking.',
    long: 'Shown where there is a hazard on or beside the track. Drivers must slow and may not overtake in that sector.',
  },
  {
    term: 'clean air',
    short: 'Undisturbed air ahead of you, worth real lap time.',
    long: 'Running with no car directly in front. The car works as designed, so a driver in clean air can often pull away.',
  },
  {
    term: 'flat-spot',
    short: 'A worn patch from locking a wheel under braking.',
    long:
      'Brake too hard and a tyre stops rotating while the car is still moving, grinding a flat patch. '
      + 'The tyre then vibrates badly and often has to be replaced.',
  },
  {
    term: 'compound',
    short: 'How soft or hard a tyre is.',
    long:
      'Softer tyres grip better and are faster, but wear out sooner. Harder tyres are slower but last. '
      + 'Choosing between them, and when to switch, is most of race strategy.',
  },
];

const INDEX = new Map(GLOSSARY.map((entry) => [entry.term.toLowerCase(), entry]));

export function lookupTerm(term: string): GlossaryEntry | undefined {
  return INDEX.get(term.trim().toLowerCase());
}
