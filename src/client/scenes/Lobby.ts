import { Scene } from 'phaser';
import { showShareSheet } from '@devvit/web/client';
import type { JoinResponse, LobbyResponse } from '../../shared/api';
import { LOBBY_MS, MAX_PLAYERS } from '../../shared/constants';

const ARENA_W = 1024;
const ARENA_H = 768;

/**
 * Waiting room. Calls /api/join to get placed in a game, shows a live roster +
 * countdown (polling /api/lobby, which also heartbeats us), then hands the room
 * context off to the Game scene when the lobby ends.
 */
export class Lobby extends Scene {
  private gameId = '';
  private channel = '';
  private createdAt = 0;
  private clockOffset = 0;
  private started = false;
  private fresh = false;

  private timerText: Phaser.GameObjects.Text;
  private countText: Phaser.GameObjects.Text;
  private listText: Phaser.GameObjects.Text;
  private statusText: Phaser.GameObjects.Text;

  constructor() {
    super('Lobby');
  }

  init(data: { fresh?: boolean }) {
    // Phaser reuses the scene instance across re-entries (e.g. "play again"), so reset state.
    this.fresh = data.fresh === true;
    this.started = false;
    this.createdAt = 0;
    this.gameId = '';
    this.channel = '';
    this.clockOffset = 0;
  }

  create() {
    this.cameras.main.setBackgroundColor(0x0a0816);
    const cx = ARENA_W / 2;

    this.add
      .text(cx, 96, '👑 Hold Your Crown', {
        fontFamily: 'Arial Black',
        fontSize: 42,
        color: '#ffd24a',
      })
      .setOrigin(0.5);

    this.timerText = this.add
      .text(cx, 180, 'Joining…', { fontFamily: 'Arial Black', fontSize: 30, color: '#9fd8ff' })
      .setOrigin(0.5);

    this.countText = this.add
      .text(cx, 232, '', { fontFamily: 'Arial', fontSize: 18, color: '#d8c9a8' })
      .setOrigin(0.5);

    this.add
      .text(cx, 288, 'In the lobby', { fontFamily: 'Arial', fontSize: 16, color: '#b6a6d8' })
      .setOrigin(0.5);

    this.listText = this.add
      .text(cx, 316, '', {
        fontFamily: 'Arial',
        fontSize: 20,
        color: '#f4ead0',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5, 0);

    this.add
      .text(
        cx,
        ARENA_H - 150,
        'Waiting for challengers — the round starts soon.\nShare the post to fill the arena faster.',
        { fontFamily: 'Arial', fontSize: 15, color: '#9a8fbe', align: 'center', lineSpacing: 4 }
      )
      .setOrigin(0.5);

    const invite = this.add
      .text(cx, ARENA_H - 98, '📣  Invite friends', {
        fontFamily: 'Arial',
        fontSize: 20,
        color: '#ffd24a',
        backgroundColor: '#241a3d',
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    invite.on('pointerup', () => {
      void showShareSheet({
        title: 'Hold Your Crown',
        text: 'Join my crown battle — grab the crown and hold it longest to win! 👑',
      });
    });

    this.statusText = this.add
      .text(cx, ARENA_H - 50, '', { fontFamily: 'Arial', fontSize: 14, color: '#8a7fae' })
      .setOrigin(0.5);

    void this.join();
  }

  private serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  private async join() {
    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fresh: this.fresh }),
      });
      if (!res.ok) {
        this.showError();
        return;
      }
      const data: JoinResponse = await res.json();
      this.gameId = data.gameId;
      this.channel = data.channel;
      this.createdAt = data.createdAt;
      this.clockOffset = data.now - Date.now();

      void this.refreshLobby();
      this.time.addEvent({ delay: 1500, loop: true, callback: () => void this.refreshLobby() });
    } catch {
      this.showError();
    }
  }

  private async refreshLobby() {
    if (!this.gameId) return;
    try {
      const res = await fetch('/api/lobby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: this.gameId }),
      });
      if (!res.ok) return;
      const data: LobbyResponse = await res.json();
      this.countText.setText(`${data.count} / ${MAX_PLAYERS} players`);
      this.listText.setText(data.players.map((p) => `u/${p}`).join('\n') || '—');
    } catch {
      // Ignore transient poll errors; next tick retries.
    }
  }

  private showError() {
    this.timerText.setText('Could not join');
    this.statusText.setText('Tap to retry');
    this.input.once('pointerdown', () => this.scene.restart());
  }

  override update() {
    if (this.started || this.createdAt === 0) return;

    const left = this.createdAt + LOBBY_MS - this.serverNow();
    if (left <= 0) {
      this.started = true;
      this.scene.start('Game', {
        gameId: this.gameId,
        channel: this.channel,
        createdAt: this.createdAt,
        clockOffset: this.clockOffset,
      });
      return;
    }

    const secs = Math.ceil(left / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    this.timerText.setText(`Game starts in ${m}:${s.toString().padStart(2, '0')}`);
  }
}
