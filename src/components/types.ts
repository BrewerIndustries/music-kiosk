// Shapes the kiosk UI reads from /api/state.
import type { QueueItem } from "@/lib/queue";
import type { KioskSettings } from "@/lib/settings";
import type { SpDevice, TrackSummary } from "@/lib/spotify";
import type { LoggedError } from "@/lib/log";

export type { QueueItem, KioskSettings, SpDevice, TrackSummary };

export type KioskState = {
  locked: boolean;
  me?: { id: string; email: string; name: string; role: "admin" | "member" } | null;
  spotify?: { configured: boolean; connected: boolean; user: { name?: string; product?: string } | null };
  youtube?: { configured: boolean; connected: boolean; user: { name?: string; email?: string } | null };
  error?: string | null;
  playback?: {
    isPlaying: boolean;
    progressMs: number;
    at: number;
    track: TrackSummary | null;
    device: SpDevice;
    contextUri: string | null;
    shuffle: boolean;
  } | null;
  nowPlayingItem?: QueueItem | null;
  youtubeNow?: (QueueItem & { startedAt: number }) | null;
  youtubeHeld?: boolean; // Spotify took over: the kiosk tab pauses the YouTube song
  ducked?: boolean;
  fading?: boolean;
  holdActive?: boolean;
  resumeOffer?: { pref: string; uri: string; deviceId: string | null; deviceName: string | null } | null;
  musicVolume?: number | null;
  upcoming?: TrackSummary[];
  history?: (TrackSummary & { playedAt: string })[];
  errors?: LoggedError[];
  upNext?: QueueItem[];
  pending?: QueueItem[];
  recent?: QueueItem[];
  clip?: (QueueItem & { startMs?: number }) | null; // startMs: pick a YouTube song back up there
  isAudioHost?: boolean;
  settings?: KioskSettings;
};

export type Notify = (msg: string) => void;
