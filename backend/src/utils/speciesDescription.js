function removeLegacyObservationSource(description) {
    if (typeof description !== 'string') return description;
    return description
        .replace(/(?:\r?\n|[ \t]+)*Source:\s*iNaturalist observation\s+https?:\/\/\S+[ \t]*$/i, '')
        .trimEnd();
}

module.exports = { removeLegacyObservationSource };
