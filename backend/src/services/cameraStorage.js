const { createClient } = require('@supabase/supabase-js');
const { createHash } = require('node:crypto');
const BUCKET = 'camera-evidence';
function createCameraStorage(env = process.env, injectedClient) {
  if (!injectedClient && (!env.SUPABASE_URL?.startsWith('https://') || !env.CAMERA_DATABASE_SERVER_KEY)) throw new Error('Camera cloud upload requires HTTPS and a server-side credential');
  const client = injectedClient || createClient(env.SUPABASE_URL, env.CAMERA_DATABASE_SERVER_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async sync(record, bytes, checkpoint = async () => {}) {
      if (!record.database_reading_id) throw new Error('Persisted reading required before cloud linking');
      if (bytes.length !== record.byte_count || createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw new Error('Local evidence integrity failure');
      const bucket = await client.storage.getBucket(BUCKET);
      if (bucket.error || bucket.data?.public !== false) throw new Error('Private camera bucket required');
      const reading = await client.from('sensor_readings').select('id,station_id').eq('id', record.database_reading_id).single();
      if (reading.error || !reading.data) throw new Error('Persisted reading unavailable');
      const station = await client.from('sensor_stations').select('id').eq('id', reading.data.station_id).eq('station_code', record.station_code).single();
      if (station.error || !station.data) throw new Error('Station does not match');
      // Bind photos to the combined movement/range rule, never an unrelated
      // temperature alert created for the same reading.
      let alertQuery = client.from('alerts').select('id').eq('reading_id', record.database_reading_id).eq('station_id', reading.data.station_id).like('alert_message', '% (movement_nearby_cm)');
      if (record.cloud?.alert_id) alertQuery = alertQuery.eq('id', record.cloud.alert_id);
      const alert = await alertQuery.order('triggered_at', { ascending: false }).order('id').limit(1).maybeSingle();
      if (alert.error || !alert.data) throw new Error('No persisted alert associated with the triggering reading');
      const object = `${reading.data.station_id}/${alert.data.id}/${record.id}.jpg`;
      record.cloud = { alert_id: alert.data.id, bucket: BUCKET, file_path: object };
      await checkpoint(record);
      // Retry is idempotent: object name is stable and upsert is never enabled.
      const existing = await client.from('alert_camera_evidence').select('id,alert_id,file_path,sha256').eq('id', record.id).maybeSingle();
      if (existing.error) throw new Error('Camera schema unavailable');
      if (existing.data) {
        if (existing.data.alert_id !== alert.data.id || existing.data.file_path !== object || existing.data.sha256 !== record.sha256) throw new Error('Conflicting evidence identity');
        return { alert_id: alert.data.id, bucket: BUCKET, file_path: object };
      }
      const uploaded = await client.storage.from(BUCKET).upload(object, bytes, { contentType: 'image/jpeg', upsert: false });
      if (uploaded.error && Number(uploaded.error.statusCode || uploaded.error.status) !== 409) throw new Error('Private upload failed');
      if (uploaded.error) {
        // Do not trust an unrelated object at the same name after a conflict.
        const stored = await client.storage.from(BUCKET).download(object);
        if (stored.error || !stored.data || !Buffer.from(await stored.data.arrayBuffer()).equals(bytes)) throw new Error('Stored bytes do not match');
      }
      const linked = await client.from('alert_camera_evidence').insert({ id: record.id, alert_id: alert.data.id, file_path: object, captured_at: record.captured_at, byte_count: record.byte_count, sha256: record.sha256 });
      if (linked.error) throw new Error('Evidence association failed; retain local file and retry same ID');
      return { alert_id: alert.data.id, bucket: BUCKET, file_path: object };
    },
  };
}
module.exports = { createCameraStorage };
