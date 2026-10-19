"use client";
// Web Playback SDK: turns this browser tab into a Spotify Connect device
// ("Music Kiosk"). Desktop browsers only; on iPad/phone the Spotify app plays.
import { useEffect, useRef, useState } from "react";
import { sdkSupported } from "@/lib/client";

type SdkPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  activateElement(): Promise<void>;
  addListener(event: string, cb: (arg: { device_id?: string; message?: string }) => void): void;
};

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (opts: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SdkPlayer;
    };
  }
}

export function useSpotifyPlayer(enabled: boolean) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<SdkPlayer | null>(null);
  const supported = sdkSupported();

  useEffect(() => {
    if (!enabled || !supported) return;
    const create = () => {
      if (playerRef.current || !window.Spotify) return;
      const player = new window.Spotify.Player({
        name: "Music Kiosk (this browser)",
        volume: 0.8,
        getOAuthToken: (cb) =>
          fetch("/api/spotify/token")
            .then((r) => r.json())
            .then((j) => cb(j.token)),
      });
      player.addListener("ready", ({ device_id }) => setDeviceId(device_id ?? null));
      player.addListener("not_ready", () => setDeviceId(null));
      for (const ev of ["initialization_error", "authentication_error", "account_error"])
        player.addListener(ev, ({ message }) => setError(message ?? ev));
      player.connect();
      playerRef.current = player;
    };
    if (window.Spotify) create();
    else {
      window.onSpotifyWebPlaybackSDKReady = create;
      if (!document.getElementById("spotify-sdk")) {
        const s = document.createElement("script");
        s.id = "spotify-sdk";
        s.src = "https://sdk.scdn.co/spotify-player.js";
        document.body.appendChild(s);
      }
    }
    return () => {
      playerRef.current?.disconnect();
      playerRef.current = null;
    };
  }, [enabled, supported]);

  // Must run inside a user gesture (autoplay rules).
  const activate = () => playerRef.current?.activateElement().catch(() => {});

  return { supported, deviceId, error, activate };
}
