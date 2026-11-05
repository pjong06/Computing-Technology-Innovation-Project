'use strict';

const express = require('express');

const router = express.Router();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_TYPES = new Set(['plant', 'observation']);
const OPERATION_TYPES = new Set(['create', 'update', 'delete']);
const MAX_BATCH_SIZE = 50;
const MAX_OPERATION_BYTES = 256 * 1024;
const UPDATE_FIELDS = {
  plant: new Set([
    'species_id',
    'qr_code_value',
    'latitude',
    'longitude',
    'gps_accuracy_m',
    'location_description',
    'morphology',
    'description',
  ]),
  observation: new Set([
    'observed_at',
    'notes',
    'height_cm',
    'diameter_cm',
    'life_stage',
    'health_status',
    'latitude',
    'longitude',
    'gps_accuracy_m',
  ]),
};

function isPlainObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function validCoordinate(value, min, max) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max;
}

function validOptionalUuid(value) {
  return value == null ||
    (typeof value === 'string' && UUID_PATTERN.test(value));
}

function validateOperation(operation) {
  if (!isPlainObject(operation)) return 'Each operation must be an object';

  const {
    operation_id: operationId,
    entity_type: entityType,
    operation_type: operationType,
    client_record_id: clientRecordId,
    base_version: baseVersion,
    payload = {},
  } = operation;

  if (typeof operationId !== 'string' || !UUID_PATTERN.test(operationId)) {
    return 'operation_id must be a UUID';
  }
  if (!ENTITY_TYPES.has(entityType)) {
    return 'entity_type must be plant or observation';
  }
  if (!OPERATION_TYPES.has(operationType)) {
    return 'operation_type must be create, update or delete';
  }
  if (typeof clientRecordId !== 'string' || !UUID_PATTERN.test(clientRecordId)) {
    return 'client_record_id must be a UUID';
  }
  if (!isPlainObject(payload)) return 'payload must be an object';

  if (Buffer.byteLength(JSON.stringify(operation), 'utf8') > MAX_OPERATION_BYTES) {
    return 'Operation is too large; photos must use the media upload endpoint';
  }

  if (operationType !== 'create' &&
      (!Number.isSafeInteger(baseVersion) || baseVersion < 1)) {
    return 'base_version must be a positive integer for update and delete';
  }

  if (!validOptionalUuid(payload.species_id)) return 'species_id must be a UUID';

  if (payload.qr_code_value != null &&
      (typeof payload.qr_code_value !== 'string' ||
       !/^NIAH-PLT-\d{5}$/.test(payload.qr_code_value.trim().toUpperCase()))) {
    return 'qr_code_value must look like NIAH-PLT-00001';
  }

  const hasLatitude = Object.hasOwn(payload, 'latitude');
  const hasLongitude = Object.hasOwn(payload, 'longitude');
  if (hasLatitude !== hasLongitude) {
    return 'latitude and longitude must be provided together';
  }
  if (hasLatitude &&
      (!validCoordinate(payload.latitude, -90, 90) ||
       !validCoordinate(payload.longitude, -180, 180))) {
    return 'Valid latitude and longitude are required';
  }

  if (payload.gps_accuracy_m != null &&
      (typeof payload.gps_accuracy_m !== 'number' ||
       !Number.isFinite(payload.gps_accuracy_m) ||
       payload.gps_accuracy_m < 0)) {
    return 'gps_accuracy_m must be a non-negative number';
  }

  for (const field of ['height_cm', 'diameter_cm']) {
    if (payload[field] != null &&
        (typeof payload[field] !== 'number' ||
         !Number.isFinite(payload[field]) ||
         payload[field] < 0)) {
      return `${field} must be a non-negative number`;
    }
  }

  for (const [field, maxLength] of Object.entries({
    location_description: 500,
    morphology: 5000,
    description: 5000,
    notes: 5000,
    life_stage: 100,
    health_status: 100,
  })) {
    if (payload[field] != null &&
        (typeof payload[field] !== 'string' ||
         payload[field].length > maxLength)) {
      return `${field} must be text of at most ${maxLength} characters`;
    }
  }

  if (payload.observed_at != null &&
      (typeof payload.observed_at !== 'string' ||
       !Number.isFinite(Date.parse(payload.observed_at)))) {
    return 'observed_at must be a valid date';
  }

  if (operationType === 'update' &&
      !Object.keys(payload).some(field => UPDATE_FIELDS[entityType].has(field))) {
    return 'Update payload does not contain any editable fields';
  }

  if (entityType === 'plant' && operationType === 'create' &&
      (!hasLatitude || !hasLongitude)) {
    return 'Plant create requires latitude and longitude';
  }

  if (entityType === 'observation' && operationType === 'create') {
    const plantClientId = payload.plant_client_record_id;
    const plantId = payload.plant_id;
    if ((typeof plantClientId !== 'string' || !UUID_PATTERN.test(plantClientId)) &&
        (typeof plantId !== 'string' || !UUID_PATTERN.test(plantId))) {
      return 'Observation create requires a valid plant_client_record_id or plant_id';
    }
  }

  return null;
}

async function applyOperation(req, operation) {
  const validationError = validateOperation(operation);
  if (validationError) {
    return {
      operation_id: operation?.operation_id ?? null,
      status: 'failed',
      code: 'invalid_operation',
      message: validationError,
    };
  }

  const { data, error } = await req.supabase.rpc(
    'apply_botanist_sync_operation',
    {
      p_operation_id: operation.operation_id,
      p_entity_type: operation.entity_type,
      p_operation_type: operation.operation_type,
      p_client_record_id: operation.client_record_id,
      p_base_version: operation.base_version ?? null,
      p_payload: operation.payload ?? {},
    }
  );

  const isPlantUpdate =
    operation.entity_type === 'plant' && operation.operation_type === 'update';

  // A tag another plant already has (unique qr_code_value). Retrying can't fix it,
  // so it comes back as a conflict, which the phone doesn't retry on its own.
  // (A duplicate client_record_id is a different, retryable race, so it is left out.)
  if (
    error?.code === '23505' &&
    operation.entity_type === 'plant' &&
    operation.payload?.qr_code_value &&
    !/client_record_id/i.test(`${error.message ?? ''} ${error.details ?? ''}`)
  ) {
    return {
      operation_id: operation.operation_id,
      status: 'conflict',
      code: 'tag_in_use',
      message: 'This tag is already attached to another plant',
    };
  }

  // The botanist's own plant that RLS no longer lets them change (e.g. after
  // submission): either refused outright (42501 from the update itself, not the
  // sign-in/role checks at the top of the function) or hidden from the update,
  // which the function reports as not_found.
  const lockedByPolicy =
    error?.code === '42501' &&
    !/authentication required|botanist role required/i.test(error.message ?? '');
  const hiddenFromUpdate =
    !error && data?.status === 'failed' && data?.code === 'not_found';
  if (isPlantUpdate && (lockedByPolicy || hiddenFromUpdate)) {
    return {
      operation_id: operation.operation_id,
      status: 'conflict',
      code: 'plant_locked',
      message: "This plant can't be changed any more",
    };
  }

  if (error) {
    console.error('Sync push operation error:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      operation_id: operation.operation_id,
    });

    return {
      operation_id: operation.operation_id,
      status: error.code === '42501' ? 'failed' : 'retry',
      code: error.code === '42501' ? 'permission_denied' : 'server_unavailable',
      message: error.code === '42501'
        ? 'The operation is not permitted'
        : 'The operation could not be processed yet',
    };
  }

  return data;
}

router.post('/push', async (req, res) => {
  const operations = req.body?.operations;

  if (!Array.isArray(operations) || operations.length === 0) {
    return res.status(400).json({
      message: 'operations must be a non-empty array',
    });
  }
  if (operations.length > MAX_BATCH_SIZE) {
    return res.status(400).json({
      message: `A sync batch may contain at most ${MAX_BATCH_SIZE} operations`,
    });
  }

  // Preserve outbox order so a plant create completes before a dependent
  // observation create. A failed item does not hide the remaining results.
  const results = [];
  for (const operation of operations) {
    results.push(await applyOperation(req, operation));
  }

  const summary = results.reduce(
    (counts, result) => {
      if (Object.hasOwn(counts, result.status)) counts[result.status] += 1;
      return counts;
    },
    { success: 0, conflict: 0, failed: 0, retry: 0 }
  );

  res.set('Cache-Control', 'no-store');
  return res.json({ results, summary });
});

router.get('/pull', async (req, res) => {
  const cursor = req.query.cursor === undefined ? 0 : Number(req.query.cursor);
  const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);

  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    return res.status(400).json({ message: 'cursor must be a non-negative integer' });
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    return res.status(400).json({ message: 'limit must be between 1 and 500' });
  }

  const { data, error } = await req.supabase.rpc('pull_botanist_changes', {
    p_after_sequence: cursor,
    p_limit: limit,
  });

  if (error) {
    console.error('Sync pull error:', { code: error.code });
    return res.status(503).json({ message: 'Could not download server changes' });
  }

  const changes = Array.isArray(data) ? data : [];
  const nextCursor = changes.length > 0
    ? changes[changes.length - 1].sequence_cursor
    : cursor;

  res.set('Cache-Control', 'no-store');
  return res.json({
    changes,
    next_cursor: nextCursor,
    has_more: changes.length === limit,
    server_time: new Date().toISOString(),
  });
});

module.exports = router;
module.exports.validateOperation = validateOperation;
