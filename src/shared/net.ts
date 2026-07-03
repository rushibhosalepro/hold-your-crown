export type GameMeta = {
  gameId: string;
  createdAt: number; // ms epoch — anchors lobby→fight→done phase for this game
  maxPlayers: number;
};

export type GamePlayerMembership = {
  username: string;
  joinedAt: number; // ms epoch
};

// ---------------------------------------------------------------------------
// Per-player live state within a single game.
// Stored as a Redis hash: `game:{postId}:{gameId}:player:{username}`
// ---------------------------------------------------------------------------
export type GamePlayerState = {
  hp: number;
  shield: number; // charge count; 0 = no shield
  hasCrown: 0 | 1;
  holdSince: number; // ms epoch when current crown hold started; 0 if not holding
  holdTotal: number; // cumulative ms held this game
  score: number; // running score this game
  lastSeen: number; // ms epoch, liveness
};

export type CrownState = {
  holder: string; // username; "" = unclaimed
  since: number; // ms epoch, when current holder claimed it
  version: number; // increments on every claim — optimistic-lock guard
};

export type PlayerProfile = {
  xp: number;
  kills: number;
  wins: number;
  gamesPlayed: number;
  longestReign: number; // ms, max single unbroken crown hold ever
  totalReignTime: number; // ms, cumulative crown-hold time across all games
  crownsStolen: number; // times this player took the crown off someone else
};

// ---------------------------------------------------------------------------
// Leaderboard entries — used for both `lb:xp` (all-time) and
// `lb:day:{date}` (daily) sorted sets.
// ---------------------------------------------------------------------------
export type LeaderboardEntry = {
  name: string;
  score: number;
};

export type LeaderboardResponse = {
  allTime: LeaderboardEntry[];
  daily: LeaderboardEntry[];
};

// ---------------------------------------------------------------------------
// Realtime messages broadcast on a game's channel `${postId}-${gameId}`.
// The server stamps identity (t2 + name) so clients can't impersonate.
// ---------------------------------------------------------------------------
export type StateMsg = {
  kind: 'state';
  t2: string; // sender username (server-stamped)
  name: string; // sender username (server-stamped)
  x: number;
  y: number;
  facing: number;
  hp: number;
  shield: number;
  alive: boolean;
  hasCrown: boolean; // is this player currently holding the crown
  holdMs: number; // cumulative crown-hold time this game (win metric)
  longestMs: number; // longest single unbroken reign this game (highlight stat)
  kills: number; // kills this round
};

// A sword swing, broadcast so every client renders it; each victim self-applies the damage.
export type AttackMsg = {
  kind: 'attack';
  t2: string; // attacker username (server-stamped)
  x: number;
  y: number;
  facing: number;
};

// A kill, reported by the victim (who knows who struck the fatal blow). Drives the
// kill feed on every screen and the killer's kill counter.
export type KillMsg = {
  kind: 'kill';
  t2: string; // victim username (server-stamped sender)
  killer: string;
  victim: string;
};

// A pickup was claimed; other clients remove it from their arena.
export type PickupMsg = {
  kind: 'pickup';
  t2: string; // claimer username (server-stamped)
  id: number; // pickup index
};

export type GameMsg = StateMsg | AttackMsg | KillMsg | PickupMsg;

// Client -> server body for POST /api/state (server adds t2 + name).
export type StatePayload = {
  channel: string;
  x: number;
  y: number;
  facing: number;
  hp: number;
  shield: number;
  alive: boolean;
  hasCrown: boolean;
  holdMs: number;
  longestMs: number;
  kills: number;
};

export type AttackPayload = {
  channel: string;
  x: number;
  y: number;
  facing: number;
};

export type KillPayload = { channel: string; killer: string; victim: string };
export type PickupClaimPayload = { channel: string; gameId: string; id: number };
export type PickupClaimResponse = { won: boolean };

export type CrownGrabPayload = { channel: string; gameId: string };
export type CrownGrabResponse = { won: boolean };
export type CrownDropPayload = { channel: string; gameId: string; x: number; y: number };
