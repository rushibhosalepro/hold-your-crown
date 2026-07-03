import { Scene } from 'phaser';

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
      winner && winner.holdMs > 0 ? `👑 ${this.label(winner.name)} wins!` : 'No one held the crown';
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

    const hint = this.add
      .text(cx, 710, '▶  Tap to play again', { fontFamily: 'Arial', fontSize: 24, color: '#ffffff' })
      .setOrigin(0.5);
    this.tweens.add({ targets: hint, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });

    // Re-queue into a fresh lobby (fresh=true so /join won't rejoin the game that just ended).
    this.input.once('pointerdown', () => this.scene.start('Lobby', { fresh: true }));
  }

  private label(name: string): string {
    return name === this.me ? 'You' : name;
  }
}
