import * as Phaser from 'phaser';

export const SHIELD_MAX = 100;

export type KnightOptions = {
  scene: Phaser.Scene;
  x: number;
  y: number;
  texture: string;
  name: string;
  maxHp?: number;
};

export class Knight {
  readonly sprite: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  readonly maxHp: number;
  hp: number;
  shield = 0;
  alive = true;
  facing = 0;

  private readonly scene: Phaser.Scene;
  private readonly nameLabel: Phaser.GameObjects.Text;
  private readonly hpBarBg: Phaser.GameObjects.Rectangle;
  private readonly hpBarFill: Phaser.GameObjects.Rectangle;
  private readonly crownIcon: Phaser.GameObjects.Text;
  private readonly shieldRing: Phaser.GameObjects.Arc;

  constructor(opts: KnightOptions) {
    this.scene = opts.scene;
    this.maxHp = opts.maxHp ?? 100;
    this.hp = this.maxHp;

    this.sprite = opts.scene.physics.add.image(opts.x, opts.y, opts.texture);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDrag(700, 700);
    this.sprite.setDepth(5);

    this.nameLabel = opts.scene.add
      .text(opts.x, opts.y - 44, opts.name, {
        fontFamily: 'Arial',
        fontSize: 16,
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(8);

    this.hpBarBg = opts.scene.add.rectangle(opts.x, opts.y - 30, 46, 7, 0x000000, 0.65).setDepth(8);
    this.hpBarFill = opts.scene.add
      .rectangle(opts.x - 22, opts.y - 30, 42, 5, 0x49d24f)
      .setOrigin(0, 0.5)
      .setDepth(9);

    this.crownIcon = opts.scene.add
      .text(opts.x, opts.y - 64, '👑', { fontFamily: 'Arial', fontSize: 26 })
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false);

    this.shieldRing = opts.scene.add
      .circle(opts.x, opts.y, 30)
      .setStrokeStyle(3, 0x5fd0ff, 0.9)
      .setDepth(4)
      .setVisible(false);
  }

  setFacing(angle: number): void {
    this.facing = angle;
    this.sprite.setRotation(angle);
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    // Shield absorbs damage first, then health.
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
    }
    this.hp = Math.max(0, this.hp - amount);
    this.flash();
    if (this.hp <= 0) this.die();
  }

  heal(amount: number): void {
    if (!this.alive) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  addShield(amount: number): void {
    if (!this.alive) return;
    this.shield = Math.min(SHIELD_MAX, this.shield + amount);
  }

  /** Clear "got hit" feedback: flash red + pop, visible to everyone. */
  flash(): void {
    this.sprite.setTint(0xff5b5b);
    this.scene.time.delayedCall(150, () => this.sprite.clearTint());
    this.scene.tweens.add({
      targets: this.sprite,
      scale: { from: 1.28, to: 1 },
      duration: 190,
      ease: 'Quad.easeOut',
    });
  }

  setCrown(has: boolean): void {
    this.crownIcon.setVisible(has && this.alive);
  }

  respawn(x: number, y: number): void {
    this.alive = true;
    this.hp = this.maxHp;
    this.shield = 0;
    this.sprite.setPosition(x, y).setVelocity(0, 0).setAlpha(1).setVisible(true).setScale(1).clearTint();
    this.nameLabel.setVisible(true);
    this.hpBarBg.setVisible(true);
    this.hpBarFill.setVisible(true);
  }

  private die(): void {
    this.alive = false;
    this.shield = 0;
    this.sprite.setVelocity(0, 0).setVisible(false).setScale(1).clearTint();
    this.nameLabel.setVisible(false);
    this.hpBarBg.setVisible(false);
    this.hpBarFill.setVisible(false);
    this.crownIcon.setVisible(false);
    this.shieldRing.setVisible(false);
  }

  /** Keep the name label + hp bar glued to the sprite. Call every frame. */
  syncUi(): void {
    const x = this.sprite.x;
    const y = this.sprite.y;
    this.nameLabel.setPosition(x, y - 44);
    this.hpBarBg.setPosition(x, y - 30);
    this.hpBarFill.setPosition(x - 22, y - 30);
    this.hpBarFill.scaleX = this.hp / this.maxHp;
    this.crownIcon.setPosition(x, y - 64);
    this.shieldRing.setPosition(x, y).setVisible(this.alive && this.shield > 0);
  }

  setName(name: string): void {
    this.nameLabel.setText(name);
  }

  /** Mark this knight as network-driven: physics won't move it; the scene lerps it. */
  freeze(): void {
    this.sprite.body.moves = false;
  }

  /** Drive hp + visibility from a remote broadcast. */
  applyRemoteHp(hp: number, alive: boolean): void {
    const next = Phaser.Math.Clamp(hp, 0, this.maxHp);
    if (alive && next < this.hp) this.flash(); // took damage → visible hit pulse on every screen
    this.hp = next;
    if (alive !== this.alive) {
      this.alive = alive;
      this.sprite.setVisible(alive).setAlpha(1);
      this.nameLabel.setVisible(alive);
      this.hpBarBg.setVisible(alive);
      this.hpBarFill.setVisible(alive);
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.nameLabel.destroy();
    this.hpBarBg.destroy();
    this.hpBarFill.destroy();
    this.crownIcon.destroy();
    this.shieldRing.destroy();
  }
}
