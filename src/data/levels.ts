import { LevelBuilder, finish } from './levelKit';
import type { LevelDef } from './types';

/* =============================================================================================
 *  CHAPTER I - THE BROKEN ORDER
 *  Part A: fortress rooftops   Part B: the stormy wood
 * ============================================================================================= */
function chapter1a(): LevelDef {
  const b = new LevelBuilder();

  // ---- A. Tutorial rooftop -------------------------------------------------------------
  b.roof(0, 700, 900).roof(1010, 700, 1010);
  b.prop('lamp', 300, 700).prop('lamp', 760, 700).prop('banner', 520, 700).prop('lamp', 1330, 700, {}).prop('banner', 1180, 700);
  b.prop('pole', 200, 700).prop('pole', 1540, 700);
  b.toast(60, 'Move with [left] / [right]', 4);
  b.toast(470, 'Sprint: [sprint]', 4);
  b.toast(740, 'Press [jump] to leap across gaps. Hold it longer to jump higher', 4.5);
  b.toast(1110, 'Run into low obstacles to vault over them', 4);
  b.crate(1200, 700, 42, 38);
  b.toast(1330, 'Press [down] while running to slide under barriers', 4.5);
  b.beam(1430, 700, 190, 40);
  b.toast(1720, 'Wall-jump: press [jump] on a wall, then [jump] again between the walls', 5.5);
  b.wall(1850, 420, 40, 220);
  b.prop('chain', 1870, 420, { s: 150 });

  // ---- B. Rooftop traversal --------------------------------------------------------------
  b.roof(1980, 420, 620);
  b.relic('c1a_1', 2300, 320, 'key');
  b.prop('lamp', 2160, 420).prop('banner', 2400, 420);
  b.roof(2720, 380, 380);
  b.crate(2900, 380, 44, 38);
  b.prop('lamp', 2780, 380);
  b.roof(3250, 440, 450);
  b.beam(3380, 440, 170, 40);
  b.prop('lamp', 3300, 440);
  b.roof(3850, 440, 160);
  b.prop('pole', 3930, 440);
  b.roof(4160, 480, 530);
  b.checkpoint('cp1', 4280, 480, 'Third Ward Roofs');
  b.interact({ id: 'rest1', type: 'rest', x: 4280, y: 480 });
  b.prop('banner', 4560, 480);
  b.roof(4810, 410, 330);
  b.prop('lamp', 4880, 410);
  b.at(4900, { type: 'toast', text: 'The watchtower has seen you. Run!', time: 3 }, 50);

  // ---- C. The chase ----------------------------------------------------------------------
  b.roof(5260, 340, 720);
  b.at(5300, { type: 'chaseStart' }, 50);
  b.at(5300, { type: 'mood', mood: 'tense' }, 50);
  b.crate(5720, 340, 42, 38);
  b.crate(5870, 340, 42, 38);
  b.roof(6150, 380, 420);
  b.beam(6250, 380, 170, 40);
  b.relic('c1a_2', 6500, 305, 'key');
  b.roof(6730, 400, 180);
  b.roof(6910, 330, 480);
  b.beam(7030, 330, 170, 40);
  b.crumble(7560, 390, 100).crumble(7660, 390, 100).crumble(7760, 390, 100);
  b.roof(7860, 430, 520);
  b.crate(8010, 430, 42, 38);
  b.crate(8160, 430, 42, 38);
  b.at(8240, { type: 'chaseEnd' }, 50);
  b.prop('lamp', 6200, 380).prop('lamp', 7900, 430);

  // ---- D. Courtyard: first weapon, shadow altar, arena ------------------------------------
  b.ground(8380, 640, 2200, 'ground');
  b.at(8400, { type: 'mood', mood: 'calm' }, 40);
  b.at(8400, { type: 'title', title: 'The Courtyard of Ash', sub: 'The pursuit ends here. Something else begins.' }, 40);
  b.checkpoint('cp2', 8470, 640, 'Courtyard of Ash');
  b.interact({ id: 'rest2', type: 'rest', x: 8470, y: 640 });
  b.interact({
    id: 'blade', type: 'pickupBlade', x: 8640, y: 640, prompt: 'Take the fallen guard\'s blade',
    text: ['A guard of the Order lies still, his curved blade half-drawn.', 'Whatever he guarded, he did not die of the storm.'],
  });
  b.prop('statue', 8640, 640);
  b.at(8730, { type: 'hint', key: 'combat' }, 40);
  b.sentinel(9050, 640, [8880, 9220]);
  b.ledge(9300, 570, 190);
  b.relic('c1a_3', 9390, 535, 'key');
  b.prop('lamp', 9350, 640).prop('banner', 9200, 640);
  b.checkpoint('cp3', 9500, 640, 'The Sundered Altar');
  b.interact({ id: 'rest3', type: 'rest', x: 9500, y: 640 });
  b.interact({
    id: 'altar', type: 'altarShadow', x: 9640, y: 640, prompt: 'Touch the altar',
    title: 'The Relic Awakens',
    text: ['The relic drinks the lamplight.', 'Your shadow stands up without you.'],
  });
  b.prop('statue', 9640, 640);
  b.at(9740, { type: 'hint', key: 'shadow' }, 40);
  b.at(9860, { type: 'arenaStart', arena: 'a1', lock: [9740, 10560], gates: ['g1', 'g2'] }, 30);
  b.gate('g1', 9720, 330, 310);
  b.gate('g2', 10540, 330, 310);
  b.sentinel(10180, 640, [10000, 10300], 'a1');
  b.sentinel(10360, 640, [10200, 10480], 'a1');
  b.prop('brazier', 10000, 640).prop('brazier', 10440, 640);

  // ---- E. Collapse and escape --------------------------------------------------------------
  b.ground(10580, 640, 380, 'ground');
  b.at(10640, { type: 'title', title: 'The Wall Falls', sub: 'Keep moving.' }, 40);
  b.at(10640, { type: 'mood', mood: 'tense' }, 40);
  b.crumble(11020, 640, 90).crumble(11140, 650, 90).crumble(11260, 660, 90).crumble(11380, 650, 90).crumble(11500, 640, 90);
  b.ashfall(11060, 250, 70, 390, 3.2, 0).ashfall(11300, 260, 70, 400, 3.2, 1.4);
  b.ground(11620, 640, 500, 'ground');
  b.spikes(11790, 640, 120);
  b.ashfall(11960, 260, 70, 380, 3, 0.7);
  b.ground(12200, 600, 640, 'ground');
  b.prop('torii', 12680, 600);
  b.at(12600, { type: 'end' }, 50);

  return finish(b, {
    id: 'c1a', chapter: 1, title: 'CHAPTER I', subtitle: 'The Broken Order', theme: 'fortress', mood: 'calm',
    width: 12900, height: 1300, camRefY: 360, spawn: { x: 140, y: 700 }, relicTotal: 3,
  });
}

function chapter1b(): LevelDef {
  const b = new LevelBuilder();
  b.ground(0, 650, 950, 'ground');
  b.prop('bush', 200, 650).prop('bush', 640, 650).prop('lamp', 420, 650);
  b.at(120, { type: 'title', title: 'The Stormy Wood', sub: 'No wall. No law. Only the rain.' }, 40);
  b.ground(1060, 650, 800, 'ground');
  b.crate(1300, 650, 120, 34, 'wood');
  b.crate(1650, 650, 100, 32, 'wood');
  b.ledge(1450, 560, 170, 'wood');
  b.prop('bush', 1100, 650).prop('bush', 1800, 650);
  b.ground(1980, 610, 700, 'ground');
  b.toast(2000, 'Wraiths drift and blink. Watch for the red ring: dodge through it, or parry', 5.5);
  b.wraith(2400, 560, { x0: 2150, x1: 2620, y0: 380, y1: 560 });
  b.prop('lamp', 2060, 610);

  // Ravine with a hidden shadow bridge.
  b.ground(2800, 610, 380, 'ground');
  b.ledge(3180, 610, 240, 'wood'); // fallen trunk
  b.ground(3420, 610, 300, 'ground');
  b.ledge(3000, 560, 90, 'wood').ledge(3100, 505, 90, 'wood');
  b.shadow(3200, 495, 310);
  b.ledge(3510, 495, 170, 'wood');
  b.relic('c1b_shadow', 3600, 450, 'key');
  b.at(2950, { type: 'hint', key: 'debt' }, 60);

  b.ground(3720, 610, 900, 'ground');
  b.checkpoint('cp1', 3790, 610, 'Mossy Crossing');
  b.interact({ id: 'rest1', type: 'rest', x: 3790, y: 610 });
  b.sentinel(4100, 610, [3950, 4250]);
  b.sentinel(4380, 610, [4250, 4560]);
  b.wraith(4250, 520, { x0: 3980, x1: 4540, y0: 360, y1: 530 });
  b.ground(4740, 640, 720, 'ground');
  b.crate(4960, 640, 44, 36, 'wood');
  b.beam(5150, 640, 170, 40);
  b.relic('c1b_2', 5380, 590, 'key');
  b.ground(5580, 640, 1000, 'ground');
  b.prop('bush', 5700, 640).prop('lamp', 5640, 640);
  b.at(5900, { type: 'mood', mood: 'sorrow' }, 40);
  b.at(5950, {
    type: 'cinematic', hold: 3.2,
    lines: [
      'Beyond the ridge, a kingdom lies drowned beneath the rain.',
      'The relic hums against your ribs. It knows this place.',
      '"They did not bury a treasure," it whispers. "They buried a hunger."',
      'And Aru understands: someone is already looking for it.',
    ],
  }, 50);
  b.at(6300, { type: 'end' }, 50);
  return finish(b, {
    id: 'c1b', chapter: 1, title: 'CHAPTER I', subtitle: 'The Stormy Wood', theme: 'forest', mood: 'tense',
    width: 6700, height: 1300, camRefY: 335, spawn: { x: 140, y: 650 }, relicTotal: 2,
  });
}

/* =============================================================================================
 *  CHAPTER II - THE DROWNED VILLAGE
 * ============================================================================================= */
function chapter2(): LevelDef {
  const b = new LevelBuilder();
  b.ground(0, 650, 1050, 'ruin');
  b.at(120, { type: 'title', title: 'CHAPTER II', sub: 'The Drowned Village' }, 40);
  b.prop('lamp', 320, 650).prop('bush', 560, 650);
  b.interact({
    id: 'lore1', type: 'lore', x: 520, y: 650, prompt: 'Read the tablet', title: 'Tablet of the Lower Town',
    text: ['"The river took the lower town first. We lit lamps to keep the dark from following the water."', '"Three lamps, one in each ward. Only then will the shrine open."'],
  });
  b.interact({ id: 'lampA', type: 'lamp', x: 900, y: 650, group: 'village', need: 3, opens: 'shrineGate', prompt: 'Light the lamp' });
  b.ground(1150, 650, 800, 'ruin');
  // Stilt-house roofs lead up to the second lamp.
  b.ledge(1300, 585, 180, 'wood').ledge(1560, 515, 170, 'wood').ledge(1810, 445, 220, 'wood');
  b.interact({ id: 'lampB', type: 'lamp', x: 1960, y: 445, group: 'village', need: 3, opens: 'shrineGate', prompt: 'Light the lamp' });
  b.relic('c2_1', 1650, 475, 'key');
  b.wraith(1500, 450, { x0: 1250, x1: 1850, y0: 330, y1: 540 });
  b.ground(2060, 650, 700, 'ruin');
  b.sentinel(2400, 650, [2200, 2650]);
  b.prop('lamp', 2150, 650);
  b.checkpoint('cp1', 2120, 650, 'Chandra Ward');
  b.interact({ id: 'rest1', type: 'rest', x: 2120, y: 650 });
  b.interact({
    id: 'lore2', type: 'lore', x: 2700, y: 650, prompt: 'Read the tablet', title: 'Fisher\'s Prayer',
    text: ['"The relic is not a gift. It is a loan, and the earth keeps the ledger."', '"Whoever borrows from their own shadow pays with their own shadow."'],
  });
  // Flooded section: stepping platforms over deep water.
  b.hazards.push({ kind: 'pit', x: 2760, y: 790, w: 1250, h: 400 });
  b.crumble(2830, 650, 110, 'wood').crumble(3000, 650, 110, 'wood').ledge(3170, 640, 110, 'wood');
  b.mover(3330, 650, 110, 140, 0, 4, 0, 'wood');
  b.ledge(3640, 650, 130, 'wood');
  b.shadow(3060, 555, 330);
  b.relic('c2_hidden', 3220, 515, 'key');
  b.ground(3820, 650, 200, 'ruin');
  // Hidden cellar with the third lamp (drop into the hole at the stone slab).
  b.ground(4020, 650, 420, 'ruin', 140);
  b.ground(4640, 650, 500, 'ruin', 140);
  b.ground(4020, 920, 1120, 'ruin');
  b.prop('shade', 4020, 790, { w: 420, h: 132 }).prop('shade', 4640, 790, { w: 500, h: 132 });
  b.ledge(4455, 850, 70, 'wood').ledge(4520, 790, 70, 'wood').ledge(4585, 725, 70, 'wood');
  b.interact({ id: 'lampC', type: 'lamp', x: 4150, y: 920, group: 'village', need: 3, opens: 'shrineGate', prompt: 'Light the lamp' });
  b.relic('c2_2', 5000, 870, 'key');
  b.interact({
    id: 'lore3', type: 'lore', x: 4900, y: 920, prompt: 'Read the tablet', title: 'Cellar Inscription',
    text: ['"Those who go below must light what they find."', '"The dark here is not empty. It is patient."'],
  });
  b.at(4300, { type: 'toast', text: 'A cellar. Something is lit below...', time: 3 }, 40);
  // Pre-shrine arena.
  b.ground(5140, 650, 1500, 'ruin');
  b.checkpoint('cp2', 5240, 650, 'Shrine Approach');
  b.interact({ id: 'rest2', type: 'rest', x: 5240, y: 650 });
  b.at(5560, { type: 'arenaStart', arena: 'v1', lock: [5330, 6500], gates: ['g1', 'g2'] }, 30);
  b.gate('g1', 5310, 340, 310);
  b.gate('g2', 6480, 340, 310);
  b.sentinel(5950, 650, [5800, 6100], 'v1');
  b.wraith(5800, 560, { x0: 5500, x1: 6350, y0: 380, y1: 560 }, 'v1');
  b.wraith(6200, 540, { x0: 5500, x1: 6350, y0: 380, y1: 560 }, 'v1');
  b.sentinel(6150, 650, [5950, 6300], 'v1');
  // The shrine.
  b.ground(6640, 650, 1500, 'ruin');
  b.gate('shrineGate', 6700, 330, 320, 40, true);
  b.interact({
    id: 'shrine', type: 'shrineGift', x: 7350, y: 650, prompt: 'Kneel at the shrine', title: 'The Shrine of Still Water',
    text: ['The shrine accepts the three lamps. Something in you steadies.', 'Your debt is washed away, and your body mends stronger.'],
  });
  b.prop('statue', 7350, 650);
  b.at(7050, { type: 'mood', mood: 'sorrow' }, 40);
  b.at(7700, { type: 'cinematic', hold: 3, lines: ['Beneath the shrine, a stair descends into the dark.', 'The stair was cut for something much larger than a man.'] }, 40);
  b.at(7900, { type: 'end' }, 40);
  return finish(b, {
    id: 'c2', chapter: 2, title: 'CHAPTER II', subtitle: 'The Drowned Village', theme: 'village', mood: 'calm',
    width: 8200, height: 1400, camRefY: 335, spawn: { x: 140, y: 650 }, relicTotal: 4,
  });
}

/* =============================================================================================
 *  CHAPTER III - BENEATH THE EARTH  (boss: The Ashen Guardian)
 * ============================================================================================= */
function chapter3(): LevelDef {
  const b = new LevelBuilder();
  // R1: entrance hall
  b.ground(0, 400, 800, 'stone');
  b.at(120, { type: 'title', title: 'CHAPTER III', sub: 'Beneath the Earth' }, 40);
  b.prop('brazier', 340, 400).prop('glyph', 600, 400).prop('brazier', 700, 400);
  b.interact({
    id: 'lore1', type: 'lore', x: 480, y: 400, prompt: 'Read the inscription', title: 'The First Debt',
    text: ['"We took the power and called it ours."', '"The Guardian was bound to stop the next to take it."'],
  });
  b.ground(920, 470, 300, 'stone');
  b.ground(1340, 540, 1700, 'stone');
  b.checkpoint('cp1', 1420, 540, 'Sanctum Gate');
  b.interact({ id: 'rest1', type: 'rest', x: 1420, y: 540 });
  // R2: blade hall
  b.blade(1660, 540 - 150, 90, 150, 3.0, 0.45, 0);
  b.blade(2000, 540 - 150, 90, 150, 3.0, 0.45, 0.5);
  b.spikes(2160, 540, 130);
  b.relic('c3_1', 2230, 400, 'key');
  b.elite(2650, 540, [2450, 2900]);
  b.prop('brazier', 2400, 540).prop('brazier', 2950, 540);
  // R3: crumbling descent
  b.crumble(3140, 580, 100).crumble(3290, 630, 100).crumble(3440, 680, 100).crumble(3590, 730, 100).crumble(3740, 780, 100);
  b.hazards.push({ kind: 'pit', x: 3040, y: 1000, w: 900, h: 500 });
  b.ground(3900, 800, 760, 'stone');
  b.ashfall(4010, 480, 70, 320, 3.4, 0).ashfall(4250, 480, 70, 320, 3.4, 1.1).ashfall(4470, 480, 70, 320, 3.4, 2.2);
  b.wraith(4300, 700, { x0: 4000, x1: 4560, y0: 560, y1: 720 });
  b.checkpoint('cp2', 3960, 800, 'The Ashen Stair');
  b.interact({ id: 'rest2', type: 'rest', x: 3960, y: 800 });
  b.prop('glyph', 4180, 800);
  // R4: moving platforms over the abyss
  b.hazards.push({ kind: 'pit', x: 4660, y: 1100, w: 1000, h: 500 });
  b.mover(4720, 800, 130, 260, 0, 4.2, 0);
  b.ground(5120, 800, 300, 'stone');
  b.mover(5500, 800, 110, 0, -170, 3.6, 0);
  b.ground(5640, 630, 560, 'stone');
  b.shadow(5180, 735, 120);
  b.relic('c3_2', 5240, 695, 'key');
  b.elite(5900, 630, [5750, 6100]);
  b.checkpoint('cp3', 5700, 630, 'Hall of Chains');
  b.interact({ id: 'rest3', type: 'rest', x: 5700, y: 630 });
  b.prop('chain', 5780, 300, { s: 330 }).prop('chain', 6040, 300, { s: 330 });
  // R5: antechamber and boss arena
  b.ground(6200, 700, 700, 'stone');
  b.interact({
    id: 'lore2', type: 'lore', x: 6480, y: 700, prompt: 'Read the inscription', title: 'The Last Warning',
    text: ['"Beyond lies the Ashen Guardian, who was a king, who was a thief, who was afraid."', '"Strike when he falters. Run when he roars."'],
  });
  b.ground(6900, 760, 1900, 'stone');
  b.gate('g1', 6930, 400, 360);
  b.gate('g2', 8540, 400, 360);
  b.at(7130, { type: 'bossStart' }, 40);
  b.prop('brazier', 7040, 760).prop('brazier', 8460, 760).prop('glyph', 7800, 760);
  b.at(8680, { type: 'end' }, 40);
  return finish(b, {
    id: 'c3', chapter: 3, title: 'CHAPTER III', subtitle: 'Beneath the Earth', theme: 'sanctum', mood: 'sorrow',
    width: 9000, height: 1600, camRefY: 330, spawn: { x: 140, y: 400 }, rain: false, relicTotal: 3,
    boss: { x: 7960, y: 760, arena: [6960, 8540], gates: ['g1', 'g2'] },
  });
}

export const LEVELS: LevelDef[] = [chapter1a(), chapter1b(), chapter2(), chapter3()];
export const levelIndex = (id: string) => Math.max(0, LEVELS.findIndex((l) => l.id === id));
export const getLevel = (id: string) => LEVELS[levelIndex(id)];
