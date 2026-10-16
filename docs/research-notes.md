# Research notes — snake/worm .io genre (sources + facts)

## Sources
- Game Developer, "What can teach us slither.io about game design": https://www.gamedeveloper.com/design/what-can-teach-us-slither-io-about-game-design-and-what-would-i-change-
- MDA – Slither.io (Mechanics of Magic): https://mechanicsofmagic.com/2022/04/11/mda-slither-io/ — kinds of fun: challenge (become biggest), sensation ("beautiful with its bright, space-like" look)
- Wikipedia Slither.io: https://en.wikipedia.org/wiki/Slither.io — eat pellets, defeat & consume other players to gain mass
- dinogame.gg "How Slither.io's Snake Scaling System Works" (2026): https://dinogame.gg/blog/how-slither-io-scaling-works/ — boost feedback loop: kill big snake → get mass → bigger → boost more aggressively → kill more
- Reddit r/Slitherio scoring: dying drops more orbs along your body line
- Medium (Joel Johnson) aggressor strategy: boost cost matters early; "eat orbs, avoid death"
- Snake.io (Kooapps) Medium: https://medium.com/@kooapps/snake-io-the-fun-snake-game-with-a-twist-2e775c26d024 — special pellets: 10 points, bonus speed, invincibility power-ups; monthly events with unique skins (App Store/Play). Complaint: invincibility lets snakes pass through others.
- Little Big Snake official https://littlebigsnake.com/ & wiki quests https://little-big-snake.fandom.com/wiki/Quests — missions/quests ("Eat 10 bubbles"), upgrades, artifacts, chests as rewards; boss snakes; bounty "Rebel" mode (Zendesk game modes page)
- Wormate.io https://wormate.io/ + pacogames page — candies/cakes to grow; mouse steer, press to accelerate; power-ups Speed Up, Zoom Out, Magnet; score multipliers x2/x5/x10; increased maneuverability
## Game juice
- "Juice it or lose it" GDC 2012 (Jonasson & Purho) https://www.gdcvault.com/play/1016487/juice-it-or-lose — "A juicy game feels alive and responds to everything you do; tons of cascading action and response for minimal user input"
- Longwelwind demo https://longwelwind.net/blog/juice-it/
- LinkedIn (A. Slashcev) tips: keep shake short 80–150 ms; avoid shaking during precise moves; avoid huge noisy particles; keep minor actions visually clean
- Medium (resprawn) tips: layer sounds (high "bling" + soft "whoosh"), randomize pitch/volume to avoid repetition
- Game Developer, Folmer Kelly: resist over-juicing that hurts readability

## Key insights (from Game Developer slither.io analysis + dinogame scaling article)
- Rules are tiny → learnable in minutes without tutorial; instant browser load is part of the appeal.
- Competitiveness via live top-10 board; "David vs Goliath": any head-to-body contact kills regardless of size, so small can kill big; big = tastier target.
- Chaos moments: a big worm dies → everyone boosts in to feast on its remains → chain reactions. Death drops mass along the body line.
- Criticisms: bland art, NO sound/music (feels unfinished), imprecise controls/lag. Suggestions: persistence (profile, rankings), team modes, customization of segments, adaptive music that intensifies tension, forceful SFX.
- Scaling: length ~ sqrt(mass) with damping; camera zooms out continuously with size; head radius grows with size; boost bleeds mass as pellets on trail (feedback loop kill→mass→boost→kill, self-limited because big = target).
