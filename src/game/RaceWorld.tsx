import { Environment, type ShadowFocus } from '../scene/Environment';
import type { SceneQualityTier } from '../scene/RaceScene';

/** The haze starts nearer at car height than in the broadcast's high shots. */
const FOG: readonly [number, number] = [650, 3600];

/**
 * Everything the driving game draws except the cars: the APEX circuit with
 * its generated racing surface, under the sky rendered for it, which is both
 * the background and the light the cars reflect.
 */
export function RaceWorld({ quality, shadowFocus, lights }: {
  quality: SceneQualityTier;
  shadowFocus?: () => ShadowFocus;
  /** How many start lights are lit, for the gantry. */
  lights?: () => number;
}) {
  return <Environment quality={quality} shadowFocus={shadowFocus} racingLine={false} fog={FOG} lights={lights} />;
}
