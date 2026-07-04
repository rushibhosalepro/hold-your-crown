import { Hono } from 'hono';
import { context, realtime, redis } from '@devvit/web/server';
import type { JoinResponse, LobbyResponse, ProfileResponse, ScorePayload } from '../../shared/api';
import type {
  AttackPayload,
  CrownDropPayload,
  CrownGrabPayload,
  CrownGrabResponse,
  GameMsg,
  KillPayload,
  LeaderboardEntry,
  LeaderboardResponse,
  PickupClaimPayload,
  PickupClaimResponse,
  StatePayload,
} from '../../shared/net';
import { CYCLE_MS, LOBBY_MS, MAX_PLAYERS, TTL_MS } from '../../shared/constants';

type ErrorResponse = {
  status: 'error';
  message: string;
};

// How long per-game keys live before Redis reclaims them.
const TTL_SEC = Math.ceil(CYCLE_MS / 1000) + 60;

export const api = new Hono();

// Assign the caller to a game: rejoin their current one, join an open lobby, or
// open a new one. Race-safe via atomic Redis ops (a sorted-set registry + an
// incrBy slot counter) instead of a read-modify-write JSON blob.
api.post('/join', async (c) => {
  const { postId, username } = context;
  if (!postId || !username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'postId/username missing from context' },
      400
    );
  }

  try {
    const now = Date.now();
    const gamesKey = `games:${postId}`;
    const pgKey = `pg:${postId}:${username}`;

    // "Play again" sends { fresh: true } so we don't rejoin the game that just ended.
    let fresh = false;
    try {
      const b = await c.req.json<{ fresh?: boolean }>();
      fresh = b.fresh === true;
    } catch {
      // no body — a normal join
    }

    // 0. Rejoin: if we're already tracked in a still-active game, return it (no new slot).
    const currentGameId = fresh ? null : await redis.get(pgKey);
    if (currentGameId) {
      const existingCreatedAt = await redis.zScore(gamesKey, currentGameId);
      if (existingCreatedAt !== undefined && existingCreatedAt + CYCLE_MS > now) {
        await touchPresence(postId, currentGameId, username, now);
        await redis.expire(pgKey, TTL_SEC);
        return c.json<JoinResponse>({
          type: 'join',
          gameId: currentGameId,
          channel: `${postId}_${currentGameId}`,
          createdAt: existingCreatedAt,
          now,
        });
      }
    }

    // 1. Find an open lobby (created within the last LOBBY_MS) that still has a slot.
    // Oldest-first so players cluster into one lobby instead of scattering into new ones.
    // Use a concrete numeric upper bound (not '+inf') so the score range is reliable.
    const openGames = await redis.zRange(gamesKey, now - LOBBY_MS, now + LOBBY_MS, { by: 'score' });
    let gameId: string | null = null;
    let createdAt = now;
    for (const g of openGames) {
      const n = await redis.incrBy(`game:${postId}:${g.member}:slots`, 1); // atomic capacity gate
      if (n <= MAX_PLAYERS) {
        gameId = g.member;
        createdAt = g.score;
        break;
      }
      // full — the counter is already past MAX (harmless); try the next lobby
    }

    // 2. No open lobby → join/create the deterministic lobby for this time window.
    // The id is derived from the 30s window, so simultaneous first-joiners converge on the
    // SAME room (no lobby-split race). The atomic slot counter elects the creator (n === 1)
    // and caps each room at MAX_PLAYERS, rolling to the next deterministic room on overflow.
    if (!gameId) {
      const base = `g${Math.floor(now / LOBBY_MS)}`;
      for (let gen = 0; gen < 30 && !gameId; gen++) {
        const lobbyId = gen === 0 ? base : `${base}r${gen}`;
        const n = await redis.incrBy(`game:${postId}:${lobbyId}:slots`, 1);
        if (n <= MAX_PLAYERS) {
          gameId = lobbyId;
          if (n === 1) {
            createdAt = now;
            await redis.zAdd(gamesKey, { member: lobbyId, score: now });
          } else {
            createdAt = (await redis.zScore(gamesKey, lobbyId)) ?? now;
          }
        }
      }
    }
    if (!gameId) {
      // Astronomically unlikely (300+ joins in one 30s window) — never 500.
      gameId = `g${Math.floor(now / LOBBY_MS)}x${Math.floor(Math.random() * 1e6)}`;
      createdAt = now;
      await redis.zAdd(gamesKey, { member: gameId, score: now });
      await redis.incrBy(`game:${postId}:${gameId}:slots`, 1);
    }
    await redis.expire(`game:${postId}:${gameId}:slots`, TTL_SEC);

    // 3. Presence + per-player state + rejoin pointer (all with TTLs).
    await touchPresence(postId, gameId, username, now);

    const stateKey = `game:${postId}:${gameId}:player:${username}`;
    const existing = await redis.hGetAll(stateKey);
    if (!existing || Object.keys(existing).length === 0) {
      await redis.hSet(stateKey, {
        hp: '100',
        shield: '0',
        hasCrown: '0',
        holdSince: '0',
        holdTotal: '0',
        score: '0',
        lastSeen: now.toString(),
      });
      await redis.expire(stateKey, TTL_SEC);
    }

    await redis.set(pgKey, gameId);
    await redis.expire(pgKey, TTL_SEC);

    return c.json<JoinResponse>({
      type: 'join',
      gameId,
      channel: `${postId}_${gameId}`,
      createdAt,
      now,
    });
  } catch (error) {
    console.error(`API Join Error for post ${postId}:`, error);
    const message = error instanceof Error ? `Join failed: ${error.message}` : 'Unknown join error';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// Lobby roster + heartbeat: refresh the caller's presence, return who's live.
api.post('/lobby', async (c) => {
  const { postId, username } = context;
  if (!postId || !username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'postId/username missing from context' },
      400
    );
  }

  try {
    const body = await c.req.json<{ gameId: string }>();
    const now = Date.now();
    await touchPresence(postId, body.gameId, username, now);

    const live = await redis.zRange(
      `game:${postId}:${body.gameId}:players`,
      now - TTL_MS,
      now + TTL_MS,
      { by: 'score' }
    );
    const players = live.map((m) => m.member);
    const createdAt = await redis.zScore(`games:${postId}`, body.gameId);

    return c.json<LobbyResponse>({
      type: 'lobby',
      players,
      count: players.length,
      createdAt: createdAt ?? now,
      now,
    });
  } catch (error) {
    console.error(`API Lobby Error for post ${postId}:`, error);
    const message = error instanceof Error ? `Lobby failed: ${error.message}` : 'Unknown lobby error';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// Relay a player's state to their game channel, stamping their real identity so
// nobody can broadcast as someone else.
api.post('/state', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>({ status: 'error', message: 'not logged in' }, 400);
  }
  const body = await c.req.json<StatePayload>();
  const msg: GameMsg = {
    kind: 'state',
    t2: username, // identity = username (reliably present, unlike userId)
    name: username,
    x: body.x,
    y: body.y,
    facing: body.facing,
    hp: body.hp,
    shield: body.shield,
    alive: body.alive,
    hasCrown: body.hasCrown,
    holdMs: body.holdMs,
    longestMs: body.longestMs,
    kills: body.kills,
  };
  await realtime.send(body.channel, msg);
  return c.json({ ok: true });
});

// Relay a kill (reported by the victim) to drive the kill feed + killer's counter.
api.post('/kill', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>({ status: 'error', message: 'not logged in' }, 400);
  }
  const body = await c.req.json<KillPayload>();
  const msg: GameMsg = { kind: 'kill', t2: username, killer: body.killer, victim: body.victim };
  await realtime.send(body.channel, msg);
  return c.json({ ok: true });
});

// Atomically claim a pickup (hSetNX ⇒ exactly one winner); on win, tell others to remove it.
api.post('/pickup', async (c) => {
  const { postId, username } = context;
  if (!postId || !username) {
    return c.json<ErrorResponse>({ status: 'error', message: 'not logged in' }, 400);
  }
  const body = await c.req.json<PickupClaimPayload>();
  const key = `pickups:${postId}:${body.gameId}`;
  const won = (await redis.hSetNX(key, `p${body.id}`, username)) === 1;
  if (won) {
    await redis.expire(key, TTL_SEC);
    const msg: GameMsg = { kind: 'pickup', t2: username, id: body.id };
    await realtime.send(body.channel, msg);
  }
  return c.json<PickupClaimResponse>({ won });
});

// Relay a sword swing to everyone in the game so they can render it; each client
// decides if its own player was in the arc and applies the damage itself.
api.post('/attack', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>({ status: 'error', message: 'not logged in' }, 400);
  }
  const body = await c.req.json<AttackPayload>();
  const msg: GameMsg = {
    kind: 'attack',
    t2: username,
    x: body.x,
    y: body.y,
    facing: body.facing,
  };
  await realtime.send(body.channel, msg);
  return c.json({ ok: true });
});

// Atomically claim the crown at its current version. hSetNX guarantees exactly one
// winner per version, so simultaneous grabs of a loose crown can't both succeed.
api.post('/crown/grab', async (c) => {
  const { postId, username } = context;
  if (!postId || !username) {
    return c.json<ErrorResponse>({ status: 'error', message: 'not logged in' }, 400);
  }
  const body = await c.req.json<CrownGrabPayload>();
  const verKey = `crown:${postId}:${body.gameId}:ver`;
  const heldKey = `crown:${postId}:${body.gameId}:held`;
  const ver = Number((await redis.get(verKey)) ?? '0');
  const won = (await redis.hSetNX(heldKey, `v${ver}`, username)) === 1;
  if (won) {
    await redis.expire(heldKey, TTL_SEC);
    await redis.expire(verKey, TTL_SEC);
  }
  // Display of who holds the crown is derived client-side from state broadcasts (self-healing);
  // this endpoint only arbitrates the atomic claim.
  return c.json<CrownGrabResponse>({ won });
});

// The current holder drops the crown (on death). Bumping the version opens a fresh
// claim slot; the crown lands at (x, y) for anyone to grab.
api.post('/crown/drop', async (c) => {
  const { postId, username } = context;
  if (!postId || !username) {
    return c.json<ErrorResponse>({ status: 'error', message: 'not logged in' }, 400);
  }
  const body = await c.req.json<CrownDropPayload>();
  const verKey = `crown:${postId}:${body.gameId}:ver`;
  await redis.incrBy(verKey, 1); // open a fresh claim slot for the next grabber
  await redis.expire(verKey, TTL_SEC);
  return c.json({ ok: true });
});

// Persist a finished round into the caller's lifetime profile (no TTL) and the
// reign leaderboards. Each player reports only their own result.
api.post('/score', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>({ status: 'error', message: 'not logged in' }, 400);
  }
  const body = await c.req.json<ScorePayload>();
  const pKey = `p:${username}`;
  const holdMs = Math.max(0, Math.round(body.holdTotalMs));
  const longestMs = Math.max(0, Math.round(body.longestMs));
  const xpGain = Math.max(0, body.kills) * 10 + (body.win ? 100 : 0) + Math.round(holdMs / 1000) + 20;

  await redis.hIncrBy(pKey, 'gamesPlayed', 1);
  await redis.hIncrBy(pKey, 'kills', Math.max(0, body.kills));
  await redis.hIncrBy(pKey, 'wins', body.win ? 1 : 0);
  await redis.hIncrBy(pKey, 'totalReignTime', holdMs);
  await redis.hIncrBy(pKey, 'xp', xpGain);

  // longestReign is a running max (one report per user per game → races negligible).
  const prevBest = Number((await redis.hGet(pKey, 'longestReign')) ?? '0');
  const best = Math.max(prevBest, longestMs);
  if (best > prevBest) await redis.hSet(pKey, { longestReign: best.toString() });

  // Leaderboards ranked by best single reign — the game's signature stat.
  await redis.zAdd('lb:reign', { member: username, score: best });
  const dayKey = `lb:day:${new Date().toISOString().slice(0, 10)}`;
  const prevDay = await redis.zScore(dayKey, username);
  if (prevDay === undefined || longestMs > prevDay) {
    await redis.zAdd(dayKey, { member: username, score: longestMs });
  }
  await redis.expire(dayKey, 60 * 60 * 24 * 2); // keep daily boards ~2 days

  return c.json({ ok: true });
});

// Top reigns, all-time and today.
api.get('/leaderboard', async (c) => {
  const top = async (key: string): Promise<LeaderboardEntry[]> => {
    const rows = await redis.zRange(key, 0, 9, { by: 'rank', reverse: true });
    return rows.map((r) => ({ name: r.member, score: r.score }));
  };
  const dayKey = `lb:day:${new Date().toISOString().slice(0, 10)}`;
  return c.json<LeaderboardResponse>({
    allTime: await top('lb:reign'),
    daily: await top(dayKey),
  });
});

// The caller's lifetime profile + their all-time reign rank.
api.get('/profile', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ProfileResponse>({
      username: '',
      gamesPlayed: 0,
      wins: 0,
      kills: 0,
      longestReign: 0,
      totalReignTime: 0,
      xp: 0,
      rank: 0,
    });
  }
  const h = await redis.hGetAll(`p:${username}`);
  const longestReign = Number(h.longestReign ?? '0');
  let rank = 0;
  if (longestReign > 0) {
    const asc = await redis.zRank('lb:reign', username);
    if (asc !== undefined) rank = (await redis.zCard('lb:reign')) - asc; // 1-based, highest first
  }
  return c.json<ProfileResponse>({
    username,
    gamesPlayed: Number(h.gamesPlayed ?? '0'),
    wins: Number(h.wins ?? '0'),
    kills: Number(h.kills ?? '0'),
    longestReign,
    totalReignTime: Number(h.totalReignTime ?? '0'),
    xp: Number(h.xp ?? '0'),
    rank,
  });
});

// Refresh a player's presence score and keep the roster key alive.
async function touchPresence(postId: string, gameId: string, username: string, now: number) {
  const playersKey = `game:${postId}:${gameId}:players`;
  await redis.zAdd(playersKey, { member: username, score: now });
  await redis.expire(playersKey, TTL_SEC);
}
