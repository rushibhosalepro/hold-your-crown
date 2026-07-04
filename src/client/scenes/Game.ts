import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { Knight } from './entities/Knight';
import { Net } from '../net/Net';
import type { GameMsg } from '../../shared/net';
import { CYCLE_MS, LOBBY_MS } from '../../shared/constants';

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
const SWORD_DAMAGE = 55;
const KNOCKBACK = 340;
const KNOCKBACK_LOCK = 200; // ms the hit victim can't steer while flung back
const ATTACK_COOLDOWN = 380; // ms between swings
const RESPAWN_MS = 2500;

// Crown.
const CROWN_START_X = ARENA_W / 2;
const CROWN_START_Y = ARENA_H / 2;
const CROWN_PICKUP_RANGE = 46;

// Pickups (one deterministic pickup per interval; atomic claim).
const PICKUP_INTERVAL = 8000;
const PICKUP_RANGE = 46;
const HEAL_AMOUNT = 40;
const SHIELD_AMOUNT = 50;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Deterministic spot + type for pickup index k — every client computes the same thing.
function pickupSpot(gameId: string, k: number): { x: number; y: number; type: 'health' | 'shield' } {
  const margin = WALL + 70;
  const x = margin + (hashStr(`${gameId}:${k}:x`) % (ARENA_W - margin * 2));
  const y = margin + (hashStr(`${gameId}:${k}:y`) % (ARENA_H - margin * 2));
  return { x, y, type: k % 2 === 0 ? 'health' : 'shield' };
}

// On-screen attack button (fixed to the screen).
const ATTACK_BTN_X = ARENA_W - 96;
const ATTACK_BTN_Y = ARENA_H - 96;
const ATTACK_BTN_R = 56;

// Networking.
const BROADCAST_MS = 60; // ~16 Hz state broadcast
const REMOTE_TIMEOUT = 10000; // drop a remote we haven't heard from in this long
const SMOOTH_TAU = 55; // ms; remote easing time constant (smaller = snappier / less lag)
const SNAP_DIST = 220; // jump farther than this (respawn/teleport) ⇒ snap instead of sliding

type Remote = {
  knight: Knight;
  tx: number;
  ty: number;
  tFacing: number;
  lastSeen: number;
  holdMs: number;
  longestMs: number;
  kills: number;
  hasCrown: boolean;
};

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

  // Room context handed over from the Lobby scene (used by the upcoming realtime step).
  private gameId = '';
  private channel = '';
  private createdAt = 0;
  private clockOffset = 0;

  private net?: Net | undefined;
  private readonly remotes = new Map<string, Remote>();

  private knockbackUntil = 0;

  // Crown state (one shared crown). holder = username, or null when it's on the ground.
  private crownHolder: string | null = null; // derived each frame from state broadcasts
  private iHold = false; // do WE currently hold the crown (authoritative locally)
  private crownX = CROWN_START_X;
  private crownY = CROWN_START_Y;
  private myHoldMs = 0; // cumulative reign this round (win metric)
  private myStreakMs = 0; // current unbroken reign (resets on death/drop)
  private myLongestMs = 0; // best single reign this round (highlight stat)
  private grabCooldownUntil = 0;
  private crownSprite: Phaser.GameObjects.Text;
  private holdText: Phaser.GameObjects.Text;
  private timerText: Phaser.GameObjects.Text;
  private roundOver = false;

  private myKills = 0;
  private lastAttacker = ''; // who last damaged us (for kill attribution)
  private readonly claimedPickups = new Set<number>();
  private pickupCooldownUntil = 0;
  private pickupSprite: Phaser.GameObjects.Text;
  private killFeedText: Phaser.GameObjects.Text;

  constructor() {
    super('Game');
  }

  init(data: { gameId?: string; channel?: string; createdAt?: number; clockOffset?: number }) {
    this.gameId = data.gameId ?? '';
    this.channel = data.channel ?? '';
    this.createdAt = data.createdAt ?? 0;
    this.clockOffset = data.clockOffset ?? 0;

    // Phaser reuses the scene instance across rounds, so reset all per-round state here.
    this.remotes.clear();
    this.net = undefined;
    this.roundOver = false;
    this.iHold = false;
    this.crownHolder = null;
    this.crownX = CROWN_START_X;
    this.crownY = CROWN_START_Y;
    this.myHoldMs = 0;
    this.myStreakMs = 0;
    this.myLongestMs = 0;
    this.grabCooldownUntil = 0;
    this.knockbackUntil = 0;
    this.attackReadyAt = 0;
    this.requestAttack = false;
    this.joyActive = false;
    this.joyPointerId = null;
    this.joyVec.set(0, 0);
    this.myKills = 0;
    this.lastAttacker = '';
    this.claimedPickups.clear();
    this.pickupCooldownUntil = 0;
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

    this.crownSprite = this.add
      .text(this.crownX, this.crownY, '👑', { fontFamily: 'Arial', fontSize: 34 })
      .setOrigin(0.5)
      .setDepth(6);

    this.timerText = this.add
      .text(ARENA_W / 2, 14, '', {
        fontFamily: 'Arial Black',
        fontSize: 30,
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 5,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(30);

    this.holdText = this.add
      .text(ARENA_W / 2, 54, '', {
        fontFamily: 'Arial',
        fontSize: 22,
        color: '#ffd24a',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(30);

    this.pickupSprite = this.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: 30 })
      .setOrigin(0.5)
      .setDepth(6)
      .setVisible(false);

    this.killFeedText = this.add
      .text(ARENA_W / 2, 92, '', {
        fontFamily: 'Arial',
        fontSize: 18,
        color: '#ff8f8f',
        stroke: '#000000',
        strokeThickness: 4,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(30)
      .setAlpha(0);

    const startHint = this.add
      .text(
        ARENA_W / 2,
        ARENA_H - 130,
        'Grab the crown 👑 and hold it longest to win!\nInvite friends for a real battle.',
        {
          fontFamily: 'Arial',
          fontSize: 19,
          color: '#ffe9a8',
          stroke: '#000000',
          strokeThickness: 4,
          align: 'center',
          lineSpacing: 4,
        }
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(29);
    this.tweens.add({
      targets: startHint,
      alpha: 0,
      delay: 4500,
      duration: 1200,
      onComplete: () => startHint.destroy(),
    });

    console.info(
      `[arena] game=${this.gameId} channel=${this.channel} createdAt=${this.createdAt} offset=${this.clockOffset}`
    );

    // Real-time multiplayer: subscribe to the room channel + broadcast our state.
    // Wrapped in try/catch so a networking failure can't throw out of create() and
    // kill Phaser's render loop (which would freeze the game on the transition frame).
    if (this.channel) {
      try {
        this.net = new Net();
        this.net.connect(this.channel, (msg) => this.onMessage(msg));
        // Real setInterval (not a Phaser timer) so the heartbeat survives a backgrounded tab.
        const broadcastId = setInterval(() => this.broadcast(), BROADCAST_MS);
        const cleanup = () => {
          clearInterval(broadcastId);
          this.net?.disconnect();
        };
        this.events.once('shutdown', cleanup);
        this.events.once('destroy', cleanup);
      } catch (err) {
        console.error('[net] setup failed:', err);
      }
    }
  }

  private broadcast() {
    if (!this.net || !this.channel) return;
    this.net.sendState({
      channel: this.channel,
      x: Math.round(this.player.sprite.x),
      y: Math.round(this.player.sprite.y),
      facing: Math.round(this.player.facing * 100) / 100,
      hp: this.player.hp,
      shield: this.player.shield,
      alive: this.player.alive,
      hasCrown: this.iHold,
      holdMs: Math.round(this.myHoldMs),
      longestMs: Math.round(this.myLongestMs),
      kills: this.myKills,
    });
  }

  private onMessage(msg: GameMsg) {
    if (!this.net) return;

    // Kills process regardless of sender (both the killer and the victim need them).
    if (msg.kind === 'kill') {
      if (msg.killer === this.net.me) this.myKills += 1;
      this.showKill(`u/${msg.killer}  ⚔  u/${msg.victim}`);
      return;
    }

    // State + attack: ignore our own echoes.
    if (msg.t2 === this.net.me) return;

    if (msg.kind === 'attack') {
      // Render the attacker's swing and self-apply the hit if our player is in the arc.
      this.showSlash(msg.x, msg.y, msg.facing);
      if (this.player.alive) {
        const dx = this.player.sprite.x - msg.x;
        const dy = this.player.sprite.y - msg.y;
        const ang = Math.atan2(dy, dx);
        const inArc =
          Math.abs(Phaser.Math.Angle.Wrap(ang - msg.facing)) <= Phaser.Math.DegToRad(SWORD_ARC_DEG) / 2;
        if (Math.hypot(dx, dy) <= SWORD_RANGE && inArc) {
          this.lastAttacker = msg.t2; // remember who hit us, for kill attribution
          this.player.takeDamage(SWORD_DAMAGE);
          this.player.sprite.setVelocity(Math.cos(ang) * KNOCKBACK, Math.sin(ang) * KNOCKBACK);
          this.knockbackUntil = this.time.now + KNOCKBACK_LOCK;
          if (!this.player.alive) this.onLocalDeath();
        }
      }
      return;
    }

    if (msg.kind === 'pickup') {
      this.claimedPickups.add(msg.id);
      return;
    }

    if (msg.kind !== 'state') return;

    this.upsertRemote(msg.t2, 'knight-blue', msg.name, msg.x, msg.y, msg.facing, msg.hp, msg.alive, {
      holdMs: msg.holdMs,
      longestMs: msg.longestMs,
      kills: msg.kills,
      hasCrown: msg.hasCrown,
      shield: msg.shield,
    });
  }

  // Create-or-update a rendered remote player from a state broadcast.
  private upsertRemote(
    id: string,
    texture: string,
    name: string,
    x: number,
    y: number,
    facing: number,
    hp: number,
    alive: boolean,
    extra: { holdMs: number; longestMs: number; kills: number; hasCrown: boolean; shield?: number }
  ) {
    const now = this.time.now;
    let r = this.remotes.get(id);
    if (!r) {
      const knight = new Knight({ scene: this, x, y, texture, name });
      knight.freeze();
      r = { knight, tx: x, ty: y, tFacing: facing, lastSeen: now, holdMs: 0, longestMs: 0, kills: 0, hasCrown: false };
      this.remotes.set(id, r);
    }
    r.tx = x;
    r.ty = y;
    r.tFacing = facing;
    r.lastSeen = now;
    r.holdMs = extra.holdMs;
    r.longestMs = extra.longestMs;
    r.kills = extra.kills;
    r.hasCrown = extra.hasCrown;
    r.knight.shield = extra.shield ?? 0;
    r.knight.setName(name);
    r.knight.applyRemoteHp(hp, alive);
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
    if (!this.player.alive || time < this.attackReadyAt) return;
    this.attackReadyAt = time + ATTACK_COOLDOWN;

    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const facing = this.player.facing;
    this.showSlash(px, py, facing);
    this.tweens.add({ targets: this.player.sprite, scale: { from: 1.18, to: 1 }, duration: 120 });

    // Broadcast the swing; every other client renders it and any victim self-applies the hit.
    this.net?.sendAttack({
      channel: this.channel,
      x: Math.round(px),
      y: Math.round(py),
      facing: Math.round(facing * 100) / 100,
    });

    // Instant feedback: flash any remote our swing likely caught (their HP broadcast stays authoritative).
    const halfArc = Phaser.Math.DegToRad(SWORD_ARC_DEG) / 2;
    for (const [, r] of this.remotes) {
      if (!r.knight.alive) continue;
      const dx = r.knight.sprite.x - px;
      const dy = r.knight.sprite.y - py;
      if (Math.hypot(dx, dy) > SWORD_RANGE) continue;
      if (Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - facing)) <= halfArc) r.knight.flash();
    }
  }

  private showSlash(x: number, y: number, facing: number) {
    const startDeg = Phaser.Math.RadToDeg(facing) - SWORD_ARC_DEG / 2;
    const endDeg = Phaser.Math.RadToDeg(facing) + SWORD_ARC_DEG / 2;
    const slash = this.add
      .arc(x, y, SWORD_RANGE, startDeg, endDeg, false, 0xffffff, 0.45)
      .setDepth(4);
    this.tweens.add({ targets: slash, alpha: 0, duration: 150, onComplete: () => slash.destroy() });
  }

  private onLocalDeath() {
    // Report who killed us — the kill message drives the feed (incl. our own echo) + the counter.
    if (this.net && this.lastAttacker) {
      this.net.sendKill({ channel: this.channel, killer: this.lastAttacker, victim: this.net.me });
    }
    // If we were holding the crown, release it (server bumps the version); others see our
    // hasCrown=false in the next state broadcast and treat the crown as loose.
    if (this.iHold) {
      this.iHold = false;
      this.myStreakMs = 0; // streak broken; myLongestMs keeps the peak
      this.crownX = this.player.sprite.x;
      this.crownY = this.player.sprite.y;
      this.net?.dropCrown({ channel: this.channel, gameId: this.gameId, x: this.crownX, y: this.crownY });
    }
    this.time.delayedCall(RESPAWN_MS, () => {
      this.player.respawn(
        Phaser.Math.Between(WALL + PLAYER_SIZE / 2, ARENA_W - WALL - PLAYER_SIZE / 2),
        Phaser.Math.Between(WALL + PLAYER_SIZE / 2, ARENA_H - WALL - PLAYER_SIZE / 2)
      );
    });
  }

  private async tryGrabCrown() {
    if (!this.net || this.iHold || this.crownHolder !== null) return;
    const res = await this.net.grabCrown({ channel: this.channel, gameId: this.gameId });
    if (res.won) this.iHold = true;
  }

  private async tryPickup(k: number, type: 'health' | 'shield') {
    if (!this.net || this.claimedPickups.has(k)) return;
    const res = await this.net.claimPickup({ channel: this.channel, gameId: this.gameId, id: k });
    if (res.won) {
      this.claimedPickups.add(k);
      if (type === 'health') this.player.heal(HEAL_AMOUNT);
      else this.player.addShield(SHIELD_AMOUNT);
    }
  }

  private showKill(text: string) {
    this.killFeedText.setText(text).setAlpha(1);
    this.tweens.killTweensOf(this.killFeedText);
    this.tweens.add({ targets: this.killFeedText, alpha: 0, delay: 2200, duration: 800 });
  }

  private updateHud() {
    if (!this.net) return;
    if (this.crownHolder === this.net.me) {
      this.holdText.setText(`👑 Your reign: ${(this.myHoldMs / 1000).toFixed(1)}s`);
    } else if (this.crownHolder) {
      const r = this.remotes.get(this.crownHolder);
      const t = r ? ` — ${(r.holdMs / 1000).toFixed(1)}s` : '';
      this.holdText.setText(`👑 ${this.crownHolder}${t}`);
    } else {
      this.holdText.setText('👑 The crown is up for grabs!');
    }
  }

  private serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  private endRound() {
    this.roundOver = true;
    const board: { name: string; holdMs: number; longestMs: number; kills: number }[] = [
      {
        name: this.net?.me ?? 'You',
        holdMs: this.myHoldMs,
        longestMs: this.myLongestMs,
        kills: this.myKills,
      },
    ];
    for (const [name, r] of this.remotes) {
      board.push({ name, holdMs: r.holdMs, longestMs: r.longestMs, kills: r.kills });
    }
    board.sort((a, b) => b.holdMs - a.holdMs);

    // Persist our own result to the lifetime profile + reign leaderboards.
    const me = this.net?.me ?? 'You';
    const top = board[0];
    const won = !!top && top.name === me && top.holdMs > 0;
    this.net?.sendScore({
      kills: this.myKills,
      win: won,
      holdTotalMs: Math.round(this.myHoldMs),
      longestMs: Math.round(this.myLongestMs),
    });

    this.scene.start('GameOver', { board, me });
  }

  override update(time: number, delta: number) {
    // Round clock: end after the fight window (anchored to the shared createdAt).
    if (this.createdAt > 0 && !this.roundOver) {
      const remaining = this.createdAt + CYCLE_MS - this.serverNow();
      if (remaining <= 0) {
        this.endRound();
        return;
      }
      const secs = Math.max(0, Math.ceil(remaining / 1000));
      this.timerText.setText(`${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`);
    }

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

    // Movement is disabled while dead or briefly after being knocked back.
    const canControl = this.player.alive && time >= this.knockbackUntil;
    const len = Math.hypot(mx, my);
    if (canControl && len > 0.08) {
      const nx = len > 1 ? mx / len : mx;
      const ny = len > 1 ? my / len : my;
      this.player.sprite.setVelocity(nx * PLAYER_SPEED, ny * PLAYER_SPEED);
      this.player.setFacing(Math.atan2(ny, nx));
    } else if (canControl) {
      this.player.sprite.setVelocity(0, 0);
    }

    const wantAttack = this.requestAttack || (this.cursors?.space?.isDown ?? false);
    this.requestAttack = false;
    if (wantAttack) this.performAttack(time);

    this.player.syncUi();

    // Crown: derive the holder from the latest state broadcasts (self-healing), accrue reign,
    // and allow grabbing a loose crown.
    if (this.iHold && this.player.alive) {
      this.myHoldMs += delta;
      this.myStreakMs += delta;
      this.myLongestMs = Math.max(this.myLongestMs, this.myStreakMs);
    }

    const me = this.net?.me ?? null;
    const prevHolder = this.crownHolder;
    let holder: string | null = null;
    if (this.iHold) {
      holder = me;
    } else {
      for (const [name, r] of this.remotes) {
        if (r.hasCrown && r.knight.alive) {
          holder = name;
          break;
        }
      }
    }
    // Crown just became loose → it drops where the last holder was standing.
    if (prevHolder !== null && holder === null) {
      const lastPos =
        prevHolder === me ? this.player.sprite : this.remotes.get(prevHolder)?.knight.sprite;
      if (lastPos) {
        this.crownX = lastPos.x;
        this.crownY = lastPos.y;
      }
    }
    this.crownHolder = holder;

    if (holder === null && this.player.alive && time > this.grabCooldownUntil) {
      const d = Math.hypot(this.player.sprite.x - this.crownX, this.player.sprite.y - this.crownY);
      if (d <= CROWN_PICKUP_RANGE) {
        this.grabCooldownUntil = time + 500; // don't spam the endpoint while standing on it
        void this.tryGrabCrown();
      }
    }

    this.crownSprite.setVisible(holder === null).setPosition(this.crownX, this.crownY);
    this.player.setCrown(this.iHold && this.player.alive);
    this.updateHud();

    // Pickups: one deterministic pickup per interval; grabbing it is an atomic claim.
    if (this.createdAt > 0 && !this.roundOver) {
      const elapsed = this.serverNow() - (this.createdAt + LOBBY_MS);
      const k = elapsed >= 0 ? Math.floor(elapsed / PICKUP_INTERVAL) : -1;
      if (k >= 0 && !this.claimedPickups.has(k)) {
        const spot = pickupSpot(this.gameId, k);
        this.pickupSprite
          .setVisible(true)
          .setText(spot.type === 'health' ? '❤️' : '🛡️')
          .setPosition(spot.x, spot.y);
        if (this.player.alive && time > this.pickupCooldownUntil) {
          const d = Math.hypot(this.player.sprite.x - spot.x, this.player.sprite.y - spot.y);
          if (d <= PICKUP_RANGE) {
            this.pickupCooldownUntil = time + 400;
            void this.tryPickup(k, spot.type);
          }
        }
      } else {
        this.pickupSprite.setVisible(false);
      }
    } else {
      this.pickupSprite.setVisible(false);
    }

    // Ease remotes toward their latest reported position (frame-rate independent); snap on
    // big jumps (respawns/teleports) instead of sliding across the arena. Drop stale ones.
    const smooth = 1 - Math.exp(-delta / SMOOTH_TAU);
    for (const [id, r] of this.remotes) {
      if (time - r.lastSeen > REMOTE_TIMEOUT) {
        r.knight.destroy();
        this.remotes.delete(id);
        continue;
      }
      const sp = r.knight.sprite;
      if (Math.hypot(r.tx - sp.x, r.ty - sp.y) > SNAP_DIST) {
        sp.setPosition(r.tx, r.ty);
      } else {
        sp.x += (r.tx - sp.x) * smooth;
        sp.y += (r.ty - sp.y) * smooth;
      }
      r.knight.setFacing(r.tFacing);
      r.knight.setCrown(this.crownHolder === id);
      r.knight.syncUi();
    }
  }
}
