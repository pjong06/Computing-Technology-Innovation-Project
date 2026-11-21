// lib.mjs - the pure parts of fill.mjs and remove.mjs (no network): which plant detail fields
// are empty, plausible demo values for them, and exactly what to take out again.
// Tested by backend/test/demoPlantDetails.test.js.
//
// Plant columns (shown in the app's "This plant" / Morphological characteristics / Notes):
//   location_description, morphology, description (Notes)
// Observation fields (the app and web show the newest observation that has each one):
//   height_cm, diameter_cm, health_status, life_stage
// Coordinates (plants.location, shown on the officer map via plant_map_points and in the plant
// details): plants with no location get a demo point inside Niah National Park.
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
// smaller (see measurements). Mosses and liverworts have no stem, so their "diameter" is the
// width of the clump or cushion (CLUMP_FORMS), 2-15 cm.
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
  moss: { height: [0.01, 0.06], diameter: [2, 15] },
  liverwort: { height: [0.005, 0.03], diameter: [2, 15] },
};
export const CLUMP_FORMS = ['moss', 'liverwort'];

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
  moss: ['Leucobryum'],
  liverwort: ['Cyathodium'],
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
const BROAD_FORMS = { Bryophyta: 'moss', Marchantiophyta: 'liverwort', Polypodiopsida: 'fern', Polypodiineae: 'fern' };

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
  liverwort: [
    'Thallose liverwort forming a flat, ribbon-like green patch pressed to damp soil or rock. No stems or flowers.',
    'Liverwort forming a thin, translucent green mat on moist limestone. Lobes forked; no flowers.',
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
  const rocky = ['Begoniaceae', 'Gesneriaceae'].includes(family) || CLUMP_FORMS.includes(form);
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
  const noFlowers = form === 'fern' || CLUMP_FORMS.includes(form);
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
  if (CLUMP_FORMS.includes(form)) {
    // Clump or cushion width: a young patch is small (2-5 cm), an established one up to 15 cm.
    const d = young ? between(random, 2, 5) : between(random, ranges.diameter[0], ranges.diameter[1]);
    diameterCm = Math.round(d * 10) / 10;
  } else if (ranges.diameter) {
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

// ---- demo coordinates ----
// The demo area: the plank walk and Great Cave side of Niah National Park.
export const NIAH_BOUNDS = { south: 3.80, north: 3.83, west: 113.76, east: 113.80 };
// Each zone in a location note ("..., Zone C") is one part of that area: three columns west to
// east, Zones A-C in the north row and D-F in the south row. A plant whose note names a zone is
// placed in that zone's part, so plants with the same zone appear together on the map.
export const ZONE_AREAS = Object.fromEntries(ZONES.map((zone, index) => {
  const column = index % 3;
  const northRow = index < 3;
  const width = (NIAH_BOUNDS.east - NIAH_BOUNDS.west) / 3;
  const middle = (NIAH_BOUNDS.south + NIAH_BOUNDS.north) / 2;
  return [zone.slice(-1), {
    south: northRow ? middle : NIAH_BOUNDS.south,
    north: northRow ? NIAH_BOUNDS.north : middle,
    west: NIAH_BOUNDS.west + column * width,
    east: NIAH_BOUNDS.west + (column + 1) * width,
  }];
}));
// Demo points are at least this far from every other plant, so map markers don't overlap.
export const MIN_SPACING_M = 20;
export const ACCURACY_RANGE_M = [8, 15];

// The zone letter named in a location note, or null ("Limestone slope, Zone B" -> "B").
export function zoneOf(note) {
  const match = /\bZone ([A-F])\b/i.exec(String(note ?? ''));
  return match ? match[1].toUpperCase() : null;
}

// Distance in metres between two points (flat-earth approximation; fine over a few km).
export function distanceM(a, b) {
  const metresPerDegree = 111320;
  const dy = (a.latitude - b.latitude) * metresPerDegree;
  const dx = (a.longitude - b.longitude) * metresPerDegree * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

export const hasCoordinates = (plant) => Number.isFinite(plant?.latitude) && Number.isFinite(plant?.longitude);

// A demo point for one plant, inside its zone's area (or anywhere in the demo area when the note
// names no zone) and at least MIN_SPACING_M from every point in `occupied`. If the area is too
// crowded for that, the candidate farthest from its nearest neighbour is used. Coordinates are
// rounded to 6 decimals (about 0.1 m), the precision the screens show.
export function demoCoordinates(random, note, occupied) {
  const area = ZONE_AREAS[zoneOf(note)] ?? NIAH_BOUNDS;
  let best = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const point = {
      latitude: Math.round(between(random, area.south, area.north) * 1e6) / 1e6,
      longitude: Math.round(between(random, area.west, area.east) * 1e6) / 1e6,
    };
    const nearest = occupied.reduce((min, other) => Math.min(min, distanceM(point, other)), Infinity);
    if (!best || nearest > best.nearest) best = { point, nearest };
    if (nearest >= MIN_SPACING_M) break;
  }
  return best.point;
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

// What fill.mjs does for each active plant: the EMPTY plant columns get demo values; a plant
// with no coordinates gets a demo point; the observation fields that none of its active
// observations has get one demo observation.
// plants: { id, qr_code_value, registered_by, registered_at, species_id, location_description,
//           morphology, description, latitude, longitude, gps_accuracy_m }
//         (latitude/longitude null when the plant has no location)
// observationsByPlant: Map plant id -> active observations ({ height_cm, ... observed_at })
// speciesById: Map species id -> { scientific_name, family }
export function planFill(plants, observationsByPlant, speciesById, { now = Date.now(), observerId = null } = {}) {
  const plans = [];
  // Every point already on the map (real ones first), so demo points keep clear of them and of
  // each other. Plants are planned in a fixed order (by id), so the dry run and --apply agree.
  const occupied = plants.filter(hasCoordinates).map(({ latitude, longitude }) => ({ latitude, longitude }));
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
    // Coordinates only when the plant has none; real ones are never moved. The zone comes from
    // the note the plant will show (its own, or the demo one filled above).
    let coordinates = null;
    if (!hasCoordinates(plant)) {
      const random = seededRandom(`${plant.id}:location`);
      const note = plantValues.location_description ?? plant.location_description;
      coordinates = demoCoordinates(random, note, occupied);
      occupied.push(coordinates);
      // Accuracy too, unless the plant somehow already has one.
      if (plant.gps_accuracy_m === null || plant.gps_accuracy_m === undefined) {
        coordinates.gps_accuracy_m = Math.round(between(random, ...ACCURACY_RANGE_M));
      }
    }
    const observer = plant.registered_by ?? observerId;
    const needsObservation = Object.keys(observationValues).length > 0;
    // A plant that already has a demo observation from an earlier run (e.g. a moss filled before
    // mosses got a clump width) gets the missing fields added to THAT observation, so it keeps
    // one demo visit and remove.mjs still takes everything out by deleting it.
    const demoVisit = visits.find((visit) => visit.is_demo === true) ?? null;
    plans.push({
      plant,
      species: species?.scientific_name ?? '',
      form: values.form,
      plantValues,
      coordinates,
      observation: needsObservation && !demoVisit && observer
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
      observationUpdate: needsObservation && demoVisit ? { id: demoVisit.id, values: observationValues } : null,
      // Observation fields left empty because the plant has no botanist to record them under.
      skippedObservation: needsObservation && !demoVisit && !observer ? observationValues : null,
    });
  }
  return plans;
}

// The PATCH fill.mjs sends for one plan: `filters` keep it to fields that are STILL empty (so a
// value a botanist entered since the dry run is never overwritten), and demo_values records every
// generated value, coordinates included, on top of what an earlier run recorded.
// null when the plan changes nothing on the plant row.
export function plantUpdate(plan, currentDemoValues) {
  const fields = Object.keys(plan.plantValues);
  if (fields.length === 0 && !plan.coordinates) return null;
  const filters = fields.map((field) => `${field}=is.null`);
  const body = { ...plan.plantValues };
  const generated = { ...(currentDemoValues ?? {}), ...plan.plantValues };
  if (plan.coordinates) {
    const { latitude, longitude, gps_accuracy_m: accuracy } = plan.coordinates;
    filters.push('location=is.null');
    // Extended WKT; PostGIS reads it straight into the geography column (longitude first).
    body.location = `SRID=4326;POINT(${longitude} ${latitude})`;
    if (accuracy !== undefined) {
      filters.push('gps_accuracy_m=is.null');
      body.gps_accuracy_m = accuracy;
    }
    generated.coordinates = plan.coordinates;
  }
  body.demo_values = generated;
  return { filters, body };
}

// Report rows for the plans (one per generated value).
export function reportRows(plans, action) {
  const rows = [];
  for (const plan of plans) {
    const base = { plant_id: plan.plant.id, tag: plan.plant.qr_code_value ?? '', species: plan.species, growth_form: plan.form };
    for (const [field, value] of Object.entries(plan.plantValues)) {
      rows.push({ ...base, field, old: plan.plant[field] ?? '', new: value, where: 'plant', action });
    }
    if (plan.coordinates) {
      const { latitude, longitude, gps_accuracy_m: accuracy } = plan.coordinates;
      rows.push({ ...base, field: 'coordinates', old: '', new: `${latitude}, ${longitude}`, where: 'plant', action });
      if (accuracy !== undefined) rows.push({ ...base, field: 'gps_accuracy_m', old: '', new: accuracy, where: 'plant', action });
    }
    if (plan.observation) {
      for (const field of OBSERVATION_FIELDS) {
        if (plan.observation[field] !== undefined) {
          rows.push({ ...base, field, old: '', new: plan.observation[field], where: 'demo observation', action });
        }
      }
    }
    if (plan.observationUpdate) {
      for (const [field, value] of Object.entries(plan.observationUpdate.values)) {
        rows.push({ ...base, field, old: '', new: value, where: 'existing demo observation', action });
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

// What every active plant should show once the fill is done, and where each value comes from.
export const REQUIRED_DETAILS = [
  { field: 'coordinates', label: 'coordinates' },
  { field: 'location_description', label: 'location note' },
  { field: 'height_cm', label: 'height' },
  { field: 'diameter_cm', label: 'diameter' },
  { field: 'health_status', label: 'health' },
  { field: 'life_stage', label: 'life stage' },
  { field: 'morphology', label: 'morphology' },
  { field: 'description', label: 'notes' },
];

// The details a plant would STILL be missing after its plan is applied, each with the reason.
// Plant columns and coordinates count from the plant row (its own value or the generated one).
// Height, diameter, health and life stage count only from an APPROVED observation (its newest
// approved one that has the field, the demo observation included), the record an officer has
// accepted.
export function missingAfterFill(plan, visits) {
  const update = plan.observationUpdate;
  const approved = [...visits, ...(plan.observation ? [plan.observation] : [])]
    .map((visit) => (update && visit.id === update.id ? { ...visit, ...update.values } : visit))
    .filter((visit) => visit.review_status === 'approved');
  const gaps = [];
  for (const { field, label } of REQUIRED_DETAILS) {
    let present;
    if (field === 'coordinates') present = hasCoordinates(plan.plant) || Boolean(plan.coordinates);
    else if (PLANT_FIELDS.includes(field)) present = !isEmpty(plan.plant[field]) || plan.plantValues[field] !== undefined;
    else present = approved.some((visit) => !isEmpty(visit[field]));
    if (present) continue;

    let reason = 'no value found';
    if (plan.skippedObservation && plan.skippedObservation[field] !== undefined) {
      reason = 'plant has no botanist to record the demo observation under (use --observer <profile id>)';
    } else if (visits.some((visit) => !isEmpty(visit[field]))) {
      // Recorded by a botanist, so no demo value is added; it just isn't approved yet.
      reason = 'recorded only on an observation that is not approved yet (pending, draft or rejected)';
    }
    gaps.push({ field, label, reason });
  }
  return gaps;
}

// Report rows for those gaps, in the same CSV as the fill rows.
export function missingRows(plans, observationsByPlant) {
  const rows = [];
  for (const plan of plans) {
    for (const gap of missingAfterFill(plan, observationsByPlant.get(plan.plant.id) ?? [])) {
      rows.push({ plant_id: plan.plant.id, tag: plan.plant.qr_code_value ?? '', species: plan.species, growth_form: plan.form,
        field: gap.field, old: '', new: '', where: '', action: `still missing ${gap.label}: ${gap.reason}` });
    }
  }
  return rows;
}

// Same point? Both sides are rounded to 6 decimals when generated; allow float noise only.
export const samePoint = (plant, generated) =>
  hasCoordinates(plant) && Math.abs(plant.latitude - generated.latitude) < 1e-7
  && Math.abs(plant.longitude - generated.longitude) < 1e-7;

// What remove.mjs takes out: for each plant with demo_values, the plant columns that still
// hold exactly the generated value (anything changed since is kept), the demo coordinates if
// the plant is still at that point, and every observation with is_demo = true. Nothing else.
// plants: rows with demo_values, plus latitude/longitude (from plant_map_points) and gps_accuracy_m.
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
    const point = generated.coordinates;
    if (point && typeof point === 'object') {
      if (samePoint(plant, point)) {
        reset.location = null;
        // The accuracy goes with it, unless someone changed it since.
        if (point.gps_accuracy_m !== undefined) {
          if (Number(plant.gps_accuracy_m) === point.gps_accuracy_m) reset.gps_accuracy_m = null;
          else kept.gps_accuracy_m = plant.gps_accuracy_m;
        }
      } else {
        kept.location = hasCoordinates(plant) ? `${plant.latitude}, ${plant.longitude}` : null;
      }
    }
    plantResets.push({ plant, reset, kept });
  }
  const observationIds = demoObservations.filter((visit) => visit && visit.is_demo === true).map((visit) => visit.id);
  return { plantResets, observationIds };
}
