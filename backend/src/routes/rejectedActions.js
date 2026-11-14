/*Rejected observation action, Evaluate Again and Permanently Delete button.*/
const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('officer'));

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reopen a rejected observation for officer evaluation.
router.patch('/:observationId/reopen', async (req, res) => {
  const observationId = req.params.observationId;

  if (!uuidPattern.test(observationId)) {
    return res.status(400).json({
      message: 'Valid observation ID is required'
    });
  }

  const { data, error } = await req.supabase
    .from('observations')
    .update({ review_status: 'pending' })
    .eq('id', observationId)
    .eq('review_status', 'rejected')
    .is('deleted_at', null)
    .select('id, review_status')
    .maybeSingle();

  if (error) {
    console.error('Reopen observation error:', error);
    return res.status(500).json({
      message: 'Could not reopen observation'
    });
  }

  if (!data) {
    return res.status(409).json({
      message: 'Observation is no longer rejected or update was not permitted'
    });
  }

  return res.json({
    message: 'Observation returned to approval queue',
    data
  });
});

// Permanently delete a rejected observation.
router.delete('/:observationId/permanent', async (req, res) => {
  const observationId = req.params.observationId;

  if (!uuidPattern.test(observationId)) {
    return res.status(400).json({
      message: 'Valid observation ID is required'
    });
  }

  // Get the stored photo paths before deleting database records.
  const { data: media, error: mediaError } = await req.supabase
    .from('observation_media')
    .select('file_path')
    .eq('observation_id', observationId)
    .is('deleted_at', null);

  if (mediaError) {
    console.error('Observation photo lookup error:', mediaError);
    return res.status(500).json({
      message: 'Could not check observation photographs'
    });
  }

  // Delete the observation and related database records.
  const { error } = await req.supabase.rpc(
    'officer_delete_rejected_observation',
    { p_observation_id: observationId }
  );

  if (error) {
    console.error('Permanent observation deletion error:', error);
    return res.status(409).json({
      message: 'Could not permanently delete this rejected observation'
    });
  }

  // Remove stored photo files after the database deletion.
  const paths = (media || [])
    .map(item => item.file_path)
    .filter(Boolean);

  if (paths.length > 0) {
    const { error: storageError } = await req.supabase.storage
      .from('observation-media')
      .remove(paths);

    if (storageError) {
      console.error('Observation storage cleanup error:', storageError);

      return res.status(200).json({
        message: 'Observation deleted, but some photo files need cleanup',
        storage_cleanup_pending: true
      });
    }
  }

  return res.json({
    message: 'Rejected observation permanently deleted'
  });
});

// Read photographs belonging to a rejected observation.
// Officer-only authentication is already applied to this router.
router.get('/:observationId/photos', async (req, res) => {
  const observationId = req.params.observationId;

  if (!uuidPattern.test(observationId)) {
    return res.status(400).json({
      message: 'Valid observation ID is required'
    });
  }

  try {
    // Confirm the observation is rejected.
    const { data: observation, error: observationError } =
      await req.supabase
        .from('observations')
        .select('id')
        .eq('id', observationId)
        .eq('review_status', 'rejected')
        .is('deleted_at', null)
        .maybeSingle();

    if (observationError) {
      throw observationError;
    }

    if (!observation) {
      return res.status(404).json({
        message: 'Rejected observation not found'
      });
    }

    // Find the photographs linked to this observation.
    const { data: media, error: mediaError } =
      await req.supabase
        .from('observation_media')
        .select('file_path, is_primary')
        .eq('observation_id', observationId)
        .eq('media_type', 'image')
        .is('deleted_at', null)
        .order('is_primary', { ascending: false });

    if (mediaError) {
      throw mediaError;
    }

    const photos = [];

    for (const item of media || []) {
      if (!item.file_path) continue;

      // Generate a temporary URL for the private image.
      const { data, error } = await req.supabase.storage
        .from('observation-media')
        .createSignedUrl(item.file_path, 3600);

      if (error) {
        console.error('Could not sign observation photo:', error);
        continue;
      }

      if (data?.signedUrl) {
        photos.push({
          signed_url: data.signedUrl
        });
      }
    }

    res.set('Cache-Control', 'no-store');

    return res.json({
      data: photos
    });

  } catch (error) {
    console.error('Rejected observation photo error:', error);

    return res.status(500).json({
      message: 'Could not load rejected observation photographs'
    });
  }
});

module.exports = router;