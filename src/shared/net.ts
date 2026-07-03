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
