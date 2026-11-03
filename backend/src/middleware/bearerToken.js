// Parse HTTP Bearer credentials in one forward pass, without regex backtracking.
// HTTP optional whitespace is SP / HTAB; control characters are not credentials.
function parseBearerToken(header) {
    if (typeof header !== 'string' || header.slice(0, 6).toLowerCase() !== 'bearer') return null;
    let start = 6;
    while (header[start] === ' ' || header[start] === '\t') start++;
    if (start === 6 || start === header.length) return null;
    for (let i = start; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (code <= 32 || code >= 127) return null;
    }
    return header.slice(start);
}

module.exports = { parseBearerToken };
