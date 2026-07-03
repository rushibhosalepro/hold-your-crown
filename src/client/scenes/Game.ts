import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { Knight } from './entities/Knight';

// Logical arena dimensions (match the FIT resolution in game.ts).
const ARENA_W = 1024;
const ARENA_H = 768;
const WALL = 40;
const PLAYER_SPEED = 280;
const PLAYER_SIZE = 48;
const JOY_RADIUS = 72;

// Combat.
const SWORD_RANGE = 90;
const SWORD_ARC_DEG = 100;
const ATTACK_COOLDOWN = 380; // ms between swings

// On-screen attack button (fixed to the screen).
const ATTACK_BTN_X = ARENA_W - 96;
const ATTACK_BTN_Y = ARENA_H - 96;
const ATTACK_BTN_R = 56;

export class Game extends Scene {
  private player: Knight;

  private joyBase: Phaser.GameObjects.Arc;
  private joyThumb: Phaser.GameObjects.Arc;
  private joyActive = false;
  private joyPointerId: number | null = null;
  private joyStart = new Phaser.Math.Vector2();
  private joyVec = new Phaser.Math.Vector2();

  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW?: Phaser.Input.Keyboard.Key;
  private keyA?: Phaser.Input.Keyboard.Key;
  private keyS?: Phaser.Input.Keyboard.Key;
  private keyD?: Phaser.Input.Keyboard.Key;

  private requestAttack = false;
  private attackReadyAt = 0;

  private username = 'You';

  constructor() {
    super('Game');
  }

  create() {
    const spawnX = Phaser.Math.Between(WALL + PLAYER_SIZE / 2, ARENA_W - WALL - PLAYER_SIZE / 2);
    const spawnY = Phaser.Math.Between(WALL + PLAYER_SIZE / 2, ARENA_H - WALL - PLAYER_SIZE / 2);

    this.cameras.main.setBackgroundColor(0x0a0816);
    this.buildArena();

    this.createKnightTexture('knight-blue', 0x3d7bd4);
    this.createKnightTexture('knight-red', 0xd24f4f);
    this.physics.world.setBounds(WALL, WALL, ARENA_W - WALL * 2, ARENA_H - WALL * 2);

    this.player = new Knight({
      scene: this,
      x: spawnX,
      y: spawnY,
      texture: 'knight-red',
      name: this.username,
    });

    this.buildJoystick();
    this.buildAttackButton();
    this.setupInput();
    this.input.addPointer(2); // allow move + attack at the same time on touch
  }

  private buildArena() {
    const cx = ARENA_W / 2;
    const cy = ARENA_H / 2;
    this.add
      .rectangle(cx, cy, ARENA_W - WALL * 2, ARENA_H - WALL * 2, 0x241a3d)
      .setStrokeStyle(8, 0xffd24a)
      .setDepth(0);
  }

  private createKnightTexture(key: string, color: number) {
    if (this.textures.exists(key)) return;
    const s = PLAYER_SIZE;
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillCircle(s / 2, s / 2, s / 2 - 4);
    g.lineStyle(3, 0xffffff, 1);
    g.strokeCircle(s / 2, s / 2, s / 2 - 4);
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(s - 5, s / 2, s / 2 + 3, s / 2 - 8, s / 2 + 3, s / 2 + 8);
    g.generateTexture(key, s, s);
    g.destroy();
  }

  private buildJoystick() {
    this.joyBase = this.add
      .circle(0, 0, JOY_RADIUS, 0xffffff, 0.1)
      .setStrokeStyle(2, 0xffffff, 0.35)
      .setVisible(false)
      .setScrollFactor(0)
      .setDepth(20);
    this.joyThumb = this.add
      .circle(0, 0, 30, 0xffffff, 0.35)
      .setVisible(false)
      .setScrollFactor(0)
      .setDepth(21);
  }

  private buildAttackButton() {
    this.add
      .circle(ATTACK_BTN_X, ATTACK_BTN_Y, ATTACK_BTN_R, 0xd24f4f, 0.45)
      .setStrokeStyle(3, 0xffffff, 0.7)
      .setScrollFactor(0)
      .setDepth(25);
    this.add
      .text(ATTACK_BTN_X, ATTACK_BTN_Y, '⚔', { fontFamily: 'Arial', fontSize: 40, color: '#ffffff' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(26);
  }

  private setupInput() {
    const kb = this.input.keyboard;
    if (kb) {
      this.cursors = kb.createCursorKeys();
      this.keyW = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
      this.keyA = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      this.keyS = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
      this.keyD = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    }

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // A press on the attack button swings; it never starts the joystick.
      if (Phaser.Math.Distance.Between(p.x, p.y, ATTACK_BTN_X, ATTACK_BTN_Y) <= ATTACK_BTN_R) {
        this.requestAttack = true;
        return;
      }
      if (this.joyPointerId !== null) return; // a finger already drives the stick
      this.joyPointerId = p.id;
      this.joyActive = true;
      this.joyStart.set(p.x, p.y);
      this.joyVec.set(0, 0);
      this.joyBase.setPosition(p.x, p.y).setVisible(true);
      this.joyThumb.setPosition(p.x, p.y).setVisible(true);
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.joyActive || p.id !== this.joyPointerId) return;
      const dx = p.x - this.joyStart.x;
      const dy = p.y - this.joyStart.y;
      const dist = Math.min(Math.hypot(dx, dy), JOY_RADIUS);
      const ang = Math.atan2(dy, dx);
      this.joyThumb.setPosition(
        this.joyStart.x + Math.cos(ang) * dist,
        this.joyStart.y + Math.sin(ang) * dist
      );
      const mag = dist / JOY_RADIUS;
      this.joyVec.set(Math.cos(ang) * mag, Math.sin(ang) * mag);
    });

    const endJoystick = (p: Phaser.Input.Pointer) => {
      if (p.id !== this.joyPointerId) return;
      this.joyPointerId = null;
      this.joyActive = false;
      this.joyVec.set(0, 0);
      this.joyBase.setVisible(false);
      this.joyThumb.setVisible(false);
    };
    this.input.on('pointerup', endJoystick);
    this.input.on('pointerupoutside', endJoystick);
  }

  private performAttack(time: number) {
    if (time < this.attackReadyAt) return;
    this.attackReadyAt = time + ATTACK_COOLDOWN;

    this.showSlash(this.player.sprite.x, this.player.sprite.y, this.player.facing);
    this.tweens.add({ targets: this.player.sprite, scale: { from: 1.18, to: 1 }, duration: 120 });
    // TODO: hit detection goes here once there are enemies (bots / remote players) to hit.
  }

  private showSlash(x: number, y: number, facing: number) {
    const startDeg = Phaser.Math.RadToDeg(facing) - SWORD_ARC_DEG / 2;
    const endDeg = Phaser.Math.RadToDeg(facing) + SWORD_ARC_DEG / 2;
    const slash = this.add
      .arc(x, y, SWORD_RANGE, startDeg, endDeg, false, 0xffffff, 0.45)
      .setDepth(4);
    this.tweens.add({ targets: slash, alpha: 0, duration: 150, onComplete: () => slash.destroy() });
  }

  override update(time: number) {
    let mx = 0;
    let my = 0;
    if (this.joyActive) {
      mx = this.joyVec.x;
      my = this.joyVec.y;
    } else {
      const left = (this.cursors?.left.isDown ?? false) || (this.keyA?.isDown ?? false);
      const right = (this.cursors?.right.isDown ?? false) || (this.keyD?.isDown ?? false);
      const up = (this.cursors?.up.isDown ?? false) || (this.keyW?.isDown ?? false);
      const down = (this.cursors?.down.isDown ?? false) || (this.keyS?.isDown ?? false);
      if (left) mx -= 1;
      if (right) mx += 1;
      if (up) my -= 1;
      if (down) my += 1;
    }

    // Normalize so diagonals aren't faster, then move + face that direction.
    const len = Math.hypot(mx, my);
    if (len > 0.08) {
      const nx = len > 1 ? mx / len : mx;
      const ny = len > 1 ? my / len : my;
      this.player.sprite.setVelocity(nx * PLAYER_SPEED, ny * PLAYER_SPEED);
      this.player.setFacing(Math.atan2(ny, nx));
    } else {
      this.player.sprite.setVelocity(0, 0);
    }

    const wantAttack = this.requestAttack || (this.cursors?.space?.isDown ?? false);
    this.requestAttack = false;
    if (wantAttack) this.performAttack(time);

    this.player.syncUi();
  }
}
