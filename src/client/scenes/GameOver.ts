import { Scene } from 'phaser';
import { showShareSheet } from '@devvit/web/client';
import type { ProfileResponse } from '../../shared/api';

type Standing = {
  name: string;
  holdMs: number;
  longestMs: number;
  kills: number;
};

// Final standings for a finished round: whoever held the crown longest wins.
export class GameOver extends Scene {
  private board: Standing[] = [];
  private me = '';

  constructor() {
    super('GameOver');
  }

  init(data: { board?: Standing[]; me?: string }) {
    this.board = data.board ?? [];
    this.me = data.me ?? '';
  }

  create() {
    const cx = 1024 / 2;
    this.cameras.main.setBackgroundColor(0x0a0816);

    const winner = this.board[0];
    const title =
      winner && winner.holdMs > 0
        ? winner.name === this.me
          ? '👑 You win!'
          : `👑 ${winner.name} wins!`
        : 'No one held the crown';
    this.add
      .text(cx, 80, title, {
        fontFamily: 'Arial Black',
        fontSize: 50,
        color: '#ffd24a',
        stroke: '#000000',
        strokeThickness: 6,
        align: 'center',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 140, 'Longest reign takes the crown', {
        fontFamily: 'Arial',
        fontSize: 20,
        color: '#9fd8ff',
      })
      .setOrigin(0.5);

    // Personal best + all-time rank — the reason to come back and climb.
    const roundBest = this.board.find((s) => s.name === this.me)?.longestMs ?? 0;
    const bestText = this.add
      .text(
        cx,
        176,
        roundBest > 0 ? `🏆 Your reign this round: ${(roundBest / 1000).toFixed(1)}s` : '',
        { fontFamily: 'Arial', fontSize: 18, color: '#ffe9a8' }
      )
      .setOrigin(0.5);
    void fetch('/api/profile')
      .then((r) => r.json())
      .then((p: ProfileResponse) => {
        const best = Math.max(p.longestReign, roundBest);
        if (best <= 0) return;
        const rank = p.rank > 0 ? ` · #${p.rank} all-time` : '';
        bestText.setText(`🏆 Your best reign: ${(best / 1000).toFixed(1)}s${rank}`);
      })
      .catch(() => {});

    // Table columns.
    const nameX = 160;
    const totalX = 540;
    const longestX = 690;
    const killsX = 820;
    const headY = 210;

    const headStyle = { fontFamily: 'Arial', fontSize: 17, color: '#9fd8ff' } as const;
    this.add.text(nameX, headY, 'PLAYER', headStyle).setOrigin(0, 0.5);
    this.add.text(totalX, headY, 'TOTAL', headStyle).setOrigin(0.5, 0.5);
    this.add.text(longestX, headY, 'LONGEST', headStyle).setOrigin(0.5, 0.5);
    this.add.text(killsX, headY, 'KILLS', headStyle).setOrigin(0.5, 0.5);
    this.add.rectangle(cx, headY + 20, 720, 2, 0xffd24a, 0.4).setOrigin(0.5, 0.5);

    this.board.slice(0, 8).forEach((s, i) => {
      const mine = s.name === this.me;
      const color = i === 0 ? '#ffd24a' : mine ? '#f4ead0' : '#c9c2da';
      const size = mine ? 24 : 20;
      const style = { fontFamily: 'Arial', fontSize: size, color };
      const y = 258 + i * 42;
      this.add.text(nameX, y, `${i + 1}.  ${this.label(s.name)}`, style).setOrigin(0, 0.5);
      this.add.text(totalX, y, `${(s.holdMs / 1000).toFixed(1)}s`, style).setOrigin(0.5, 0.5);
      this.add.text(longestX, y, `${(s.longestMs / 1000).toFixed(1)}s`, style).setOrigin(0.5, 0.5);
      this.add.text(killsX, y, `${s.kills}`, style).setOrigin(0.5, 0.5);
    });

    // Share your reign — an actual screenshot where the device supports it, else a link back.
    const share = this.add
      .text(cx, 656, '📣  Share your reign', {
        fontFamily: 'Arial',
        fontSize: 20,
        color: '#ffd24a',
        backgroundColor: '#241a3d',
        padding: { x: 20, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    share.on('pointerup', () => this.shareScore());

    // Play again (primary).
    const again = this.add
      .text(cx, 716, '▶  Play again', {
        fontFamily: 'Arial Black',
        fontSize: 26,
        color: '#2a1a05',
        backgroundColor: '#ffc531',
        padding: { x: 32, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    again.on('pointerup', () => this.scene.start('Lobby', { fresh: true }));
    this.tweens.add({ targets: again, scale: { from: 1, to: 1.05 }, duration: 800, yoyo: true, repeat: -1 });
  }


  private boast(): string {
    const mine = this.board.find((s) => s.name === this.me);
    const top = this.board[0];
    const won = !!top && top.name === this.me && top.holdMs > 0;
    return mine
      ? `I ${won ? 'won the crown 👑' : 'fought for the crown'} in Hold Your Crown — ` +
        `${(mine.holdMs / 1000).toFixed(1)}s total reign, best streak ${(mine.longestMs / 1000).toFixed(1)}s, ` +
        `${mine.kills} KOs. Think you can hold it longer?`
      : 'Hold Your Crown — grab the crown and hold it longest to win! 👑';
  }

  // Share the result: an actual screenshot where the device supports file sharing,
  // otherwise a link back to the post with the boast text.
  private shareScore(): void {
    const text = this.boast();
    this.game.renderer.snapshot((snap) => {
      void (async () => {
        if (snap instanceof HTMLImageElement) {
          try {
            const blob = await (await fetch(snap.src)).blob();
            const file = new File([blob], 'hold-your-crown.png', { type: 'image/png' });
            if (navigator.canShare?.({ files: [file] })) {
              await navigator.share({ files: [file], title: 'Hold Your Crown', text });
              return;
            }
          } catch {
            // fall through to the link share
          }
        }
        void showShareSheet({ title: 'Hold Your Crown', text });
      })();
    });
  }

  private label(name: string): string {
    return name === this.me ? 'You' : name;
  }
}
