export type InitResponse = {
  type: 'init';
  postId: string;
  username: string;
  xp: number;
  kills: number;
  wins: number;
  gamesPlayed: number;
  longestReign: number; // still valid — now means "longest single unbroken crown hold" instead of "throne zone time"
  totalReignTime: number; // cumulative crown-hold time across all games — nice for a lifetime stat
  crownsStolen: number; // NEW — fits the new mechanic specifically: times you took the crown off someone else (aggro/skill stat, distinct from wins)
};

export type JoinResponse = {
  type: 'join';
  gameId: string;
  createdAt: number;
  channel: string; // `${postId}_${gameId}` — realtime channel (letters/numbers/underscores only)
  now: number; // server time, for client clockOffset calc
};

export type LobbyResponse = {
  type: 'lobby';
  players: string[]; // live usernames currently in the lobby
  count: number;
  createdAt: number; // game's createdAt (anchors the lobby countdown)
  now: number;
};

export type ScorePayload = {
  kills: number;
  win: boolean;
  holdTotalMs: number; // this player's cumulative crown-hold time this game
  longestMs: number; // this player's longest single reign this game (drives the leaderboard)
};

export type ProfileResponse = {
  username: string;
  gamesPlayed: number;
  wins: number;
  kills: number;
  longestReign: number; // ms, best single reign ever
  totalReignTime: number; // ms, cumulative reign across all games
  xp: number;
  rank: number; // 1-based all-time reign rank; 0 if unranked
};
