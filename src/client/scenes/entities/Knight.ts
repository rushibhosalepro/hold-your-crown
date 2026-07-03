import * as Phaser from 'phaser';

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
  alive = true;
  facing = 0;

  private readonly scene: Phaser.Scene;
  private readonly nameLabel: Phaser.GameObjects.Text;
  private readonly hpBarBg: Phaser.GameObjects.Rectangle;
  private readonly hpBarFill: Phaser.GameObjects.Rectangle;

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
  }

  setFacing(angle: number): void {
    this.facing = angle;
    this.sprite.setRotation(angle);
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    this.scene.tweens.add({ targets: this.sprite, alpha: { from: 0.35, to: 1 }, duration: 180 });
    if (this.hp <= 0) this.alive = false;
  }

  /** Keep the name label + hp bar glued to the sprite. Call every frame. */
  syncUi(): void {
    const x = this.sprite.x;
    const y = this.sprite.y;
    this.nameLabel.setPosition(x, y - 44);
    this.hpBarBg.setPosition(x, y - 30);
    this.hpBarFill.setPosition(x - 22, y - 30);
    this.hpBarFill.scaleX = this.hp / this.maxHp;
  }
}
