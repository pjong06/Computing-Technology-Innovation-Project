const REQUEST_TIMEOUT_MS = 30_000;

class PlantAiError extends Error {
  constructor(
    message,
    statusCode = 502
  ) {
    super(message);

    this.name = 'PlantAiError';
    this.statusCode = statusCode;
  }
}

function getConfidenceLevel(
  confidence
) {
  if (confidence >= 70) {
    return 'High';
  }

  if (confidence >= 40) {
    return 'Moderate';
  }

  return 'Low';
}

function mapSuggestions(data) {
  const results =
    Array.isArray(data?.results)
      ? data.results
      : [];

  return results
    .map((result) => {
      const species =
        result?.species;

      const scientificName =
        species
          ?.scientificNameWithoutAuthor ||
        species?.scientificName;

      if (
        typeof scientificName !==
          'string' ||
        scientificName.trim() === ''
      ) {
        return null;
      }

      const rawScore =
        Number(result?.score);

      const safeScore =
        Number.isFinite(rawScore)
          ? Math.max(
              0,
              Math.min(1, rawScore)
            )
          : 0;

      const confidence =
        Number(
          (
            safeScore * 100
          ).toFixed(2)
        );

      return {
        scientificName:
          scientificName.trim(),

        commonName:
          Array.isArray(
            species?.commonNames
          ) &&
          species.commonNames.length > 0
            ? species.commonNames[0]
            : null,

        family:
          species?.family
            ?.scientificNameWithoutAuthor ||
          species?.family
            ?.scientificName ||
          null,

        confidence,

        confidenceLevel:
          getConfidenceLevel(
            confidence
          ),
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        right.confidence -
        left.confidence
    )
    .slice(0, 3)
    .map(
      (suggestion, index) => ({
        rank: index + 1,
        ...suggestion,
      })
    );
}

async function identifyPlant(
  image
) {
  const apiKey =
    process.env.PLANTNET_API_KEY;

  if (!apiKey) {
    throw new PlantAiError(
      'Plant identification is not configured.',
      503
    );
  }

  if (
    typeof fetch !== 'function' ||
    typeof FormData !==
      'function' ||
    typeof Blob !== 'function'
  ) {
    throw new PlantAiError(
      'The backend requires Node.js 20 or later.',
      500
    );
  }

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => {
      controller.abort();
    },
    REQUEST_TIMEOUT_MS
  );

  try {
    const formData =
      new FormData();

    formData.append(
      'images',

      new Blob(
        [image.buffer],
        {
          type: image.mimetype,
        }
      ),

      image.filename
    );

    formData.append(
      'organs',
      'auto'
    );

    const url = new URL(
      'https://my-api.plantnet.org/v2/identify/all'
    );

    url.searchParams.set(
      'api-key',
      apiKey
    );

    url.searchParams.set(
      'nb-results',
      '3'
    );

    url.searchParams.set(
      'lang',
      'en'
    );

    const response =
      await fetch(url, {
        method: 'POST',
        body: formData,
        signal:
          controller.signal,
      });

    if (
      response.status === 404
    ) {
      return [];
    }

    if (
      response.status === 429
    ) {
      throw new PlantAiError(
        'Identification limit reached. Please try again later.',
        503
      );
    }

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      throw new PlantAiError(
        'Plant identification authentication failed.',
        502
      );
    }

    if (!response.ok) {
      throw new PlantAiError(
        'Plant identification service is unavailable.',
        502
      );
    }

    let responseData;

    try {
      responseData =
        await response.json();
    } catch {
      throw new PlantAiError(
        'Plant identification returned an invalid response.',
        502
      );
    }

    return mapSuggestions(
      responseData
    );
  } catch (error) {
    if (
      error instanceof
      PlantAiError
    ) {
      throw error;
    }

    if (
      controller.signal.aborted
    ) {
      throw new PlantAiError(
        'Plant identification took too long. Please retry.',
        504
      );
    }

    console.error(
      'Pl@ntNet request failed:',

      error instanceof Error
        ? error.message
        : error
    );

    throw new PlantAiError(
      'Could not reach the plant identification service.',
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  identifyPlant,
  PlantAiError,
};