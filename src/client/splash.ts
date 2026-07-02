import { context, requestExpandedMode } from '@devvit/web/client';

// Tapping the button expands the inline splash into the full game view.
const startButton = document.getElementById('start-button');
startButton?.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});

// Personalize the hint if we know who's viewing.
const hint = document.getElementById('hint');
if (hint && context.username) {
  hint.textContent = `Ready, u/${context.username}?  ·  up to 10 players`;
}
