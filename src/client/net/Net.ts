import { connectRealtime, disconnectRealtime, context } from '@devvit/web/client';
import type {
  AttackPayload,
  CrownDropPayload,
  CrownGrabPayload,
  CrownGrabResponse,
  GameMsg,
  KillPayload,
  PickupClaimPayload,
  PickupClaimResponse,
  StatePayload,
} from '../../shared/net';

/**
 * Thin networking wrapper. We receive via Devvit realtime (`connectRealtime`)
 * and send through the server (`/api/state`), which stamps our real identity and
 * re-broadcasts on the game channel.
 */
export class Net {
  /** Our own username — used to ignore echoes of our own messages. */
  readonly me: string;
  private channel = '';

  constructor() {
    this.me = context.username ?? 'anon';
  }

  connect(channel: string, onMessage: (msg: GameMsg) => void): void {
    this.channel = channel;
    connectRealtime<GameMsg>({ channel, onMessage });
  }

  disconnect(): void {
    if (this.channel) disconnectRealtime(this.channel);
  }

  sendState(payload: StatePayload): void {
    void fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  sendAttack(payload: AttackPayload): void {
    void fetch('/api/attack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  sendKill(payload: KillPayload): void {
    void fetch('/api/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async claimPickup(payload: PickupClaimPayload): Promise<PickupClaimResponse> {
    const res = await fetch('/api/pickup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data: PickupClaimResponse = await res.json();
    return data;
  }

  async grabCrown(payload: CrownGrabPayload): Promise<CrownGrabResponse> {
    const res = await fetch('/api/crown/grab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data: CrownGrabResponse = await res.json();
    return data;
  }

  dropCrown(payload: CrownDropPayload): void {
    void fetch('/api/crown/drop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}
