// Shapes the kiosk UI reads from /api/state.
import type { QueueItem } from "@/lib/queue";
import type { KioskSettings } from "@/lib/settings";
import type { SpDevice, TrackSummary } from "@/lib/spotify";

export type { QueueItem, KioskSettings, SpDevice, TrackSummary };

export type KioskState = {
  locked: boolean;
  pinRequired: boolean;
  spotify?: { configured: boolean; connected: boolean; user: { name?: string; product?: string } | null };
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
  ducked?: boolean;
  upNext?: QueueItem[];
  pending?: QueueItem[];
  recent?: QueueItem[];
  clip?: QueueItem | null;
  isAudioHost?: boolean;
  settings?: KioskSettings;
};

export type Notify = (msg: string) => void;
