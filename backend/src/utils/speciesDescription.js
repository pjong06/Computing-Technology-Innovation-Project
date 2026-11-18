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

module.exports = { removeLegacyObservationSource };
