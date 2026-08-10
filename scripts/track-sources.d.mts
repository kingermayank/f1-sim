export type TrackSource = Readonly<{
  archive: string;
  model: string;
}>;

export const TRACK_SOURCES: Readonly<{
  suzuka: TrackSource;
  melbourne: TrackSource;
  barcelona: TrackSource;
  spa: TrackSource;
  silverstone: TrackSource;
  singapore: TrackSource;
  'red-bull-ring': TrackSource;
  austin: TrackSource;
  'abu-dhabi': TrackSource;
  bahrain: TrackSource;
}>;
