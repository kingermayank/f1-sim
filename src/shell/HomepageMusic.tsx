import { useEffect, useRef } from 'react';
import { isUiSoundEnabled, UI_SOUND_EVENT } from './ui-sound';

const SPOTIFY_URL = 'https://open.spotify.com/album/157Gano57F4G2EAWL5NKP8';
const SPOTIFY_SCRIPT = 'https://open.spotify.com/embed/iframe-api/v1';

interface SpotifyController {
  addListener(event: 'ready', listener: () => void): void;
  addListener(event: 'playback_started', listener: () => void): void;
  addListener(event: 'playback_update', listener: (event: {
    data: { duration: number; position: number; isPaused: boolean; isBuffering: boolean };
  }) => void): void;
  play(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  destroy(): void;
}

interface SpotifyIframeApi {
  createController(
    element: HTMLElement,
    options: { url: string; width: number; height: number },
    callback: (controller: SpotifyController) => void,
  ): void;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void;
    __apexSpotifyIframeApi?: SpotifyIframeApi;
  }
}

let spotifyApiPromise: Promise<SpotifyIframeApi> | null = null;

/** Load Spotify's iframe API once, even when React Strict Mode remounts the player. */
function loadSpotifyApi(): Promise<SpotifyIframeApi> {
  if (window.__apexSpotifyIframeApi) return Promise.resolve(window.__apexSpotifyIframeApi);
  if (spotifyApiPromise) return spotifyApiPromise;

  spotifyApiPromise = new Promise((resolve) => {
    window.onSpotifyIframeApiReady = (api) => {
      window.__apexSpotifyIframeApi = api;
      resolve(api);
    };

    if (!document.querySelector(`script[src="${SPOTIFY_SCRIPT}"]`)) {
      const script = document.createElement('script');
      script.src = SPOTIFY_SCRIPT;
      script.async = true;
      document.body.appendChild(script);
    }
  });

  return spotifyApiPromise;
}

/** Streams the supplied soundtrack through Spotify and follows the global sound switch. */
export function HomepageMusic() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let controller: SpotifyController | null = null;
    let hasInteracted = false;
    let hasStarted = false;
    let hasEnded = false;
    let isRestarting = false;
    let disposed = false;

    const restartPlayback = () => {
      if (!controller || !hasInteracted || !isUiSoundEnabled() || isRestarting) return;
      isRestarting = true;
      hasEnded = false;
      controller.restart();
    };

    const syncPlayback = () => {
      if (!controller) return;
      if (isUiSoundEnabled()) {
        if (hasEnded) restartPlayback();
        else if (hasStarted) controller.resume();
        else controller.play();
      } else {
        controller.pause();
      }
    };

    const unlock = () => {
      hasInteracted = true;
      syncPlayback();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    const onSoundChange = () => syncPlayback();

    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    window.addEventListener(UI_SOUND_EVENT, onSoundChange);

    void loadSpotifyApi().then((api) => {
      if (disposed || !host.current) return;
      api.createController(
        host.current,
        { url: SPOTIFY_URL, width: 300, height: 152 },
        (nextController) => {
          if (disposed) {
            nextController.destroy();
            return;
          }
          controller = nextController;
          controller.addListener('ready', syncPlayback);
          controller.addListener('playback_started', () => {
            hasStarted = true;
            hasEnded = false;
            isRestarting = false;
          });
          controller.addListener('playback_update', ({ data }) => {
            if (data.position < 1000) {
              hasEnded = false;
              isRestarting = false;
              return;
            }
            const reachedEnd = data.duration > 0
              && data.isPaused
              && data.position >= data.duration - 500;
            if (!reachedEnd) return;
            hasEnded = true;
            restartPlayback();
          });
        },
      );
    });

    return () => {
      disposed = true;
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener(UI_SOUND_EVENT, onSoundChange);
      controller?.destroy();
    };
  }, []);

  return (
    <div className="showroom__music" aria-hidden="true">
      <div ref={host} className="showroom__spotify-embed" />
    </div>
  );
}
