import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import { v4 as uuidv4 } from 'uuid';
import type { JoinResponse } from '../../shared/api';
import type { GameMeta } from '../../shared/net';
import {
  CYCLE_MS,
  LOBBY_MS,
  MAX_PLAYERS,
  ROUND_MS,
  TTL_MS,
} from '../../shared/constants';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

api.get('/join', async (c) => {
  const { postId, username } = context;

  if (!postId || !username) {
    console.error(
      'API Join Error: postId/username not found in devvit context'
    );
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId/username is required but missing from context',
      },
      400
    );
  }

  try {
    const now = Date.now();
    const gamesKey = `games:${postId}`;

    const raw = await redis.get(gamesKey);
    let games: GameMeta[] = raw ? JSON.parse(raw) : [];

    const before = games.length;
    games = games.filter((g) => g.createdAt + CYCLE_MS > now);
    if (games.length !== before) {
      await redis.set(gamesKey, JSON.stringify(games));
    }

    let joinedGame: GameMeta | null = null;

    for (const g of games) {
      const stillInLobby = g.createdAt + LOBBY_MS > now;
      if (!stillInLobby) continue;

      const playersKey = `game:${postId}:${g.gameId}:players`;

      await redis.zAdd(playersKey, { member: username, score: now });
      const liveMembers = await redis.zRange(playersKey, now - TTL_MS, '+inf', {
        by: 'score',
      });

      if (liveMembers.length > g.maxPlayers) {
        await redis.zRem(playersKey, [username]);
        continue;
      }

      await redis.expire(playersKey, Math.ceil(CYCLE_MS / 1000) + 60);
      joinedGame = g;
      break;
    }

    if (!joinedGame) {
      const newGame: GameMeta = {
        gameId: uuidv4(),
        createdAt: now,
        maxPlayers: MAX_PLAYERS,
      };

      games.push(newGame);
      await redis.set(gamesKey, JSON.stringify(games));

      const playersKey = `game:${postId}:${newGame.gameId}:players`;
      await redis.zAdd(playersKey, { member: username, score: now });
      await redis.expire(playersKey, Math.ceil(CYCLE_MS / 1000) + 60);

      joinedGame = newGame;
    }

    const playerStateKey = `game:${postId}:${joinedGame.gameId}:player:${username}`;
    const existing = await redis.hGetAll(playerStateKey);
    if (!existing || Object.keys(existing).length === 0) {
      await redis.hSet(playerStateKey, {
        hp: '100',
        shield: '0',
        hasCrown: '0',
        holdSince: '0',
        holdTotal: '0',
        score: '0',
        lastSeen: now.toString(),
      });
      await redis.expire(playerStateKey, Math.ceil(CYCLE_MS / 1000) + 60);
    }

    return c.json<JoinResponse>({
      type: 'join',
      gameId: joinedGame.gameId,
      channel: `${postId}-${joinedGame.gameId}`,
      createdAt: joinedGame.createdAt,
      now,
    });
  } catch (error) {
    console.error(`API Join Error for post ${postId}:`, error);
    const errorMessage =
      error instanceof Error
        ? `Join failed: ${error.message}`
        : 'Unknown error during join';
    return c.json<ErrorResponse>(
      { status: 'error', message: errorMessage },
      400
    );
  }
});
