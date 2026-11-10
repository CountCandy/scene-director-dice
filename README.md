# Scene Director Dice

A SillyTavern extension that acts as an automated game master for pacing. Before each reply it rolls a die against a roll table you control, and tells the model, for that one reply only, whether to hold steady, foreshadow something, or spring a twist.

It is meant to fix two common roleplay problems: scenes where nothing unexpected ever happens, and scenes where the model piles twist on twist with no room to breathe.

> **Status:** the turn logic (rolls, cooldown, foreshadow chain, swipe handling) has been checked in a simulated run. The extension has not yet had wide testing inside a live SillyTavern, so please report anything odd.

## How it works

Every time you send a message, the extension resolves one "turn" before the model starts writing:

1. **Roll.** It rolls 1dX and looks the result up in the active roll table ("deck").
2. **Decide.** Each table row has one of three outcome types:
   - **Steady**: no twist. Develop the scene as it is.
   - **Foreshadow**: plant a warning sign this turn, without triggering anything yet.
   - **Twist / Development**: an active event happens now, such as a trap, an NPC clash, or a new arrival.
3. **Inject.** The matching directive is added to the prompt for this generation only, then removed. It is never written into a chat message, so the model never sees rolls from earlier turns.

### Cooldown

After a Twist, the extension stops rolling for a set number of turns (3 by default). During cooldown it injects a "hold steady" directive so the aftermath can play out before anything new happens.

### Foreshadow to payoff

With **Link Foreshadow Rolls to Next-Turn Payoff** on, a Foreshadow roll queues a payoff: the next turn skips the die, tells the model to follow through on the warning it planted, and then starts the cooldown.

### Tension bonus

With **Enable Tension Bonus** on, each Steady result adds +1 to the next roll, up to a cap you set. Long quiet stretches build toward a development. The bonus resets on any Foreshadow or Twist.

### Swipes and regenerations

Swiping or regenerating reuses the roll already made for that turn. It does not reroll and does not count down the cooldown, so you can swipe freely without breaking the pacing. If you want a different result, press **Reroll** first, then swipe.

Background ("quiet") generations from other extensions, such as summarizers and trackers, are ignored.

## Installation

### From inside SillyTavern (recommended)

1. Open SillyTavern and click the **Extensions** icon (the stacked blocks) in the top bar.
2. Click **Install extension**.
3. Paste this URL and confirm:

   ```
   https://github.com/CountCandy/scene-director-dice
   ```

4. Reload the page if SillyTavern does not do it for you.

### Manual install

Clone or download this repository into your third-party extensions folder, so that `manifest.json` sits directly inside a `scene-director-dice` folder:

```
SillyTavern/data/<your-user-handle>/extensions/scene-director-dice/
```

For a default single-user install, `<your-user-handle>` is `default-user`. To install for every user on the server, use `SillyTavern/public/scripts/extensions/third-party/scene-director-dice/` instead.

Then restart SillyTavern or reload the page.

### Check that it loaded

- A **Scene Director Dice** drawer appears in the Extensions panel.
- A small status pill appears just above the message input.

## Using it

### The HUD pill

The pill above the message input shows the current state and the last roll:

| Display | Meaning |
| --- | --- |
| 🎲 Ready (1d10) | The next message will roll the die. |
| ❄️ Cooldown: 2 turns | No rolls for 2 more turns. |
| ⚡ Payoff Primed | The next turn will pay off a foreshadowed event. |
| ⏸️ Paused | Rolling is frozen. |
| + Tension: +2 | The next roll gets +2. |

Its buttons:

- **Lock**: pause or resume. While paused nothing is injected and the cooldown does not count down. Use it for scenes you do not want interrupted.
- **Dice**: reroll the current turn. If the current turn is a cooldown or payoff turn, it asks before forcing a fresh roll.
- **Minus**: remove one cooldown turn. Shift+click clears the cooldown and any queued payoff.
- **Plus**: add one cooldown turn.

### Settings

Open the **Scene Director Dice** drawer in the Extensions panel.

- **Deck**: pick the active roll table. Four decks are included: General Story, Social & Intrigue, Dungeon & Hazards, and Combat. You can add, rename, and delete decks.
- **Die size**: set per deck, so switching decks also switches the die.
- **Cooldown turns**: how many turns to hold steady after a twist.
- **Table editor**: each row has a min-max range, an outcome type, and directive text. A warning appears if any number on the die is uncovered or covered twice.
- **Pacing**: the foreshadow chain toggle, the tension bonus toggle, and the tension cap.
- **Injection**: see below.
- **Directive wording**: the text used for cooldown and payoff turns. In the payoff text, `{{foreshadow}}` is replaced with the foreshadow row that was rolled.

### Default table (General Story, 1d10)

| Roll | Outcome | Directive |
| --- | --- | --- |
| 1-5 | Steady | Hold steady. Develop the current interaction naturally without forcing an external twist. |
| 6-7 | Foreshadow | Plant an ominous sensory cue or warning sign hinting at an approaching hazard, entity, or conflict. |
| 8 | Twist | Hazard or Misfire. Trigger a trap, environmental obstacle, or unstable magic/tech malfunction. |
| 9 | Twist | NPC Friction. Spark a sudden disagreement, shift in agenda, or clash. |
| 10 | Twist | Intrusion / Escalation. Introduce an unexpected person, creature, or active threat. |

## Injection modes

Both modes put the directive in the prompt as a system message at depth 0 (right after your latest message) and remove it when generation ends.

- **Mode A: Depth-0 prompt + reasoning instruction.** The directive also asks the model to write a `- Director:` line in its reasoning block before the reply. This works with any backend and is the default.
- **Mode B: Reasoning prefill.** In addition, the extension temporarily adds a line such as `- Director [1d10=8 - Twist]:` to SillyTavern's **Start Reply With** field, so the model begins its reasoning by completing that thought. Your own Start Reply With text is restored after each generation. This needs a backend that honors a reply prefill; if yours does not, use Mode A.

**Reasoning tag format** sets which tag the instructions refer to. It defaults to `<|channel>thought` (Gemma); `<think>` is offered as an alternative, and you can type any other tag.

## Where things are stored

- Decks and settings are saved in SillyTavern's extension settings and apply to all chats.
- Cooldown, tension, queued payoff, and the cached roll are saved per chat in that chat's metadata, so each chat keeps its own pacing.

## Files

- `manifest.json`: extension metadata.
- `index.js`: all logic and UI.
- `style.css`: HUD and settings styling.
