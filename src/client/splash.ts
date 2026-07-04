import { context, requestExpandedMode, showShareSheet } from '@devvit/web/client';
import type { LeaderboardResponse } from '../shared/net';

// Tapping the button expands the inline splash into the full game view.
const startButton = document.getElementById('start-button');
startButton?.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});

// Invite: native share sheet (or clipboard copy) with a link back to this post.
document.getElementById('invite-button')?.addEventListener('click', () => {
  void showShareSheet({
    title: 'Hold Your Crown',
    text: 'Join the live crown battle — grab the crown and hold it longest to win! 👑',
  });
});

// How-to lives in a modal so the splash stays easy to scan.
const howtoModal = document.getElementById('howto-modal');
document.getElementById('howto-button')?.addEventListener('click', () => howtoModal?.classList.add('open'));
document.getElementById('howto-close')?.addEventListener('click', () => howtoModal?.classList.remove('open'));
howtoModal?.addEventListener('click', (e) => {
  if (e.target === howtoModal) howtoModal.classList.remove('open'); // tap backdrop to close
});

// Personalize the hint if we know who's viewing.
const hint = document.getElementById('hint');
if (hint && context.username) {
  hint.textContent = `Ready to play, u/${context.username}`;
}

// Show the record to beat — a live hook right on the post preview.
void fetch('/api/leaderboard')
  .then((r) => r.json())
  .then((lb: LeaderboardResponse) => {
    const top = lb.allTime?.[0];
    const el = document.getElementById('topreign');
    if (el && top) {
      const secs = (top.score / 1000).toFixed(1);
      el.textContent =
        top.name === context.username
          ? `🏆 You hold the longest reign — ${secs}s. Defend your crown!`
          : `🏆 Longest reign: u/${top.name} — ${secs}s. Can you beat it?`;
    }
  })
  .catch(() => {});
