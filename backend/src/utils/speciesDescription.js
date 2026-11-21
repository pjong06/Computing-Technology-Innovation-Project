// Removes the old "Source: iNaturalist observation <url>" line that imported species
// descriptions used to end with. Same results as the previous regex
//   /(?:\r?\n|[ \t]+)*Source:\s*iNaturalist observation\s+https?:\/\/\S+[ \t]*$/i
// followed by trimEnd(), but done by scanning back from the end of the text once, so a
// long or crafted description can't make it slow (no backtracking regex; SonarCloud S5852).

const SOURCE_LABEL = 'source:';
const OBSERVATION_LABEL = 'inaturalist observation';

// One whitespace character, as \s in a JavaScript regex (also what trimEnd removes).
function isWhitespace(character) {
    return character !== undefined && character.trim() === '';
}

// True when text[start, end) is the ASCII label, ignoring upper/lower case.
function endsWithLabel(text, end, label) {
    const start = end - label.length;
    return start >= 0 && text.slice(start, end).toLowerCase() === label;
}

// The text before a trailing "Source: iNaturalist observation <http(s) url>" line, or the
// whole text when it doesn't end with one.
function cutSourceLine(text) {
    // Spaces or tabs after the URL ([ \t]*$).
    let end = text.length;
    while (end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--;

    // The URL: the last run of non-whitespace characters, starting http:// or https://.
    let urlStart = end;
    while (urlStart > 0 && !isWhitespace(text[urlStart - 1])) urlStart--;
    const url = text.slice(urlStart, end).toLowerCase();
    const scheme = url.startsWith('https://') ? 8 : url.startsWith('http://') ? 7 : 0;
    if (scheme === 0 || url.length <= scheme || urlStart === 0) return text;

    // At least one whitespace character, then "iNaturalist observation".
    let position = urlStart;
    while (position > 0 && isWhitespace(text[position - 1])) position--;
    if (!endsWithLabel(text, position, OBSERVATION_LABEL)) return text;
    position -= OBSERVATION_LABEL.length;

    // Any whitespace, then "Source:".
    while (position > 0 && isWhitespace(text[position - 1])) position--;
    if (!endsWithLabel(text, position, SOURCE_LABEL)) return text;
    return text.slice(0, position - SOURCE_LABEL.length);
}

function removeLegacyObservationSource(description) {
    if (typeof description !== 'string') return description;
    // Whitespace before "Source:" is removed by trimEnd, as before.
    return cutSourceLine(description).trimEnd();
}

// ---- Credit and source fragments in species text ----
// Species text sometimes still carries photo credits or sources from imports:
//   "Identified to family level only. (photo by Niah National Park)."
//   "A climbing fern. Photo: J. Tan, CC BY via iNaturalist"
//   "Leaves glossy, photo by A. Rahman"   "See https://example.org/x"
// cleanSpeciesText removes them and tidies what is left (spaces, doubled full stops).
// Ordinary text is left as it is. Done with indexOf scans and simple, non-nested patterns,
// so long text can't make it slow (SonarCloud S5852).

// A parenthesised part is a credit when it starts with one of these (lower case).
const CREDIT_GROUP_STARTS = ['photo', 'photos', 'photograph', 'image', 'picture', 'source', 'sources',
    'credit', 'credits', 'courtesy', 'via ', '©', '(c)', 'copyright'];

// From one of these to the end of the line is a credit. "start": only at the start of a line
// or sentence; "anywhere": also after a comma, dash or space inside a sentence.
const CREDIT_MARKERS = [
    { text: 'photo:', where: 'start' }, { text: 'photos:', where: 'start' },
    { text: 'image:', where: 'start' }, { text: 'source:', where: 'start' },
    { text: 'sources:', where: 'start' }, { text: 'credit:', where: 'start' },
    { text: 'credits:', where: 'start' }, { text: 'courtesy of ', where: 'start' },
    { text: 'via ', where: 'start' }, { text: '(c) ', where: 'start' }, { text: '©', where: 'start' },
    { text: 'photo by ', where: 'anywhere' }, { text: 'photos by ', where: 'anywhere' },
    { text: 'photograph by ', where: 'anywhere' }, { text: 'photographed by ', where: 'anywhere' },
    { text: 'image by ', where: 'anywhere' }, { text: 'photo credit', where: 'anywhere' },
    { text: 'via inaturalist', where: 'anywhere' },
];

function previousNonSpace(text, index) {
    let position = index - 1;
    while (position >= 0 && (text[position] === ' ' || text[position] === '\t')) position--;
    return position < 0 ? '' : text[position];
}

// Parenthesised credits: "(photo by …)", "(Source: …)", "(© …)". Not nested.
function removeCreditGroups(line) {
    let out = '';
    let index = 0;
    while (index < line.length) {
        const open = line.indexOf('(', index);
        if (open === -1) break;
        const close = line.indexOf(')', open + 1);
        if (close === -1) break;
        const inner = line.slice(open + 1, close).trim().toLowerCase();
        out += line.slice(index, open);
        if (!CREDIT_GROUP_STARTS.some(start => inner.startsWith(start))) out += line.slice(open, close + 1);
        index = close + 1;
    }
    return out + line.slice(index);
}

// Cuts the line at the first credit marker in a place where it is a credit.
function cutCreditTail(line) {
    const lower = line.toLowerCase();
    let cut = -1;
    for (const marker of CREDIT_MARKERS) {
        let from = 0;
        while (from <= lower.length) {
            const at = lower.indexOf(marker.text, from);
            if (at === -1) break;
            const before = previousNonSpace(lower, at);
            const wordStart = at === 0 || lower[at - 1] === ' ' || lower[at - 1] === '\t' || lower[at - 1] === '(';
            const sentenceStart = before === '' || '.!?'.includes(before);
            const ok = marker.where === 'start'
                ? sentenceStart && wordStart
                : wordStart && (sentenceStart || ',;-–—'.includes(before) || /[a-z0-9)]/.test(before));
            if (ok) {
                if (cut === -1 || at < cut) cut = at;
                break;
            }
            from = at + 1;
        }
    }
    return cut === -1 ? line : line.slice(0, cut);
}

// Words that are links.
function removeUrls(line) {
    return line.split(' ').filter(word => {
        const lower = word.toLowerCase().replace(/^[("'[]+/, '');
        return !(lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('www.'));
    }).join(' ');
}

// Spaces and punctuation left behind: "only. ." -> "only.", "a  b" -> "a b", "x ," -> "x,".
function tidy(line) {
    let text = line.replace(/\t/g, ' ');
    text = text.replace(/ {2,}/g, ' ');
    text = text.replace(/\(\s*\)/g, '');
    text = text.replace(/ +([.,;:!?])/g, '$1');
    text = text.replace(/([.,;:])(?:[ ]?[.,;:])+/g, (match, first) => (first === ',' && match.includes('.') ? '.' : first));
    text = text.replace(/ {2,}/g, ' ');
    // Dangling separators at the end: "Leaves glossy," -> "Leaves glossy."
    text = text.trim().replace(/[,;:\-–—]+$/, '').trimEnd();
    return text;
}

// The text with credit and source fragments removed and spacing tidied. Not a string: as is.
function cleanSpeciesText(value) {
    if (typeof value !== 'string') return value;
    const base = removeLegacyObservationSource(value);
    const lines = base.split(/\r?\n/).map(line => {
        const cleaned = tidy(removeUrls(cutCreditTail(removeCreditGroups(line))));
        // A sentence cut short keeps its full stop: "Leaves glossy" (was ", photo by …").
        return cleaned && line.trim() !== cleaned && /[a-z0-9)]$/i.test(cleaned) && /[.!?]\s*$/.test(line.trim())
            ? `${cleaned}.`
            : cleaned;
    });
    // No runs of empty lines, none at the start or end.
    const kept = [];
    for (const line of lines) {
        if (line === '' && (kept.length === 0 || kept[kept.length - 1] === '')) continue;
        kept.push(line);
    }
    while (kept.length && kept[kept.length - 1] === '') kept.pop();
    return kept.join('\n');
}

// Species text fields that are shown to people.
const SPECIES_TEXT_FIELDS = ['description', 'habitat', 'distribution_notes', 'morphology', 'cultural_significance'];

// A copy of the species with its text fields cleaned (for responses).
function cleanSpeciesFields(species) {
    if (!species || typeof species !== 'object') return species;
    const cleaned = { ...species };
    for (const field of SPECIES_TEXT_FIELDS) {
        if (typeof species[field] === 'string') cleaned[field] = cleanSpeciesText(species[field]);
    }
    return cleaned;
}

module.exports = { removeLegacyObservationSource, cleanSpeciesText, cleanSpeciesFields, SPECIES_TEXT_FIELDS };
