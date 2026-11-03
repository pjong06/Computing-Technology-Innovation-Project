import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { apiFetch, apiUpload, ApiError } from '../api/client';
import { deleteStoredPhoto, resolveStoredPhotoUri } from '../utils/photoStorage';
import { useProfileStore } from './useProfileStore';
// recordMapper imports only types from this file (import type), so there is no
// runtime circular dependency between the two.
import { mapLocalRecordToBackend, mapLocalObservationToBackend } from '../services/recordMapper';

export enum SyncStatus {
  UPLOADED = 'Uploaded',
  NOT_UPLOADED = 'Not uploaded',
  FAILED = 'Upload failed',
  LOCAL_ONLY = 'Local only',
}

export enum RecordStatus {
  DRAFT = 'draft',
  COMPLETE = 'complete',
}

export enum IdentificationStatus {
  PENDING = 'pending',
  IDENTIFIED = 'identified',
}

// The officer's review (same values as review_status on the server).
export enum ReviewStatus {
  DRAFT = 'draft',       // botanist still working on it
  PENDING = 'pending',   // submitted, waiting for an officer
  APPROVED = 'approved',
  REJECTED = 'rejected', // officer sent it back with a comment
}

export type HealthStatus = 'Healthy' | 'Stressed' | 'Diseased' | 'Damaged' | 'Dead';
export type LifeStage =
  | 'Bud'
  | 'Flowering'
  | 'Vegetative'
  | 'Fruiting'
  | 'Seedling'
  | 'Sapling'
  | 'Pole'
  | 'Mature'
  | 'Senescent';

// The four photo slots on New Record, as the backend names them (plant_media.photo_type).
export type PlantPhotoType = 'whole_plant' | 'leaf' | 'flower' | 'bark';

// Upload state of one stored photo (a record photo or a visit photo), kept in
// photoMeta under the photo's stored URI.
export interface PhotoUpload {
  id: string; // UUID made on the phone; sent as client_photo_id so a retry isn't saved twice
  type?: PlantPhotoType; // record photos only. Missing on older records: not uploaded
  uploaded: boolean; // true once the server has confirmed it
  // Why it can't go up: over the 5 MB limit (the botanist removes it), or the plant/visit
  // was already submitted ("Photos can't be added after submission").
  problem?: 'too_large' | 'locked' | 'missing';
}

// The backend's limit for one photo (backend/src/services/storageService.js).
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface ObservationVisit {
  id: string; // UUID generated on the phone; sent as client_record_id
  date: string; // for display only, e.g. "22 Oct 2026 · 3:15 PM"
  // When the visit happened, as an ISO 8601 string (e.g. "2026-10-22T07:15:00.000Z").
  // This is what gets uploaded. Visits saved before store v6 don't have it.
  observedAt?: string;
  recordedBy: string;
  // Optional because the registration visit (made on submit for a record with no
  // visits) has no health or stage to report. Screens show "Not recorded" instead.
  health?: HealthStatus;
  // The first four are the older phenology stages; the rest are the growth stages
  // from the 3-step Add Observation screen. Old visits keep their values.
  stage?: LifeStage;
  measurement: string;
  // Height and stem diameter in centimetres, from the 3-step Add Observation screen.
  // Sent as height_cm / diameter_cm. Older visits only have the free-text measurement.
  heightCm?: number;
  diameterCm?: number;
  // Evidence photos for this visit, stored on the phone. Uploaded by syncRecord after the
  // visit itself and before it is submitted. Cleared with every other photo on logout.
  photoUris?: string[];
  photoMeta?: Record<string, PhotoUpload>; // upload state, by URI (filled in on first sync)
  notes: string;
  syncStatus: SyncStatus;
  // The server's id for this visit (observations.id), saved after a successful upload.
  // Needed later to submit the visit for review (PATCH /api/observations/:id/submit).
  serverId?: string;
  // True once the server has accepted this visit for officer review (it's "pending"
  // there). Visits without it are still drafts on the server.
  submittedForReview?: boolean;
}

export interface PlantRecord {
  id: string; // UUID generated on the phone; stays the same after sync
  // The server's id for this plant (plants.id), saved as soon as the plant upload
  // succeeds. Observations are uploaded with it as plant_id. If it's set, the plant
  // itself is already on the server and a retry only re-sends the observations.
  serverId?: string;
  tagCode: string | null; // code of the pre-printed tag on the plant; null until one is attached
  scientificName: string;
  speciesId: string | null;
  commonName: string;
  family: string;
  height?: string;
  morphology?: string;
  description?: string;
  locationName: string;
  // Raw GPS fix. Optional because records saved before 1.2 only have the display string.
  latitude?: number;
  longitude?: number;
  gpsAccuracyM?: number | null; // null when the device didn't report accuracy
  gpsCoordination: string; // formatted for display only, e.g. "3.81760° N, 113.78100° E (±5 m)"
  photoUris: string[];
  // Upload state of each photo, by URI, with its slot type. Records saved before photo
  // upload have no entry: their photos stay on the phone (the slot can't be recovered).
  photoMeta?: Record<string, PhotoUpload>;
  recordStatus: RecordStatus;
  identificationStatus: IdentificationStatus;
  syncStatus: SyncStatus;
  reviewStatus: ReviewStatus;
  reviewComment?: string | null; // officer's reason when rejected
  createdAt: string; // for display only, e.g. "2 Nov" (no year or time)
  // When the record was created, as an ISO 8601 string. Records saved before store v7
  // don't have it.
  createdAtIso?: string;
  conservationStatus?: 'EN' | 'VU' | 'LC' | 'CR';
  routeLength?: string;
  walkingTime?: string;
  observations: ObservationVisit[];
}

export interface RecordedRoute {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  endGps: string;
  linkedPlantId?: string;
  createdAt: string;
}

// What syncRecord tells the screen: success, or a message it can show to the user.
// submittedForReview is true when the record is pending on the phone and every one of
// its visits is now in the officer's review queue on the server.
// photosUploaded / photoProblems count this record's photos sent now, and photos that
// can't be sent (over 5 MB, or added after submission).
export type SyncResult = ({ ok: true; submittedForReview: boolean } | { ok: false; reason: string }) & {
  photosUploaded?: number;
  photoProblems?: number;
};

// True when a record may go to the server: a completed record with a confirmed,
// approved species. Drafts (Local only) are kept on the phone until then.
function isUploadable(record: PlantRecord): boolean {
  return (
    record.syncStatus !== SyncStatus.LOCAL_ONLY &&
    record.recordStatus === RecordStatus.COMPLETE &&
    record.identificationStatus === IdentificationStatus.IDENTIFIED &&
    !!record.speciesId
  );
}

// True when a record pending on the phone has every visit submitted on the server.
function isFullySubmitted(record: PlantRecord | undefined): boolean {
  return (
    record?.reviewStatus === ReviewStatus.PENDING &&
    record.observations.length > 0 &&
    record.observations.every((obs) => obs.submittedForReview)
  );
}

// What syncAll tells the screen: how many records went up, how many didn't, and how
// many it left alone because they were already uploading (e.g. Retry was tapped first).
export interface SyncAllResult {
  uploaded: number;
  failed: number;
  skipped: number;
  photosUploaded: number;
  photoProblems: number;
}

// Thrown when photos block a record (over 5 MB): the record is marked FAILED with this
// message, after everything else has been uploaded.
class PhotoProblemError extends Error {}

// Reads one stored photo for upload, or says why it can't be sent.
function photoFileFor(uri: string): { file: File } | { problem: 'too_large' | 'missing' } {
  const file = new File(resolveStoredPhotoUri(uri));
  if (!file.exists) return { problem: 'missing' };
  if (file.size > MAX_PHOTO_BYTES) return { problem: 'too_large' };
  return { file };
}

// What submitForReview tells the screen. ok: false means the record was NOT submitted
// (it stays as it was). ok: true means it is now pending on this phone; `sync` then says
// whether the upload that followed worked, so the screen can warn if it didn't.
export type SubmitResult = { ok: true; sync: SyncResult } | { ok: false; reason: string };

// Server responses we read. Both routes return the saved row, also when it was
// already saved by an earlier attempt (200 instead of 201).
interface PlantUploadResponse {
  plant: { id: string };
}
interface ObservationUploadResponse {
  observation: { id: string };
}

// IDs of records currently uploading. Stops "Sync now" and "Retry" from uploading
// the same record twice at the same time. (The server would not create a duplicate
// anyway, thanks to client_record_id, but it saves needless requests.)
const uploadsInProgress = new Set<string>();

// The visit added on submit to a record that has none, so the officer has something
// to review. Only real data from the record goes in: health and stage are left out
// because registering a plant doesn't record them.
function buildRegistrationVisit(record: PlantRecord): ObservationVisit {
  // Old records (before store v7) only have the "2 Nov" display date. Then observedAt
  // is left out and the server uses the upload time instead.
  const created = record.createdAtIso ? new Date(record.createdAtIso) : null;
  const me = useProfileStore.getState().me;
  return {
    id: randomUUID(),
    // Same display format as add-observation.tsx.
    date: created
      ? `${created.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${created.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
      : record.createdAt,
    observedAt: record.createdAtIso,
    // Same fallback as add-observation.tsx. Display only: the server records the
    // signed-in user itself.
    recordedBy: me?.full_name || me?.email || 'Field Staff',
    // The height entered when registering, in the same "0.4 m" form as other visits.
    measurement: record.height ? `${record.height} m` : 'Not recorded',
    notes: record.description?.trim() || 'Registration visit (added on submit).',
    syncStatus: SyncStatus.NOT_UPLOADED,
  };
}

interface RecordState {
  records: PlantRecord[];
  routes: RecordedRoute[];
  activeDraftRoute: RecordedRoute | null;
  addRecord: (
    record: Omit<
      PlantRecord,
      'id' | 'tagCode' | 'createdAt' | 'createdAtIso' | 'observations' | 'reviewStatus' | 'reviewComment'
    >
  ) => PlantRecord;
  updateRecord: (
    id: string,
    updates: Pick<
      PlantRecord,
      | 'scientificName'
      | 'speciesId'
      | 'commonName'
      | 'family'
      | 'height'
      | 'morphology'
      | 'description'
      | 'locationName'
      | 'latitude'
      | 'longitude'
      | 'gpsAccuracyM'
      | 'gpsCoordination'
      | 'photoUris'
      | 'photoMeta'
      | 'recordStatus'
      | 'identificationStatus'
      | 'syncStatus'
    >
  ) => PlantRecord | null;
  // observedAt is required for new visits (it's only optional on the type for old ones).
  addObservation: (
    plantRecordId: string,
    observation: Omit<ObservationVisit, 'id' | 'syncStatus' | 'observedAt'> & { observedAt: string }
  ) => void;
  syncRecord: (id: string) => Promise<SyncResult>;
  // Deletes a photo that hasn't been uploaded (e.g. over 5 MB) so the rest can go up.
  // obsId = a visit photo; otherwise a record photo.
  removePhoto: (recordId: string, uri: string, obsId?: string) => void;
  syncAll: () => Promise<SyncAllResult>;
  submitForReview: (id: string) => Promise<SubmitResult>;
  findByTag: (tagCode: string) => PlantRecord | undefined;
  attachTag: (recordId: string, tagCode: string) => { ok: true } | { ok: false; reason: string };
  saveRoute: (route: Omit<RecordedRoute, 'id' | 'createdAt'>) => RecordedRoute;
  clearActiveDraftRoute: () => void;
  clearAllData: () => void;
}

export const useRecordStore = create<RecordState>()(
  persist(
    (set, get) => ({
      records: [],
      routes: [],
      activeDraftRoute: null,
      addRecord: (recordData) => {
        const now = new Date();
        const newRecord: PlantRecord = {
          ...recordData,
          id: randomUUID(),
          tagCode: null, // set later from a pre-printed tag
          reviewStatus: ReviewStatus.DRAFT,
          reviewComment: null,
          createdAt: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          createdAtIso: now.toISOString(), // same moment, machine-readable
          observations: [],
        };
        set((state) => ({ records: [newRecord, ...state.records] }));
        return newRecord;
      },
      updateRecord: (id, updates) => {
        const current = get().records.find((record) => record.id === id);
        if (!current) return null;
        if (current.reviewStatus !== ReviewStatus.DRAFT && current.reviewStatus !== ReviewStatus.REJECTED) {
          return null;
        }

        const updated = { ...current, ...updates };
        set((state) => ({
          records: state.records.map((record) => (record.id === id ? updated : record)),
        }));
        return updated;
      },
      addObservation: (plantRecordId, observationData) => {
        set((state) => ({
          records: state.records.map((r) => {
            if (r.id === plantRecordId) {
              const newObs: ObservationVisit = {
                ...observationData,
                // A real UUID: the backend rejects anything else as client_record_id.
                id: randomUUID(),
                syncStatus: SyncStatus.NOT_UPLOADED,
              };
              return {
                ...r,
                observations: [newObs, ...r.observations],
                // A record that was fully uploaded now has a visit the server hasn't
                // seen, so it needs uploading again (syncRecord skips UPLOADED records).
                syncStatus: r.syncStatus === SyncStatus.UPLOADED ? SyncStatus.NOT_UPLOADED : r.syncStatus,
              };
            }
            return r;
          }),
        }));
      },

      // Uploads one record (the plant, then its visits) to the backend.
      // This is the ONLY place that may mark a record UPLOADED: it happens only after
      // the server has confirmed every part. It never throws; the screen gets a
      // SyncResult it can show in a message.
      syncRecord: async (id) => {
        const record = get().records.find((r) => r.id === id);
        if (!record) return { ok: false, reason: 'Record not found' };
        // Drafts without a confirmed species stay on the phone: the backend rejects a
        // plant without an approved species. They upload once the draft is completed.
        if (!isUploadable(record)) {
          return { ok: false, reason: 'Confirm an approved species and complete this draft before uploading it.' };
        }
        if (record.syncStatus === SyncStatus.UPLOADED) {
          return { ok: true, submittedForReview: isFullySubmitted(record) }; // nothing new to send
        }
        if (uploadsInProgress.has(id)) return { ok: false, reason: 'This record is already uploading' };

        // Small helpers that change just this record (or one of its visits) in the store.
        // They always start from the latest state, because uploads take time and the
        // user may have changed something meanwhile.
        const patchRecord = (changes: Partial<PlantRecord>) =>
          set((state) => ({
            records: state.records.map((r) => (r.id === id ? { ...r, ...changes } : r)),
          }));
        const updateObservation = (obsId: string, changes: Partial<ObservationVisit>) =>
          set((state) => ({
            records: state.records.map((r) =>
              r.id === id
                ? { ...r, observations: r.observations.map((o) => (o.id === obsId ? { ...o, ...changes } : o)) }
                : r
            ),
          }));

        // Photos sent in this run, and photos that can't be sent (shown on plant detail).
        let photosUploaded = 0;
        let tooLarge = 0;

        // Uploads one photo unless it's already up or can't go. Saves the result at once,
        // so a later failure never resends it. Network and server errors throw (the
        // record is then marked FAILED and Retry tries again).
        const sendPhoto = async (
          uri: string,
          meta: PhotoUpload,
          path: string,
          fields: Record<string, string>,
          save: (meta: PhotoUpload) => void
        ) => {
          if (meta.uploaded || meta.problem === 'locked') return;
          const read = photoFileFor(uri);
          if ('problem' in read) {
            save({ ...meta, problem: read.problem });
            if (read.problem === 'too_large') tooLarge += 1;
            return;
          }
          try {
            await apiUpload(path, { ...fields, client_photo_id: meta.id }, read.file);
            save({ ...meta, uploaded: true, problem: undefined });
            photosUploaded += 1;
          } catch (error) {
            if (error instanceof ApiError && error.code === 'photos_locked') {
              // Submitted already: keep it on the phone, don't retry forever.
              save({ ...meta, problem: 'locked' });
              return;
            }
            if (error instanceof ApiError && error.status === 413) {
              save({ ...meta, problem: 'too_large' });
              tooLarge += 1;
              return;
            }
            throw error;
          }
        };

        uploadsInProgress.add(id);
        try {
          // 1. The plant. Skipped if an earlier attempt already got it onto the server.
          let serverId = record.serverId;
          if (!serverId) {
            const response = await apiFetch<PlantUploadResponse>('/api/plants', {
              method: 'POST',
              body: mapLocalRecordToBackend(record),
            });
            serverId = response.plant.id;
            // Save it straight away. If a visit fails below, the next retry sees serverId
            // and only re-sends the visits instead of the plant.
            patchRecord({ serverId });
          }

          // 1b. The record's photos (needs the plant's serverId). Photos from records saved
          //     before photo upload have no slot type, so they stay on the phone.
          const withPhotos = get().records.find((r) => r.id === id);
          for (const uri of withPhotos?.photoUris ?? []) {
            const meta = withPhotos?.photoMeta?.[uri];
            if (!meta?.type) continue;
            await sendPhoto(uri, meta, `/api/plants/${serverId}/photo`, { photo_type: meta.type }, (next) =>
              set((state) => ({
                records: state.records.map((r) =>
                  r.id === id ? { ...r, photoMeta: { ...r.photoMeta, [uri]: next } } : r
                ),
              }))
            );
          }

          // 2. The visits, one at a time, oldest first so they arrive in the order they
          //    happened (the list is stored newest first). Read them fresh from the store
          //    in case one was added while the plant was uploading.
          const latest = get().records.find((r) => r.id === id);
          const visitsToSend = [...(latest?.observations ?? [])]
            .reverse()
            .filter((obs) => obs.syncStatus !== SyncStatus.UPLOADED);

          for (const obs of visitsToSend) {
            const response = await apiFetch<ObservationUploadResponse>('/api/observations', {
              method: 'POST',
              body: mapLocalObservationToBackend(serverId, obs),
            });
            // Mark each visit as soon as the server confirms it, so a later failure
            // doesn't make us send this one again.
            updateObservation(obs.id, { syncStatus: SyncStatus.UPLOADED, serverId: response.observation.id });
          }

          // 2b. Visit photos, for every uploaded visit (needs its serverId). Sent BEFORE the
          //     visit is submitted: the server refuses photos on submitted visits.
          const withVisits = get().records.find((r) => r.id === id);
          for (const obs of [...(withVisits?.observations ?? [])].reverse()) {
            if (!obs.serverId || !obs.photoUris?.length) continue;
            for (const uri of obs.photoUris) {
              // Visit photos need no type, so older ones get their upload ID here. It is
              // saved before the upload, so a retry reuses it.
              // Merge into the CURRENT stored state (not the `obs` snapshot), so earlier
              // photos' upload results in this loop aren't overwritten.
              const saveVisitPhoto = (next: PhotoUpload) =>
                set((state) => ({
                  records: state.records.map((r) =>
                    r.id === id
                      ? {
                          ...r,
                          observations: r.observations.map((o) =>
                            o.id === obs.id ? { ...o, photoMeta: { ...o.photoMeta, [uri]: next } } : o
                          ),
                        }
                      : r
                  ),
                }));
              let meta = obs.photoMeta?.[uri];
              if (!meta) {
                meta = { id: randomUUID(), uploaded: false };
                saveVisitPhoto(meta);
              }
              await sendPhoto(uri, meta, `/api/observations/${obs.serverId}/photo`, {}, saveVisitPhoto);
            }
          }

          // 2c. Photos over 5 MB block submission (an officer shouldn't review a visit
          //     without its evidence). Everything else is already up; the botanist removes
          //     those photos on plant detail and taps Retry.
          if (tooLarge > 0) {
            throw new PhotoProblemError(
              `${tooLarge} ${tooLarge === 1 ? 'photo is' : 'photos are'} over 5 MB and can't be uploaded. ` +
                'Remove them on the plant page, then tap Retry.'
            );
          }

          // 3. Submit for officer review, if the botanist has submitted this record on the
          //    phone. This happens here rather than in submitForReview so that a submit
          //    whose upload failed (no signal) still reaches the officer queue later, the
          //    next time Retry or "Sync now" runs. The server reviews visits, not plants,
          //    so each uploaded visit that isn't submitted yet is sent on its own.
          const afterUpload = get().records.find((r) => r.id === id);
          if (afterUpload?.reviewStatus === ReviewStatus.PENDING) {
            const visitsToSubmit = [...afterUpload.observations]
              .reverse() // oldest first, like the uploads
              .filter((obs) => obs.serverId && !obs.submittedForReview);

            for (const obs of visitsToSubmit) {
              // The server answers 200 both when it submits the visit and when the visit
              // was already pending (e.g. an earlier attempt got through but the phone lost
              // the reply), so a repeat is safe. Any other answer throws an ApiError, and
              // the record is marked FAILED below like any other upload problem.
              await apiFetch(`/api/observations/${obs.serverId}/submit`, { method: 'PATCH' });
              // Remember it straight away, so a later failure doesn't send this one again.
              updateObservation(obs.id, { submittedForReview: true });
            }
          }

          // 4. Mark the record UPLOADED, but only if nothing new appeared meanwhile. A visit
          //    added while we were uploading wasn't in visitsToSend; leaving the record
          //    NOT_UPLOADED means the next sync picks it up (and submits it) instead of
          //    skipping it forever.
          const finalRecord = get().records.find((r) => r.id === id);
          const unsentLeft = finalRecord?.observations.some((obs) => obs.syncStatus !== SyncStatus.UPLOADED);
          patchRecord({ syncStatus: unsentLeft ? SyncStatus.NOT_UPLOADED : SyncStatus.UPLOADED });
          return {
            ok: true,
            submittedForReview: isFullySubmitted(finalRecord),
            photosUploaded,
            photoProblems: tooLarge,
          };
        } catch (error) {
          // Whatever went wrong, the record stays on the phone and shows Retry.
          patchRecord({ syncStatus: SyncStatus.FAILED });

          if (error instanceof ApiError || error instanceof PhotoProblemError) {
            // apiFetch already wrote a readable message: "Could not reach the server..."
            // when status is 0 (no signal, timeout), otherwise the server's own message,
            // e.g. "Valid latitude and longitude are required".
            return { ok: false, reason: error.message, photosUploaded, photoProblems: tooLarge };
          }
          // Not an ApiError (e.g. an unexpected response shape): still don't crash the screen.
          return { ok: false, reason: 'Upload failed unexpectedly. Please try again.', photosUploaded, photoProblems: tooLarge };
        } finally {
          uploadsInProgress.delete(id);
        }
      },

      removePhoto: (recordId, uri, obsId) => {
        const record = get().records.find((r) => r.id === recordId);
        if (!record) return;
        const owner = obsId ? record.observations.find((o) => o.id === obsId) : record;
        // Never delete a photo the server already has: it belongs to the record now.
        if (!owner || owner.photoMeta?.[uri]?.uploaded) return;

        const without = (meta: Record<string, PhotoUpload> | undefined) => {
          if (!meta) return meta;
          const { [uri]: _removed, ...rest } = meta;
          return rest;
        };
        set((state) => ({
          records: state.records.map((r) => {
            if (r.id !== recordId) return r;
            if (!obsId) {
              return { ...r, photoUris: r.photoUris.filter((u) => u !== uri), photoMeta: without(r.photoMeta) };
            }
            return {
              ...r,
              observations: r.observations.map((o) =>
                o.id === obsId
                  ? { ...o, photoUris: (o.photoUris ?? []).filter((u) => u !== uri), photoMeta: without(o.photoMeta) }
                  : o
              ),
            };
          }),
        }));
        deleteStoredPhoto(uri);
      },

      // Uploads every record that isn't fully on the server yet (Not uploaded AND
      // Upload failed, so "Sync now" also retries failures). One record at a time, so
      // a weak field connection isn't flooded with parallel requests. Like syncRecord,
      // it never throws: a failed record just counts as failed and the loop moves on.
      syncAll: async () => {
        // Take the list of IDs up front. Records added while this runs wait for the
        // next sync, so the loop always ends.
        // Unfinished drafts (Local only) are left out: they aren't failures, they just
        // can't be uploaded until the botanist confirms a species.
        const ids = get()
          .records.filter((r) => r.syncStatus !== SyncStatus.UPLOADED && isUploadable(r))
          .map((r) => r.id);

        let uploaded = 0;
        let failed = 0;
        let skipped = 0;
        let photosUploaded = 0;
        let photoProblems = 0;
        for (const id of ids) {
          // Already uploading (from Retry or a submit)? That upload will finish on its
          // own, so don't count it as a failure. Checking here is safe: syncRecord adds
          // the ID to uploadsInProgress before its first await, so nothing can slip in
          // between this check and the call.
          if (uploadsInProgress.has(id)) {
            skipped += 1;
            continue;
          }
          const result = await get().syncRecord(id);
          if (result.ok) uploaded += 1;
          else failed += 1;
          photosUploaded += result.photosUploaded ?? 0;
          photoProblems += result.photoProblems ?? 0;
        }
        return { uploaded, failed, skipped, photosUploaded, photoProblems };
      },

      submitForReview: async (id) => {
        const record = get().records.find((r) => r.id === id);
        if (!record) return { ok: false, reason: 'Record not found' };
        if (record.reviewStatus !== ReviewStatus.DRAFT && record.reviewStatus !== ReviewStatus.REJECTED) {
          return { ok: false, reason: 'This record has already been submitted' };
        }
        if (!isUploadable(record)) {
          return { ok: false, reason: 'Confirm an approved species and complete this draft before submitting it.' };
        }
        // The backend reviews visits, not plants, so a record with no visits would give
        // the officer nothing to review. Add a registration visit built from the record.
        const registrationVisit = record.observations.length === 0 ? buildRegistrationVisit(record) : null;

        // The submission has to reach the server, so it also needs uploading again.
        set((state) => ({
          records: state.records.map((r) =>
            r.id === id
              ? {
                  ...r,
                  reviewStatus: ReviewStatus.PENDING,
                  syncStatus: SyncStatus.NOT_UPLOADED,
                  observations: registrationVisit ? [registrationVisit] : r.observations,
                }
              : r
          ),
        }));
        // Upload straight away. The record is already pending on the phone, so if the
        // upload fails (e.g. no signal in the field) the submission is kept and goes up
        // later with "Sync now" or Retry; syncRecord marks it FAILED and never throws.
        const sync = await get().syncRecord(id);
        return { ok: true, sync };
      },

      findByTag: (tagCode) => get().records.find((r) => r.tagCode === tagCode),
      attachTag: (recordId, tagCode) => {
        // 1. Is this tag already on ANOTHER record?
        const existing = get().findByTag(tagCode);
        if (existing && existing.id !== recordId ) {
          return {
            ok: false,
            reason: `This tag is already attached to ${existing.scientificName || 'an identification-pending record'}`,
          };
        } 

        // 2. Update only the record with this recordId (same map-and-replace pattern as the other actions)
        set((state) => ({
          records: state.records.map((r) => (r.id === recordId ? { ...r, tagCode: tagCode } : r)),
        }));

        // 3. Tell the screen it worked
        return { ok: true };
      },      
      saveRoute: (routeData) => {
        const route: RecordedRoute = {
          ...routeData,
          id: `route-${Date.now()}`,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          routes: [route, ...state.routes],
          activeDraftRoute: route,
        }));
        return route;
      },
      clearActiveDraftRoute: () => set({ activeDraftRoute: null }),
      clearAllData: () => set({ records: [], routes: [], activeDraftRoute: null }),
    }),
    {
      name: 'niah-ground-truth-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 9,
      migrate: (persistedState, version) => {
        const state = persistedState as { records?: Record<string, unknown>[] };
        if (version < 1 && Array.isArray(state.records)) {
          // v0 records carried a random "NP-2026-xxxx" recordId that was never on a
          // physical tag. Drop it; those records simply have no tag attached.
          state.records = state.records.map(({ recordId: _discarded, ...record }) => ({ ...record, tagCode: null }));
        }
        if (version < 2 && Array.isArray(state.records)) {
          // Before v2 a fake "Sync" button marked records (and observations) as Synced
          // without uploading anything. Nothing has ever reached a server, so every
          // record goes back to Pending.
          state.records = state.records.map((record) => ({
            ...record,
            status: SyncStatus.NOT_UPLOADED,
            observations: Array.isArray(record.observations)
              ? record.observations.map((obs: Record<string, unknown>) => ({ ...obs, status: SyncStatus.NOT_UPLOADED }))
              : [],
          }));
        }

          if (version < 3 && Array.isArray(state.records)) {
          // v3: "status" (Synced/Pending/Failed) became "syncStatus", so the phone's
          // upload state isn't confused with the officer's review status.
          const toSync = (old: unknown) =>
            old === 'Synced' || old === 'Uploaded'
              ? SyncStatus.UPLOADED
              : old === 'Failed' || old === 'Upload failed'
                ? SyncStatus.FAILED
                : SyncStatus.NOT_UPLOADED;
          state.records = state.records.map(({ status, ...record }) => ({
            ...record,
            syncStatus: toSync(status),
            observations: Array.isArray(record.observations)
              ? record.observations.map(({ status: obsStatus, ...obs }: Record<string, unknown>) => ({
                  ...obs,
                  syncStatus: toSync(obsStatus),
                }))
              : [],
          }));
        }

        if (version < 4 && Array.isArray(state.records)) {
          // v4: records get a review status. Nothing has been submitted yet,
          // so every existing record starts as a draft.
          state.records = state.records.map((record) => ({
            ...record,
            reviewStatus: ReviewStatus.DRAFT,
            reviewComment: null,
          }));
        }

                if (version < 5 && Array.isArray(state.records)) {
          // v5: records link to a species by ID. Older records only have a name.
          state.records = state.records.map((record) => ({ ...record, speciesId: null }));
        }

        if (version < 6 && Array.isArray(state.records)) {
          // v6: observation IDs must be UUIDs, because the backend uses them as
          // client_record_id and rejects anything else. Visits saved before v6 had
          // IDs like "obs-1761118500000", so each of those gets a fresh UUID.
          // (These old visits also have no observedAt, only the display "date"
          // text, so they upload without observed_at and the server uses the
          // upload time instead.)
          state.records = state.records.map((record) => ({
            ...record,
            observations: Array.isArray(record.observations)
              ? record.observations.map((obs: Record<string, unknown>) =>
                  typeof obs.id === 'string' && obs.id.startsWith('obs-') ? { ...obs, id: randomUUID() } : obs
                )
              : [],
          }));
        }

        // v7: new records get createdAtIso. Nothing to convert: older records only have
        // the "2 Nov" display date, which has no year or time to rebuild it from, so they
        // simply go without it.

        if (version < 8 && Array.isArray(state.records)) {
          // v8: syncRecord now also submits visits for review. A record submitted before
          // this could already be marked Uploaded without its visits ever reaching the
          // officer queue, and syncRecord skips Uploaded records. Mark those as Not
          // uploaded so the next sync submits them (the plant and visits aren't sent again).
          state.records = state.records.map((record) =>
            record.reviewStatus === ReviewStatus.PENDING && record.syncStatus === SyncStatus.UPLOADED
              ? { ...record, syncStatus: SyncStatus.NOT_UPLOADED }
              : record
          );
        }

        if (version < 9 && Array.isArray(state.records)) {
          // v9 (was "v6" on main): separates record completeness, identification and
          // upload state. Main and this branch both used the number 6 for different
          // migrations, so this one moved to 9. A phone that already ran main's v6 has
          // these fields, and they are kept as they are; only records without them are
          // filled in. Existing named records remain complete even if they predate
          // species IDs.
          state.records = state.records.map((record) => {
            if (record.recordStatus !== undefined && record.identificationStatus !== undefined) return record;
            const hasName = typeof record.scientificName === 'string' && record.scientificName.trim() !== '';
            return {
              ...record,
              recordStatus: hasName ? RecordStatus.COMPLETE : RecordStatus.DRAFT,
              identificationStatus: hasName
                ? IdentificationStatus.IDENTIFIED
                : IdentificationStatus.PENDING,
              syncStatus: hasName ? record.syncStatus : SyncStatus.LOCAL_ONLY,
            };
          });
        }

        return state as unknown as RecordState;
      },
    }
  )
);
