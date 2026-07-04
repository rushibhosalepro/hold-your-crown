# Hold Your Crown — Devpost Submission

**Elevator pitch:** A real-time multiplayer crown battle inside a Reddit post — grab the crown, hold it longest, and the whole lobby comes for you.

---

## Inspiration

Reddit is live, communal, and competitive — but almost every game built on it is not. Browse the Devvit games out there and you find daily puzzles, idle games, and collaborative apps: things you play *alone*, or with the crowd but never *against* it. There was an obvious empty lane — a **real-time, head-to-head** game where a Reddit post becomes a live arena.

So I built the oldest hook there is: *someone else is holding the thing you want.* One crown, ten knights, and a timer. The moment you grab the crown, everyone in the room turns on you. You don't come back for new content — you come back for the rematch.

The design is king-of-the-hill crossed with Halo's "oddball": the crown is mobile, it drops where you fall, and anyone can steal it. Most total time holding the crown wins the round.

---

## What It Does

**Hold Your Crown** is a real-time 2D multiplayer brawl that runs entirely inside a Reddit interactive post.

- **Up to 10 real players per room.** You enter a lobby, a short countdown fills the arena, then the fight starts.
- **Grab the crown and hold it.** Your reign time ticks up while everyone tries to take it. Get knocked out and the crown drops where you fell — anyone can steal it.
- **Live sword combat.** Move with WASD / joystick, swing at rivals, knock them back, kill and respawn. Struck knights flash red so hits read clearly.
- **Health & shield drops** spawn in the arena so a sharp player can outlast the whole crowd and defend a long reign.
- **3-minute rounds.** At the buzzer, most cumulative crown-time wins — shown on a full results table with total reign, longest single reign, and kills.
- **Persistent leaderboards.** Every reign is banked to an all-time and daily "longest reign" board. The post itself shows the record to beat, and your results screen shows your personal best and rank — so there's always a number to chase and, once you top it, to defend.
- **Built to spread.** Invite/share buttons and a "share your reign" screenshot pull new players back into the post.

It plays on desktop and mobile, with an on-screen joystick and attack button for touch.

---

## How I Built It

**Stack:** Devvit Web (Reddit's Developer Platform), **Phaser** for the game client, **Hono** on the server, **Redis** for state, Devvit's **realtime** relay, and TypeScript throughout (built with Vite).

The hard part is not the swordplay — it's running a fast, consistent, real-time game on a **serverless platform that has no always-on process and no server tick.** Devvit gives you request handlers, Redis, and a realtime relay; nothing that loops 60 times a second. The whole architecture is designed around that constraint:

- **Client-broadcast state.** Each player simulates only themselves and broadcasts their state ~16 times a second; the server relays it over Devvit realtime, and everyone renders everyone else as a smoothly interpolated remote. No authoritative server loop needed.
- **Single-owner facts are atomic in Redis.** There is exactly one crown. Claiming it is an atomic `hSetNX` per generation, so two players grabbing the same loose crown can never both win — the race resolves in a single Redis operation. Health/shield pickups use the same atomic-claim pattern.
- **Self-healing crown ownership.** Who holds the crown is *derived every frame* from the 16 Hz state stream, not from a fragile one-shot "taken/dropped" event. If a packet is ever lost, the next state broadcast reconciles every client within ~60 ms.
- **Time from a shared anchor.** Lobby countdowns and the 3-minute round are computed from one stored `createdAt` plus each client's measured clock offset, so every player's clock ends together with nothing ticking it down server-side.
- **Multi-room matchmaking.** Rooms cap at 10 via an atomic slot counter over a sorted-set room registry, with a rejoin pointer so a refresh never burns a seat. New rooms use a deterministic per-window id so simultaneous joiners land in the *same* lobby.
- **Victim-authoritative combat.** A swing is broadcast; each client decides whether *its own* player was in the arc and applies the damage to itself, then rebroadcasts HP. No trust problem, no rollback.
- **Persistence on Redis.** Finished rounds write to a durable `p:{username}` profile hash and to `lb:reign` / `lb:day:{date}` sorted sets — leaderboards for free, no external database.

---

## Challenges

**Real-time multiplayer with no game server.** This was the whole project. On a platform with no server tick, "authoritative server" is off the table. The answer was to make each client authoritative over itself and lean on Redis atomics for the few genuinely shared facts (the crown, the room slots). Getting movement to feel smooth over a relay meant frame-rate-independent interpolation of remote players.

**Keeping the crown consistent.** My first version drove crown ownership with one-shot "taken/dropped" events — and realtime occasionally drops a packet, so two screens would disagree about who was king. The fix was to *derive* the holder every frame from the frequent state broadcasts instead. Frequency beats reliability: a missed update self-corrects on the next tick.

**Platform gotchas that cost real hours.** Devvit realtime channel names may only contain letters, numbers, and underscores — a single hyphen in my channel id silently made `connectRealtime` throw and froze the game on the transition frame. Separately, Phaser reuses a scene instance across restarts, so "play again" kept old state until I reset everything on scene init.

**The lobby-split race.** Two players clicking "enter" at the same instant each created their own room and never saw each other. Deterministic per-time-window room ids (plus the atomic slot counter) make simultaneous joiners converge on one lobby.

**Making it self-explanatory.** Because judging happens by playing the demo link — often solo — the game had to communicate that it's live multiplayer *before* you enter: a "how to play" modal, a lobby "waiting for challengers, invite friends" state, and a clear arena hint.

---

## What I Learned

- **Devvit is serverless, and that changes everything.** The winning pattern is: clients broadcast their own state, single-owner facts go through atomic Redis ops, and anything time-based is derived from stored timestamps + a clock offset — never from a server loop.
- **Frequent state beats one-shot events.** Anything important (who holds the crown, everyone's HP) should ride the high-frequency broadcast so it self-heals; reserve events for things that can afford to be missed.
- **Redis sorted sets *are* the leaderboard.** `zAdd` + `zRange` gave me all-time and daily boards with a few lines and no external database — Postgres was never needed.
- **Small platform rules eat big time.** Channel-name constraints and scene-instance reuse were each a genuinely confusing bug until pinned down.

---

## What's Next

- **AI knight opponents to fill quiet rooms** — so a lone player (or a judge landing on the post alone) always has a fight. The host-authoritative networking to drive them is already in place; the remaining work is calmer, smarter AI.
- **Player levels and XP progression** layered on the existing profile stats.
- **Seasons and unlockable crowns** as long-term goals to chase.
- **More special drops** — speed boosts, temporary swords, arena traps.
- **Spectate and one-tap rematch.**

---

## Built With

`devvit` · `devvit-web` · `phaser` · `hono` · `redis` · `devvit-realtime` · `typescript` · `vite`

## Try It Out

- **Play on Reddit:** https://www.reddit.com/r/HoldYourCrown/comments/1un510p/hold_your_crown_grab_the_crown_hold_it_longest_to/
- **App listing:** https://developers.reddit.com/apps/hold-your-crown
- **Source:** _(add GitHub link)_
