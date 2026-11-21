// lib.mjs - the pure parts of fill.mjs and remove.mjs (no network): which plant detail fields
// are empty, plausible demo values for them, and exactly what to take out again.
// Tested by backend/test/demoPlantDetails.test.js.
//
// Plant columns (shown in the app's "This plant" / Morphological characteristics / Notes):
//   location_description, morphology, description (Notes)
// Observation fields (the app and web show the newest observation that has each one):
//   height_cm, diameter_cm, health_status, life_stage
// Only EMPTY fields are filled; anything a botanist entered is kept.

export const PLANT_FIELDS = ['location_description', 'morphology', 'description'];
export const OBSERVATION_FIELDS = ['height_cm', 'diameter_cm', 'health_status', 'life_stage'];
export const REPORT_COLUMNS = ['plant_id', 'tag', 'species', 'growth_form', 'field', 'old', 'new', 'where', 'action'];

const isEmpty = (value) => value === null || value === undefined || String(value).trim() === '';

// ---- a small seeded random generator, so a plant always gets the same values ----
export function seededRandom(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (random, list) => list[Math.floor(random() * list.length)];
const between = (random, low, high) => low + random() * (high - low);

// ---- growth forms ----
// Height in metres and stem diameter in centimetres for a mature plant; young plants are
// smaller (see measurements). diameter null: not measured for that form (mosses).
export const GROWTH_FORMS = {
  tree: { height: [6, 30], diameter: [12, 70] },
  small_tree: { height: [3, 12], diameter: [5, 25] },
  palm: { height: [2, 12], diameter: [8, 30] },
  shrub: { height: [0.8, 4], diameter: [1.5, 8] },
  climber: { height: [1.5, 12], diameter: [0.5, 5] },
  giant_herb: { height: [1, 4], diameter: [3, 18] },
  herb: { height: [0.1, 1.2], diameter: [0.3, 2.5] },
  fern: { height: [0.2, 1.5], diameter: [0.4, 4] },
  epiphyte: { height: [0.05, 0.6], diameter: [0.2, 1.5] },
  moss: { height: [0.01, 0.06], diameter: null },
};

const GENUS_FORMS = {
  tree: ['Shorea', 'Dipterocarpus', 'Eusideroxylon', 'Artocarpus', 'Alstonia', 'Octomeles', 'Pometia', 'Scaphium',
    'Sterculia', 'Calophyllum', 'Dillenia', 'Mangifera', 'Syzygium', 'Spathodea', 'Adenanthera', 'Dimocarpus'],
  small_tree: ['Macaranga', 'Mallotus', 'Aporosa', 'Antidesma', 'Tabernaemontana', 'Gnetum', 'Averrhoa', 'Carica',
    'Streblus', 'Codiaeum'],
  palm: ['Areca', 'Arenga', 'Caryota', 'Eleiodoxa'],
  shrub: ['Clerodendrum', 'Hibiscus', 'Mussaenda', 'Miconia', 'Strobilanthes', 'Ruellia', 'Benstonea', 'Pandanus'],
  climber: ['Ampelocissus', 'Adenia', 'Connarus', 'Freycinetia', 'Rhaphidophora', 'Scindapsus', 'Pothos', 'Syngonium',
    'Lygodium', 'Whitfordiodendron', 'Adinobotrys', 'Piper'],
  giant_herb: ['Musa', 'Etlingera', 'Alpinia', 'Hedychium', 'Heliconia', 'Alocasia', 'Cyrtosperma', 'Xanthosoma',
    'Hellenia', 'Zingiber', 'Lasia', 'Amorphophallus'],
  fern: ['Asplenium', 'Hymenasplenium', 'Diplazium', 'Adiantum', 'Bolbitis', 'Cyclopeltis', 'Davallia', 'Dipteris',
    'Drynaria', 'Microsorum', 'Nephrolepis', 'Taenitis', 'Tectaria', 'Pleocnemia', 'Grypothrix', 'Antrophyum',
    'Haplopteris', 'Helminthostachys', 'Monachosorum', 'Selaginella'],
  epiphyte: ['Bulbophyllum', 'Dendrobium', 'Liparis', 'Claderia', 'Myrmecodia'],
  moss: ['Leucobryum', 'Cyathodium'],
};
const FAMILY_FORMS = {
  Dipterocarpaceae: 'tree', Lauraceae: 'tree', Myristicaceae: 'tree', Meliaceae: 'tree', Anacardiaceae: 'tree',
  Moraceae: 'small_tree', Euphorbiaceae: 'small_tree', Phyllanthaceae: 'small_tree', Apocynaceae: 'small_tree',
  Annonaceae: 'small_tree', Myrtaceae: 'tree', Malvaceae: 'shrub', Arecaceae: 'palm', Pandanaceae: 'shrub',
  Rubiaceae: 'shrub', Lamiaceae: 'shrub', Acanthaceae: 'herb', Melastomataceae: 'shrub',
  Vitaceae: 'climber', Passifloraceae: 'climber', Connaraceae: 'climber', Lygodiaceae: 'climber', Fabaceae: 'tree',
  Zingiberaceae: 'giant_herb', Musaceae: 'giant_herb', Heliconiaceae: 'giant_herb', Costaceae: 'giant_herb',
  Araceae: 'herb', Begoniaceae: 'herb', Gesneriaceae: 'herb', Urticaceae: 'herb', Cyperaceae: 'herb',
  Commelinaceae: 'herb', Asteraceae: 'herb', Onagraceae: 'herb', Campanulaceae: 'herb', Amaryllidaceae: 'herb',
  Dioscoreaceae: 'herb', Piperaceae: 'climber', Orchidaceae: 'epiphyte', Loranthaceae: 'epiphyte',
  Aspleniaceae: 'fern', Athyriaceae: 'fern', Pteridaceae: 'fern', Polypodiaceae: 'fern', Dryopteridaceae: 'fern',
  Tectariaceae: 'fern', Lomariopsidaceae: 'fern', Davalliaceae: 'fern', Dipteridaceae: 'fern', Nephrolepidaceae: 'fern',
  Ophioglossaceae: 'fern', Dennstaedtiaceae: 'fern', Selaginellaceae: 'fern', Leucobryaceae: 'moss',
  Bignoniaceae: 'tree', Cornaceae: 'tree', Tetramelaceae: 'tree', Sapindaceae: 'tree', Dilleniaceae: 'tree',
  Calophyllaceae: 'tree', Gnetaceae: 'small_tree', Caricaceae: 'small_tree', Oxalidaceae: 'small_tree',
};
const BROAD_FORMS = { Bryophyta: 'moss', Marchantiophyta: 'moss', Polypodiopsida: 'fern', Polypodiineae: 'fern' };

// The growth form for a species: by genus, else by family, else by a broad group, else herb.
export function growthForm(scientificName, family) {
  const name = String(scientificName ?? '').trim();
  const genus = name.split(/\s+/)[0] ?? '';
  for (const [form, genera] of Object.entries(GENUS_FORMS)) if (genera.includes(genus)) return form;
  if (family && FAMILY_FORMS[family]) return FAMILY_FORMS[family];
  if (FAMILY_FORMS[name]) return FAMILY_FORMS[name];
  if (BROAD_FORMS[name]) return BROAD_FORMS[name];
  if (/^(Calamoideae)$/.test(name)) return 'palm';
  if (/^(Monstereae)$/.test(name)) return 'climber';
  if (/^(Aeridinae)$/.test(name)) return 'epiphyte';
  return 'herb';
}

// ---- morphology text, by growth form, with family details where they are typical ----
const MORPHOLOGY = {
  tree: [
    'Tall tree with a straight trunk and a spreading crown. Leaves simple and alternate. Bark grey-brown and fairly smooth.',
    'Large tree with a clear bole and small buttresses at the base. Leaves simple, leathery, alternate along the twigs.',
  ],
  small_tree: [
    'Small tree with a slender trunk and a narrow crown. Leaves simple and alternate. Bark smooth, pale brown.',
    'Small, few-branched tree. Leaves simple, broad, alternate. Young twigs green.',
  ],
  palm: [
    'Palm with feather-shaped leaves crowded at the top of the stem. Leaf bases sheathing; old leaf bases persist on the stem.',
    'Clumping palm with arching, feather-shaped leaves. Leaf sheaths fibrous.',
  ],
  shrub: [
    'Shrub with several woody stems from the base. Leaves simple and opposite. Bark thin and pale.',
    'Bushy shrub with spreading branches. Leaves simple, alternate, with toothed edges.',
  ],
  climber: [
    'Woody climber twining or rooting up a host tree. Leaves simple and alternate along long, flexible stems.',
    'Climber with slender stems that cling to the bark of a host tree. Leaves alternate, glossy green.',
  ],
  giant_herb: [
    'Large herb with leafy shoots from an underground rhizome. Leaves large, entire, in two rows along the shoot.',
    'Robust herb forming a clump of leafy shoots. Leaves broad with a strong midrib.',
  ],
  herb: [
    'Small herb with soft, fleshy stems. Leaves simple, in a loose rosette or alternate along the stem.',
    'Low herb of the forest floor. Leaves simple and entire, green above and paler below.',
  ],
  fern: [
    'Fern with fronds arising from a short rhizome. Fronds once-divided; spore clusters on the underside of the leaflets.',
    'Ground fern forming a small clump. Young fronds coiled; mature fronds divided into narrow leaflets.',
  ],
  epiphyte: [
    'Epiphyte growing on the bark of a host tree. Leaves few and thick; roots clinging to the bark.',
    'Small epiphyte on a tree branch. Short stems with a few fleshy leaves.',
  ],
  moss: [
    'Low moss forming a soft cushion on soil or bark. Tiny leaves crowded along short upright shoots.',
    'Moss forming a pale green mat. Tiny overlapping leaves; no flowers.',
  ],
};
const FAMILY_MORPHOLOGY = {
  Araceae: 'Aroid with leaves on long stalks. Tiny flowers packed on a spike (spadix) within a hood-like spathe.',
  Begoniaceae: 'Fleshy herb with lopsided, asymmetric leaves. Stems succulent; flowers small, pink or white.',
  Zingiberaceae: 'Ginger with leafy shoots in two rows from an underground rhizome. Leaves long and lance-shaped.',
  Orchidaceae: 'Orchid with thickened stems or pseudobulbs and a few leathery leaves. Aerial roots clinging to bark.',
  Dipterocarpaceae: 'Tall tree with a straight trunk and buttresses. Leaves simple, alternate, with parallel side veins. Fruits winged.',
  Moraceae: 'Woody plant with milky sap. Leaves simple and alternate; stipules leave ring scars on the twigs.',
  Arecaceae: 'Palm with feather-shaped leaves crowded at the top of the stem. Leaf sheaths fibrous.',
  Gesneriaceae: 'Soft herb with leaves in a rosette or in pairs, often hairy. Flowers small and tubular.',
  Pandanaceae: 'Plant with long, narrow, spiny-edged leaves arranged in spirals at the stem tips. Stilt roots at the base.',
  Rubiaceae: 'Plant with simple, opposite leaves and stipules between the leaf stalks. Flowers tubular.',
};

// ---- location notes, notes, health and life stage ----
const ZONES = ['Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone E', 'Zone F'];
const PLACES_LIMESTONE = ['Limestone slope near the plank walk', 'Base of the limestone cliff by the cave path',
  'Shaded limestone boulders near the Painted Cave trail'];
const PLACES_FOREST = ['Mixed dipterocarp forest beside the main trail', 'Shaded gully below the plank walk',
  'Secondary forest near the park headquarters', 'Riverbank near the ferry point', 'Edge of the peat swamp boardwalk',
  'Forest edge along the Madu trail', 'Clearing near the observation tower'];

export function locationNote(random, form, family) {
  const rocky = ['Begoniaceae', 'Gesneriaceae'].includes(family) || form === 'moss';
  const place = pick(random, rocky && random() < 0.7 ? PLACES_LIMESTONE : [...PLACES_FOREST, ...PLACES_LIMESTONE]);
  return `${place}, ${pick(random, ZONES)}`;
}

const NOTES = {
  healthy: ['Healthy plant growing in partial shade.', 'Vigorous new growth; leaves clean and undamaged.',
    'Well established; growing among leaf litter in deep shade.', 'Healthy; a few older leaves turning yellow.'],
  stressed: ['Several young leaves with insect damage; growing in partial shade.',
    'Some yellowing of the lower leaves after dry weather.', 'Leaves wilting slightly in an exposed spot.'],
  damaged: ['Main stem broken by a fallen branch; new shoots forming.', 'Several leaves torn; trail-side plant.'],
};
const STAGE_NOTE = { flowering: ' In flower at the time of the visit.', fruiting: ' Bearing fruit at the time of the visit.' };

export function healthAndStage(random, form) {
  const r = random();
  const health = r < 0.8 ? 'healthy' : r < 0.93 ? 'stressed' : 'damaged';
  const s = random();
  const noFlowers = form === 'fern' || form === 'moss';
  const young = form === 'tree' || form === 'small_tree' || form === 'palm' || form === 'shrub' ? 'sapling' : 'seedling';
  let stage = 'mature';
  if (s < 0.15) stage = young;
  else if (!noFlowers && s > 0.92) stage = 'fruiting';
  else if (!noFlowers && s > 0.82) stage = 'flowering';
  return { health, stage };
}

// Height (cm, whole) and diameter (cm, 1 decimal) for the form and stage.
export function measurements(random, form, stage) {
  const ranges = GROWTH_FORMS[form] ?? GROWTH_FORMS.herb;
  const young = stage === 'seedling' || stage === 'sapling';
  const scale = young ? between(random, 0.15, 0.4) : 1;
  const heightM = young
    ? ranges.height[0] * scale + (ranges.height[1] - ranges.height[0]) * 0.05 * random()
    : between(random, ranges.height[0], ranges.height[1]);
  const heightCm = Math.max(1, Math.round(heightM * 100));
  let diameterCm = null;
  if (ranges.diameter) {
    const d = young
      ? ranges.diameter[0] * scale + (ranges.diameter[1] - ranges.diameter[0]) * 0.05 * random()
      : between(random, ranges.diameter[0], ranges.diameter[1]);
    diameterCm = Math.max(0.1, Math.round(d * 10) / 10);
  }
  return { heightCm, diameterCm };
}

// The demo values for one plant (all fields; the planner keeps only the empty ones). known:
// the health and life stage a botanist already recorded, which the generated measurements and
// note then agree with (a recorded "mature" tree is not given a sapling's diameter).
export function demoValuesFor(plant, species, known = {}) {
  const random = seededRandom(plant.id);
  const family = species?.family ?? null;
  const form = growthForm(species?.scientific_name, family);
  const rolled = healthAndStage(random, form);
  const health = NOTES[known.health] ? known.health : rolled.health;
  const stage = known.stage ?? rolled.stage;
  const { heightCm, diameterCm } = measurements(random, form, stage);
  const morphology = (family && FAMILY_MORPHOLOGY[family] && random() < 0.7)
    ? FAMILY_MORPHOLOGY[family]
    : pick(random, MORPHOLOGY[form]);
  const note = pick(random, NOTES[health]) + (STAGE_NOTE[stage] ?? '');
  return {
    form,
    plant: { location_description: locationNote(random, form, family), morphology, description: note },
    observation: { height_cm: heightCm, diameter_cm: diameterCm, health_status: health, life_stage: stage },
  };
}

// When the demo observation is dated: after the plant was registered and after its newest
// observation, but before the day the script runs (yesterday at the latest).
export function demoObservedAt(plant, observations, now, random) {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const latest = Math.max(
    Date.parse(plant.registered_at ?? '') || 0,
    ...observations.map((visit) => Date.parse(visit.observed_at ?? '') || 0)
  );
  const yesterday = today.getTime() - 24 * 3600 * 1000;
  const start = latest > 0 ? latest + 3600 * 1000 : yesterday - 30 * 24 * 3600 * 1000;
  const time = start >= yesterday ? yesterday : start + random() * (yesterday - start);
  return new Date(Math.min(time, yesterday)).toISOString();
}

// What fill.mjs does for each active plant: the EMPTY plant columns get demo values; the
// observation fields that none of its active observations has get one demo observation.
// plants: { id, qr_code_value, registered_by, registered_at, species_id, location_description,
//           morphology, description }
// observationsByPlant: Map plant id -> active observations ({ height_cm, ... observed_at })
// speciesById: Map species id -> { scientific_name, family }
export function planFill(plants, observationsByPlant, speciesById, { now = Date.now(), observerId = null } = {}) {
  const plans = [];
  for (const plant of plants) {
    const species = plant.species_id ? speciesById.get(plant.species_id) : null;
    const visits = observationsByPlant.get(plant.id) ?? [];
    // The newest recorded health and life stage, if any.
    const newest = (field) => [...visits]
      .filter((visit) => !isEmpty(visit[field]))
      .sort((a, b) => String(b.observed_at ?? '').localeCompare(String(a.observed_at ?? '')))[0]?.[field] ?? null;
    const values = demoValuesFor(plant, species, {
      health: newest('health_status')?.toLowerCase() ?? null,
      stage: newest('life_stage')?.toLowerCase() ?? null,
    });

    const plantValues = {};
    for (const field of PLANT_FIELDS) {
      if (isEmpty(plant[field])) plantValues[field] = values.plant[field];
    }
    const observationValues = {};
    for (const field of OBSERVATION_FIELDS) {
      const known = visits.some((visit) => !isEmpty(visit[field]));
      if (!known && values.observation[field] !== null) observationValues[field] = values.observation[field];
    }
    const observer = plant.registered_by ?? observerId;
    const needsObservation = Object.keys(observationValues).length > 0;
    plans.push({
      plant,
      species: species?.scientific_name ?? '',
      form: values.form,
      plantValues,
      observation: needsObservation && observer
        ? {
            ...observationValues,
            plant_id: plant.id,
            observer_id: observer,
            observed_at: demoObservedAt(plant, visits, now, seededRandom(`${plant.id}:date`)),
            review_status: 'approved',
            notes: 'Routine monitoring visit.',
            is_demo: true,
          }
        : null,
      // Observation fields left empty because the plant has no botanist to record them under.
      skippedObservation: needsObservation && !observer ? observationValues : null,
    });
  }
  return plans;
}

// Report rows for the plans (one per generated value).
export function reportRows(plans, action) {
  const rows = [];
  for (const plan of plans) {
    const base = { plant_id: plan.plant.id, tag: plan.plant.qr_code_value ?? '', species: plan.species, growth_form: plan.form };
    for (const [field, value] of Object.entries(plan.plantValues)) {
      rows.push({ ...base, field, old: plan.plant[field] ?? '', new: value, where: 'plant', action });
    }
    if (plan.observation) {
      for (const field of OBSERVATION_FIELDS) {
        if (plan.observation[field] !== undefined) {
          rows.push({ ...base, field, old: '', new: plan.observation[field], where: 'demo observation', action });
        }
      }
    }
    if (plan.skippedObservation) {
      for (const [field, value] of Object.entries(plan.skippedObservation)) {
        rows.push({ ...base, field, old: '', new: value, where: 'demo observation',
          action: 'skipped: plant has no botanist (use --observer <profile id>)' });
      }
    }
  }
  return rows;
}

// What remove.mjs takes out: for each plant with demo_values, the plant columns that still
// hold exactly the generated value (anything changed since is kept), and every observation
// with is_demo = true. Nothing else.
export function planRemoval(plants, demoObservations) {
  const plantResets = [];
  for (const plant of plants) {
    const generated = plant.demo_values;
    if (!generated || typeof generated !== 'object') continue;
    const reset = {};
    const kept = {};
    for (const [field, value] of Object.entries(generated)) {
      if (!PLANT_FIELDS.includes(field)) continue;
      if (plant[field] === value) reset[field] = null;
      else kept[field] = plant[field];
    }
    plantResets.push({ plant, reset, kept });
  }
  const observationIds = demoObservations.filter((visit) => visit && visit.is_demo === true).map((visit) => visit.id);
  return { plantResets, observationIds };
}
