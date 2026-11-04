import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  Image,
  ActivityIndicator,
} from 'react-native';

import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import type * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { randomUUID } from 'expo-crypto';

import { useStaffOnly } from '../src/context/AuthRoleContext';

import {
  pickImageFromLibrary,
  takePhotoWithCamera,
  type PickImageResult,
} from '../src/utils/imagePicker';

import {
  savePhotoPermanently,
  deleteStoredPhoto,
} from '../src/utils/photoStorage';

import {
  IdentificationStatus,
  RecordStatus,
  SyncStatus,
  useRecordStore,
  type PlantPhotoType,
  type PlantRecord,
  type PhotoUpload,
} from '../src/store/useRecordStore';

import { useSpeciesStore } from '../src/store/useSpeciesStore';

import SpeciesPicker, {
  type SpeciesChoice,
} from '../src/components/SpeciesPicker';

import {
  identifyPlant,
  IdentifyNetworkError,
  type SpeciesSuggestion,
} from '../src/services/identifyPlant';

import {
  formatCoordinates,
  describeAccuracy,
} from '../src/utils/formatCoordinates';

import {
  conservationStatusCode,
  conservationStatusLabel,
} from '../src/utils/conservationStatus';

import FormScrollView from '../src/components/FormScrollView';
import KeyboardDoneBar from '../src/components/KeyboardDoneBar';

const DONE_BAR_ID = 'new-record-done';

const PHOTO_SLOTS = [
  'Whole plant',
  'Leaf',
  'Flower',
  'Bark',
] as const;

type PhotoSlot =
  (typeof PHOTO_SLOTS)[number];

type SlotPhotos = Record<
  PhotoSlot,
  ImagePicker.ImagePickerAsset | null
>;

const SLOT_TYPE: Record<
  PhotoSlot,
  PlantPhotoType
> = {
  'Whole plant': 'whole_plant',
  Leaf: 'leaf',
  Flower: 'flower',
  Bark: 'bark',
};

/*
 * This local type matches the photoEntries structure used by
 * our SQLite/offline-sync implementation.
 *
 * Keeping it here temporarily also lets this screen coexist
 * with main while useRecordStore.ts is still being merged.
 */
interface OfflinePlantPhotoEntry {
  id: string;
  uri: string;
  photoType: PlantPhotoType;
  syncStatus: SyncStatus;
  serverId?: string;
  lastError?: string;
}

type PlantRecordWithOfflinePhotos =
  PlantRecord & {
    photoEntries?: OfflinePlantPhotoEntry[];
  };

/*
 * Restore an existing record's photos into the correct slots.
 *
 * Priority:
 * 1. Our offline photoEntries
 * 2. main's photoMeta
 * 3. legacy photoUris order
 */
function initialSlotPhotos(
  record: PlantRecord | undefined
): SlotPhotos {
  const slots: SlotPhotos = {
    'Whole plant': null,
    Leaf: null,
    Flower: null,
    Bark: null,
  };

  const asset = (
    uri: string
  ): ImagePicker.ImagePickerAsset =>
    ({
      uri,
      width: 0,
      height: 0,
    }) as ImagePicker.ImagePickerAsset;

  if (!record) {
    return slots;
  }

  const offlineRecord =
    record as PlantRecordWithOfflinePhotos;

  /*
   * First: offline photoEntries.
   */
  for (
    const photo of
    offlineRecord.photoEntries ?? []
  ) {
    const slot =
      PHOTO_SLOTS.find(
        (candidate) =>
          SLOT_TYPE[candidate] ===
          photo.photoType
      );

    if (
      slot &&
      !slots[slot]
    ) {
      slots[slot] =
        asset(photo.uri);
    }
  }

  /*
   * Second: main photoMeta.
   */
  const uris =
    record.photoUris ?? [];

  if (record.photoMeta) {
    for (const uri of uris) {
      const photoType: PlantPhotoType | undefined =
        record.photoMeta[
          uri
        ]?.type;

            if (!photoType) {
              continue;
            }

      const slot =
        PHOTO_SLOTS.find(
          (candidate) =>
            SLOT_TYPE[candidate] ===
            photoType 
        );

      if (
        slot &&
        !slots[slot]
      ) {
        slots[slot] =
          asset(uri);
      }
    }
  }

  /*
   * Third: old records where we only know array order.
   */
  uris.forEach(
    (uri, index) => {
      if (
        index >=
        PHOTO_SLOTS.length
      ) {
        return;
      }

      const slot =
        PHOTO_SLOTS[index];

      if (!slots[slot]) {
        slots[slot] =
          asset(uri);
      }
    }
  );

  return slots;
}

interface GpsFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
}

type GpsStatus =
  | 'acquiring'
  | 'ready'
  | 'unavailable'
  | 'timeout';

const GPS_TIMEOUT_MS =
  20_000;

class GpsTimeoutError extends Error {}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T> {
  return new Promise<T>(
    (resolve, reject) => {
      const timer =
        setTimeout(
          () =>
            reject(
              new GpsTimeoutError()
            ),
          ms
        );

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    }
  );
}

type FieldErrors =
  Partial<
    Record<
      | 'photos'
      | 'scientificName'
      | 'locationName'
      | 'gps',
      string
    >
  >;

export default function NewRecordScreen() {
  const router =
    useRouter();

  /*
   * Botanist-only screen.
   */
  const blocked =
    useStaffOnly();

  const { editId } =
    useLocalSearchParams<{
      editId?: string;
    }>();

  const existingRecord =
    useRecordStore(
      (state) =>
        editId
          ? state.records.find(
              (record) =>
                record.id ===
                editId
            )
          : undefined
    );

  const addRecord =
    useRecordStore(
      (state) =>
        state.addRecord
    );

  const updateRecord =
    useRecordStore(
      (state) =>
        state.updateRecord
    );

  const syncRecord =
    useRecordStore(
      (state) =>
        state.syncRecord
    );

  const isEditing =
    Boolean(
      existingRecord
    );

  const [
    photos,
    setPhotos,
  ] = useState<SlotPhotos>(
    () =>
      initialSlotPhotos(
        existingRecord
      )
  );

  const [
    speciesChoice,
    setSpeciesChoice,
  ] =
    useState<SpeciesChoice>(
      null
    );

  const [
    speciesQuery,
    setSpeciesQuery,
  ] = useState(
    existingRecord
      ?.scientificName ??
      ''
  );

  const [
    speciesNotice,
    setSpeciesNotice,
  ] = useState('');

  const allSpecies =
    useSpeciesStore(
      (state) =>
        state.species
    );

  const [
    height,
    setHeight,
  ] = useState(
    existingRecord?.height ??
      ''
  );

  const [
    morphology,
    setMorphology,
  ] = useState(
    existingRecord
      ?.morphology ??
      ''
  );

  const [
    locationName,
    setLocationName,
  ] = useState(
    existingRecord
      ?.locationName ??
      ''
  );

  const [
    gpsFix,
    setGpsFix,
  ] =
    useState<GpsFix | null>(
      existingRecord
        ?.latitude !==
        undefined &&
        existingRecord
          ?.longitude !==
          undefined
        ? {
            latitude:
              existingRecord.latitude,

            longitude:
              existingRecord.longitude,

            accuracyM:
              existingRecord
                .gpsAccuracyM ??
              null,
          }
        : null
    );

  const [
    gpsStatus,
    setGpsStatus,
  ] =
    useState<GpsStatus>(
      existingRecord
        ?.latitude !==
        undefined &&
        existingRecord
          ?.longitude !==
          undefined
        ? 'ready'
        : 'acquiring'
    );

  const [
    gpsError,
    setGpsError,
  ] = useState('');

  const screenActive =
    useRef(true);

  const gpsRequestId =
    useRef(0);

  const [
    errors,
    setErrors,
  ] =
    useState<FieldErrors>(
      {}
    );

  const clearError = (
    field:
      keyof FieldErrors
  ) => {
    setErrors(
      (previous) =>
        previous[field]
          ? {
              ...previous,
              [field]:
                undefined,
            }
          : previous
    );
  };

  const identifyRequest =
    useRef<AbortController | null>(
      null
    );

  const [
    suggestions,
    setSuggestions,
  ] =
    useState<
      SpeciesSuggestion[]
    >([]);

  const [
    selectedSpecies,
    setSelectedSpecies,
  ] =
    useState<SpeciesSuggestion | null>(
      null
    );

  const [
    identifying,
    setIdentifying,
  ] = useState(false);

  const [
    identifyMessage,
    setIdentifyMessage,
  ] = useState('');

  /*
   * AI uses the first available plant photo.
   */
  const identifySlot =
    PHOTO_SLOTS.find(
      (slot) =>
        photos[slot] !==
        null
    );

  const identifyPhoto =
    identifySlot
      ? photos[
          identifySlot
        ]
      : null;

  /*
   * Photos are copied into permanent storage as soon
   * as they are selected.
   */
  const photosRef =
    useRef(photos);

  photosRef.current =
    photos;

  const recordSaved =
    useRef(false);

  const originalPhotoUris =
    useRef(
      new Set(
        existingRecord
          ?.photoUris ??
          []
      )
    );

  /*
   * When editing an existing record,
   * recover its approved species choice.
   */
  useEffect(() => {
    if (
      !existingRecord ||
      speciesChoice
    ) {
      return;
    }

    const match =
      allSpecies.find(
        (species) =>
          species.id ===
            existingRecord.speciesId ||
          species.scientific_name
            .trim()
            .toLowerCase() ===
            existingRecord
              .scientificName
              .trim()
              .toLowerCase()
      );

    if (match) {
      setSpeciesChoice({
        kind: 'species',
        species: match,
      });
    }
  }, [
    allSpecies,
    existingRecord,
    speciesChoice,
  ]);

  /*
   * GPS + cleanup.
   */
  useEffect(() => {
    screenActive.current =
      true;

    if (!gpsFix) {
      void fetchLocation();
    }

    return () => {
      screenActive.current =
        false;

      identifyRequest.current
        ?.abort();

      identifyRequest.current =
        null;

      /*
       * If user leaves without saving,
       * delete permanent photo copies created
       * while using this form.
       */
      if (
        !recordSaved.current
      ) {
        PHOTO_SLOTS.forEach(
          (slot) => {
            const uri =
              photosRef
                .current[
                  slot
                ]?.uri;

            if (
              uri &&
              !originalPhotoUris.current.has(
                uri
              )
            ) {
              void deleteStoredPhoto(
                uri
              );
            }
          }
        );
      }
    };
  }, []);

  const fetchLocation =
    async () => {
      const requestId =
        ++gpsRequestId.current;

      const isCurrent =
        () =>
          screenActive.current &&
          requestId ===
            gpsRequestId.current;

      const markUnavailable =
        (
          reason: string
        ) => {
          if (
            !isCurrent()
          ) {
            return;
          }

          setGpsFix(null);

          setGpsError(
            reason
          );

          setGpsStatus(
            'unavailable'
          );
        };

      setGpsStatus(
        'acquiring'
      );

      setGpsError('');

      try {
        const {
          status,
        } =
          await Location.requestForegroundPermissionsAsync();

        if (
          status !==
          'granted'
        ) {
          markUnavailable(
            'Location permission is off for this app.'
          );

          return;
        }

        const enabled =
          await Location.hasServicesEnabledAsync();

        if (!enabled) {
          markUnavailable(
            'Location services are turned off on this device.'
          );

          return;
        }

        const location =
          await withTimeout(
            Location.getCurrentPositionAsync(
              {
                accuracy:
                  Location
                    .Accuracy
                    .High,
              }
            ),

            GPS_TIMEOUT_MS
          );

        if (
          !isCurrent()
        ) {
          return;
        }

        setGpsFix({
          latitude:
            location.coords
              .latitude,

          longitude:
            location.coords
              .longitude,

          accuracyM:
            location.coords
              .accuracy ??
            null,
        });

        setGpsStatus(
          'ready'
        );

        clearError(
          'gps'
        );
      } catch (error) {
        if (
          error instanceof
          GpsTimeoutError
        ) {
          if (
            !isCurrent()
          ) {
            return;
          }

          setGpsFix(null);

          setGpsError('');

          setGpsStatus(
            'timeout'
          );

          return;
        }

        markUnavailable(
          'Could not get a GPS fix.'
        );
      }
    };

  /*
   * Remove the species automatically selected by
   * an old AI suggestion when its photo changes.
   */
  const clearSuggestionFields =
    () => {
      if (
        !selectedSpecies
      ) {
        return;
      }

      const name =
        selectedSpecies
          .scientificName;

      setSpeciesChoice(
        (choice) =>
          choice?.kind ===
            'species' &&
          choice.species
            .scientific_name ===
            name
            ? null
            : choice
      );

      setSpeciesNotice('');
    };

  /*
   * Replacing/removing a photo invalidates
   * previous AI suggestions.
   */
  const setSlotPhoto = (
    slot: PhotoSlot,
    asset:
      | ImagePicker.ImagePickerAsset
      | null
  ) => {
    identifyRequest.current
      ?.abort();

    identifyRequest.current =
      null;

    clearSuggestionFields();

    const previous =
      photosRef.current[
        slot
      ];

    if (
      previous &&
      previous.uri !==
        asset?.uri &&
      !originalPhotoUris.current.has(
        previous.uri
      )
    ) {
      void deleteStoredPhoto(
        previous.uri
      );
    }

    setPhotos(
      (previousPhotos) => ({
        ...previousPhotos,
        [slot]: asset,
      })
    );

    if (asset) {
      clearError(
        'photos'
      );
    }

    setSuggestions([]);

    setSelectedSpecies(
      null
    );

    setIdentifyMessage(
      ''
    );

    setIdentifying(
      false
    );
  };

  const [
    activeSlot,
    setActiveSlot,
  ] =
    useState<PhotoSlot | null>(
      null
    );

  const handlePickResult =
    async (
      slot: PhotoSlot,
      result: PickImageResult
    ) => {
      if (
        result.status ===
        'picked'
      ) {
        let permanentUri:
          string;

        try {
          permanentUri =
            await savePhotoPermanently(
              result.asset.uri
            );
        } catch {
          Toast.show({
            type: 'error',
            text1:
              'Photo not saved',
            text2:
              'The photo could not be stored on this device.',
          });

          return;
        }

        if (
          !screenActive.current
        ) {
          void deleteStoredPhoto(
            permanentUri
          );

          return;
        }

        setSlotPhoto(
          slot,
          {
            ...result.asset,
            uri: permanentUri,
          }
        );

        setActiveSlot(
          null
        );

        return;
      }

      if (
        result.status ===
        'permission-denied'
      ) {
        Toast.show({
          type: 'error',
          text1:
            'Camera permission needed',
          text2:
            'Allow camera access for Expo Go in Settings.',
        });

        return;
      }

      if (
        result.status ===
        'error'
      ) {
        Toast.show({
          type: 'error',
          text1:
            'Could not open',
          text2:
            'The camera or photo library could not be opened.',
        });
      }
    };

  const takePhoto =
    async (
      slot: PhotoSlot
    ) => {
      await handlePickResult(
        slot,
        await takePhotoWithCamera()
      );
    };

  const choosePhoto =
    async (
      slot: PhotoSlot
    ) => {
      await handlePickResult(
        slot,
        await pickImageFromLibrary()
      );
    };

  const removePhoto = (
    slot: PhotoSlot
  ) => {
    setSlotPhoto(
      slot,
      null
    );

    setActiveSlot(
      null
    );
  };

  /*
   * AI identification.
   */
  const handleIdentify =
    async () => {
      if (
        !identifyPhoto ||
        identifying
      ) {
        return;
      }

      const request =
        new AbortController();

      identifyRequest.current =
        request;

      setIdentifying(
        true
      );

      setIdentifyMessage(
        ''
      );

      setSuggestions([]);

      clearSuggestionFields();

      setSelectedSpecies(
        null
      );

      try {
        const nextSuggestions =
          await identifyPlant(
            identifyPhoto,
            request.signal
          );

        if (
          request.signal
            .aborted
        ) {
          return;
        }

        setSuggestions(
          nextSuggestions
        );

        if (
          nextSuggestions.length ===
          0
        ) {
          setIdentifyMessage(
            'No match found. Open the Species Reference to research the plant, or try another photo.'
          );
        }
      } catch (error) {
        if (
          request.signal
            .aborted
        ) {
          return;
        }

        if (
          error instanceof
          IdentifyNetworkError
        ) {
          setIdentifyMessage(
            "Can't reach the AI server. You can still use the cached Species Reference, or try again when connected."
          );
        } else {
          setIdentifyMessage(
            error instanceof
              Error
              ? error.message
              : 'Identification failed. Please try again.'
          );
        }
      } finally {
        if (
          identifyRequest.current ===
          request
        ) {
          identifyRequest.current =
            null;

          setIdentifying(
            false
          );
        }
      }
    };

  /*
   * Select one AI suggestion.
   *
   * AI suggestions only become confirmed if they
   * exactly match an approved species in the
   * Species Reference.
   */
  const selectSuggestion = (
    suggestion:
      SpeciesSuggestion
  ) => {
    clearSuggestionFields();

    setSelectedSpecies(
      suggestion
    );

    const wanted =
      suggestion
        .scientificName
        .trim()
        .toLowerCase();

    const match =
      allSpecies.find(
        (species) =>
          species
            .scientific_name
            .trim()
            .toLowerCase() ===
          wanted
      );

    if (match) {
      setSpeciesChoice({
        kind: 'species',
        species: match,
      });

      setSpeciesNotice(
        ''
      );
    } else {
      setSpeciesChoice(
        null
      );

      setSpeciesQuery(
        suggestion.scientificName
      );

      setSpeciesNotice(
        `"${suggestion.scientificName}" isn't in the approved species list. Search for and select an approved species, or save this record for later.`
      );
    }

    clearError(
      'scientificName'
    );
  };

  const handleSpeciesChange = (
    choice: SpeciesChoice
  ) => {
    if (!choice) {
      setSpeciesQuery('');
    }

    setSpeciesChoice(
      choice
    );

    setSelectedSpecies(
      null
    );

    setSpeciesNotice(
      ''
    );

    clearError(
      'scientificName'
    );
  };

  const handleLocationNameChange =
    (
      value: string
    ) => {
      setLocationName(
        value
      );

      clearError(
        'locationName'
      );
    };

  /*
   * SAVE
   *
   * This keeps BOTH photo structures:
   *
   * photoMeta
   * → teammate/main photo handling
   *
   * photoEntries
   * → our SQLite/offline photo sync
   *
   * Save is local-first.
   */
  const handleSave =
    async () => {
      const identified =
        Boolean(
          speciesChoice
        );

      const offlineRecord =
        existingRecord as
          | PlantRecordWithOfflinePhotos
          | undefined;

      const photoMeta: Record<
        string,
        PhotoUpload
      > = {};

      const photoEntries:
        OfflinePlantPhotoEntry[] =
          [];

      for (
        const slot of
        PHOTO_SLOTS
      ) {
        const asset =
          photos[slot];

        if (!asset) {
          continue;
        }

        const uri =
          asset.uri;

        const photoType =
          SLOT_TYPE[slot];

        const previousEntry =
          offlineRecord
            ?.photoEntries
            ?.find(
              (photo) =>
                photo.uri ===
                  uri &&
                photo.photoType ===
                  photoType
            );

        const previousMeta =
          existingRecord
            ?.photoMeta?.[
              uri
            ];

        /*
         * One stable UUID is shared by both
         * photo metadata systems.
         */
        const photoId =
          previousEntry?.id ??
          previousMeta?.id ??
          randomUUID();

        let photoSyncStatus =
          previousEntry
            ?.syncStatus ??
          (
            previousMeta
              ?.uploaded
              ? SyncStatus.UPLOADED
              : identified
                ? SyncStatus.NOT_UPLOADED
                : SyncStatus.LOCAL_ONLY
          );

        /*
         * When a local draft becomes identified,
         * its photos become uploadable.
         */
        if (
          identified &&
          photoSyncStatus ===
            SyncStatus.LOCAL_ONLY
        ) {
          photoSyncStatus =
            SyncStatus.NOT_UPLOADED;
        }

        photoEntries.push({
          id: photoId,
          uri,
          photoType,
          syncStatus:
            photoSyncStatus,
          serverId:
            previousEntry
              ?.serverId,
          lastError:
            previousEntry
              ?.lastError,
        });

        /*
         * Preserve main's existing photo problem flag.
         */
        photoMeta[uri] = {
          ...(previousMeta &&
          previousMeta.type ===
            photoType
            ? previousMeta
            : {}),

          id: photoId,

          type:
            photoType,

          uploaded:
            photoSyncStatus ===
            SyncStatus.UPLOADED,
        };
      }

      const photoList =
        photoEntries.map(
          (photo) =>
            photo.uri
        );

      const nextErrors:
        FieldErrors = {};

      if (
        photoList.length ===
        0
      ) {
        nextErrors.photos =
          'Add at least one photo.';
      }

      /*
       * Species is NOT mandatory here.
       *
       * Unknown species can be saved as:
       * Draft + Local only.
       */
      if (
        !locationName.trim()
      ) {
        nextErrors.locationName =
          'Enter a location landmark.';
      }

      if (!gpsFix) {
        nextErrors.gps =
          'A GPS fix is required. Wait for it, or tap the GPS card to retry.';
      }

      setErrors(
        nextErrors
      );

      if (
        Object.keys(
          nextErrors
        ).length > 0 ||
        !gpsFix
      ) {
        return;
      }

      const species =
        speciesChoice?.kind ===
        'species'
          ? speciesChoice
              .species
          : null;

      /*
       * Main currently doesn't declare photoEntries yet,
       * so recordData is intentionally inferred here.
       *
       * The merged offline store will consume photoEntries.
       */
      const recordData = {
        scientificName:
          species
            ?.scientific_name ??
          '',

        speciesId:
          species?.id ??
          null,

        commonName:
          species
            ?.common_name ??
          '',

        family:
          species
            ?.taxonomy
            ?.family ??
          '',

        height:
          height.trim() ||
          undefined,

        morphology:
          morphology.trim() ||
          undefined,

        locationName:
          locationName.trim(),

        latitude:
          gpsFix.latitude,

        longitude:
          gpsFix.longitude,

        gpsAccuracyM:
          gpsFix.accuracyM,

        gpsCoordination:
          formatCoordinates(
            gpsFix.latitude,
            gpsFix.longitude,
            gpsFix.accuracyM
          ),

        photoUris:
          photoList,

        /*
         * main photo state
         */
        photoMeta,

        /*
         * our offline-sync photo state
         */
        photoEntries,

        recordStatus:
          identified
            ? RecordStatus.COMPLETE
            : RecordStatus.DRAFT,

        identificationStatus:
          identified
            ? IdentificationStatus.IDENTIFIED
            : IdentificationStatus.PENDING,

        syncStatus:
          identified
            ? SyncStatus.NOT_UPLOADED
            : SyncStatus.LOCAL_ONLY,
      };

      /*
       * await is compatible with both:
       *
       * current main:
       * synchronous add/update
       *
       * merged offline store:
       * Promise-based SQLite persistence
       */
      const saved =
        existingRecord
          ? await updateRecord(
              existingRecord.id,
              recordData
            )
          : await addRecord(
              recordData
            );

      if (!saved) {
        Toast.show({
          type: 'error',
          text1:
            'Record not updated',
          text2:
            'Only local drafts and returned records can be edited.',
        });

        return;
      }

      /*
       * Delete permanent photos removed during editing.
       */
      if (
        existingRecord
      ) {
        originalPhotoUris
          .current
          .forEach(
            (uri) => {
              if (
                !photoList.includes(
                  uri
                )
              ) {
                void deleteStoredPhoto(
                  uri
                );
              }
            }
          );
      }

      /*
       * The record now owns these stored files,
       * so screen cleanup must not delete them.
       */
      recordSaved.current =
        true;

      router.replace({
        pathname:
          '/save-confirm',

        params: {
          id: saved.id,
        },
      } as any);

      /*
       * Identified record:
       *
       * Online
       * → immediate upload attempt.
       *
       * Offline
       * → SQLite/outbox stays pending.
       * → NetInfo auto-sync retries on reconnect.
       *
       * Unidentified draft:
       * → stays Local only.
       */
      if (
        saved.syncStatus ===
        SyncStatus.NOT_UPLOADED
      ) {
        void syncRecord(
          saved.id
        );
      }
    };

  if (blocked) {
    return null;
  }

  return (
    <SafeAreaView
      style={
        styles.safeArea
      }
    >
      <StatusBar
        barStyle="dark-content"
      />

      <View
        style={
          styles.navRow
        }
      >
        <TouchableOpacity
          onPress={() =>
            router.back()
          }
          style={
            styles.navSide
          }
        >
          <Text
            style={
              styles.backChevron
            }
          >
            ‹
          </Text>
        </TouchableOpacity>

        <Text
          style={
            styles.navTitle
          }
        >
          {isEditing
            ? 'Continue Plant Record'
            : 'New Plant Record'}
        </Text>

        <View
          style={
            styles.navSide
          }
        />
      </View>

      <FormScrollView
        contentContainerStyle={
          styles.scrollContent
        }
      >
        <View
          style={
            styles.sectionHeaderRow
          }
        >
          <Text
            style={
              styles.sectionLabel
            }
          >
            PHOTOS *
          </Text>

          <Text
            style={
              styles.sectionSubLabel
            }
          >
            min. 1 required
          </Text>
        </View>

        <View
          style={
            styles.photoGrid
          }
        >
          {PHOTO_SLOTS.map(
            (slot) => {
              const asset =
                photos[slot];

              return (
                <TouchableOpacity
                  key={slot}
                  style={[
                    styles.photoBox,

                    activeSlot ===
                      slot &&
                      styles.photoBoxActive,
                  ]}
                  onPress={() =>
                    setActiveSlot(
                      (
                        current
                      ) =>
                        current ===
                        slot
                          ? null
                          : slot
                    )
                  }
                >
                  {asset ? (
                    <Image
                      source={{
                        uri:
                          asset.uri,
                      }}
                      style={
                        styles.photoThumb
                      }
                    />
                  ) : (
                    <View
                      style={{
                        alignItems:
                          'center',
                      }}
                    >
                      <Text
                        style={{
                          fontSize:
                            24,
                        }}
                      >
                        📷
                      </Text>

                      <Text
                        style={
                          styles.photoSlotText
                        }
                      >
                        {slot}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            }
          )}
        </View>

        {activeSlot && (
          <View
            style={
              styles.sourcePanel
            }
          >
            <Text
              style={
                styles.sourceTitle
              }
            >
              {activeSlot}{' '}
              photo
            </Text>

            <View
              style={
                styles.sourceRow
              }
            >
              <TouchableOpacity
                style={
                  styles.sourceBtn
                }
                activeOpacity={
                  0.85
                }
                onPress={() =>
                  void takePhoto(
                    activeSlot
                  )
                }
              >
                <Text
                  style={
                    styles.sourceBtnText
                  }
                >
                  Take photo
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={
                  styles.sourceBtn
                }
                activeOpacity={
                  0.85
                }
                onPress={() =>
                  void choosePhoto(
                    activeSlot
                  )
                }
              >
                <Text
                  style={
                    styles.sourceBtnText
                  }
                >
                  Choose from
                  gallery
                </Text>
              </TouchableOpacity>
            </View>

            <View
              style={
                styles.sourceRow
              }
            >
              {photos[
                activeSlot
              ] && (
                <TouchableOpacity
                  onPress={() =>
                    removePhoto(
                      activeSlot
                    )
                  }
                  hitSlop={8}
                >
                  <Text
                    style={
                      styles.sourceRemove
                    }
                  >
                    Remove photo
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={() =>
                  setActiveSlot(
                    null
                  )
                }
                hitSlop={8}
                style={
                  styles.sourceCancel
                }
              >
                <Text
                  style={
                    styles.sourceCancelText
                  }
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {errors.photos && (
          <Text
            style={
              styles.errorText
            }
          >
            {errors.photos}
          </Text>
        )}

        {/* AI Identification */}

        {identifyPhoto && (
          <View
            style={
              styles.aiSection
            }
          >
            <TouchableOpacity
              style={[
                styles.identifyBtn,

                identifying &&
                  styles.disabledBtn,
              ]}
              activeOpacity={
                0.85
              }
              onPress={() =>
                void handleIdentify()
              }
              disabled={
                identifying
              }
            >
              {identifying ? (
                <View
                  style={
                    styles.loadingRow
                  }
                >
                  <ActivityIndicator
                    color="#FFFFFF"
                  />

                  <Text
                    style={
                      styles.identifyBtnText
                    }
                  >
                    Analysing
                    photo...
                  </Text>
                </View>
              ) : (
                <Text
                  style={
                    styles.identifyBtnText
                  }
                >
                  Identify species
                  with AI
                </Text>
              )}
            </TouchableOpacity>

            <Text
              style={
                styles.aiHint
              }
            >
              Uses your{' '}
              {identifySlot?.toLowerCase()}{' '}
              photo · internet
              required
            </Text>

            {identifyMessage !==
              '' && (
              <Text
                style={
                  styles.identifyMessage
                }
              >
                {
                  identifyMessage
                }
              </Text>
            )}

            {suggestions.length >
              0 && (
              <View
                style={
                  styles.suggestionsBlock
                }
              >
                <Text
                  style={
                    styles.suggestionsTitle
                  }
                >
                  AI species
                  suggestions
                </Text>

                <Text
                  style={
                    styles.suggestionsHelp
                  }
                >
                  Select an approved
                  AI suggestion, or
                  use the Species
                  Reference to
                  research the plant
                  yourself.
                </Text>

                {suggestions.map(
                  (
                    suggestion
                  ) => {
                    const selected =
                      selectedSpecies
                        ?.rank ===
                        suggestion.rank &&
                      selectedSpecies
                        .scientificName ===
                        suggestion.scientificName;

                    return (
                      <TouchableOpacity
                        key={`${suggestion.rank}-${suggestion.scientificName}`}
                        style={[
                          styles.suggestionCard,

                          selected &&
                            styles.selectedSuggestionCard,
                        ]}
                        onPress={() =>
                          selectSuggestion(
                            suggestion
                          )
                        }
                      >
                        <View
                          style={
                            styles.suggestionHeader
                          }
                        >
                          <Text
                            style={
                              styles.suggestionName
                            }
                          >
                            {
                              suggestion.rank
                            }
                            .{' '}
                            {
                              suggestion.scientificName
                            }
                          </Text>

                          <Text
                            style={
                              styles.confidence
                            }
                          >
                            {suggestion.confidence.toFixed(
                              1
                            )}
                            %
                          </Text>
                        </View>

                        {suggestion.commonName && (
                          <Text
                            style={
                              styles.suggestionDetail
                            }
                          >
                            Common name:{' '}
                            {
                              suggestion.commonName
                            }
                          </Text>
                        )}

                        {suggestion.family && (
                          <Text
                            style={
                              styles.suggestionDetail
                            }
                          >
                            Family:{' '}
                            {
                              suggestion.family
                            }
                          </Text>
                        )}

                        <Text
                          style={
                            styles.suggestionDetail
                          }
                        >
                          Confidence:{' '}
                          {
                            suggestion.confidenceLevel
                          }
                          {selected
                            ? ' · Selected'
                            : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  }
                )}
              </View>
            )}
          </View>
        )}

        {/* Species */}

        <Text
          style={
            styles.sectionLabel
          }
        >
          SPECIES DETAILS
        </Text>

        <Text
          style={
            styles.fieldLabel
          }
        >
          Confirmed species
        </Text>

        <SpeciesPicker
          value={
            speciesChoice
          }
          onChange={
            handleSpeciesChange
          }
          query={
            speciesQuery
          }
          onQueryChange={
            setSpeciesQuery
          }
          hasError={
            !!errors.scientificName
          }
        />

        <Text
          style={
            styles.speciesHint
          }
        >
          Select an approved
          species when you are
          confident. If the species
          cannot be confirmed in
          the field, you can save
          this record locally and
          continue later.
        </Text>

        {speciesChoice && (
          <View
            style={
              styles.speciesInfo
            }
          >
            <Text
              style={
                styles.speciesInfoRow
              }
            >
              <Text
                style={
                  styles.speciesInfoLabel
                }
              >
                Common name:{' '}
              </Text>

              {speciesChoice
                .species
                .common_name ||
                'Not recorded'}
            </Text>

            <Text
              style={
                styles.speciesInfoRow
              }
            >
              <Text
                style={
                  styles.speciesInfoLabel
                }
              >
                Family:{' '}
              </Text>

              {speciesChoice
                .species
                .taxonomy
                ?.family ||
                'Not recorded'}
            </Text>

            <Text
              style={
                styles.speciesInfoRow
              }
            >
              <Text
                style={
                  styles.speciesInfoLabel
                }
              >
                Conservation
                status:{' '}
              </Text>

              {(() => {
                const code =
                  conservationStatusCode(
                    speciesChoice
                      .species
                      .conservation_status
                  );

                return `${code} (${conservationStatusLabel(
                  code
                )})`;
              })()}
            </Text>
          </View>
        )}

        {speciesNotice !==
          '' && (
          <Text
            style={
              styles.identifyMessage
            }
          >
            {speciesNotice}
          </Text>
        )}

        {errors.scientificName && (
          <Text
            style={
              styles.errorText
            }
          >
            {
              errors.scientificName
            }
          </Text>
        )}

        <Text
          style={
            styles.fieldLabel
          }
        >
          Height / diameter (m)
        </Text>

        <TextInput
          style={
            styles.input
          }
          placeholder="e.g. 0.4"
          placeholderTextColor="#8C9A91"
          keyboardType="decimal-pad"
          value={height}
          onChangeText={
            setHeight
          }
          inputAccessoryViewID={
            DONE_BAR_ID
          }
        />

        <Text
          style={
            styles.fieldLabel
          }
        >
          Field notes
        </Text>

        <TextInput
          style={[
            styles.input,
            {
              height: 76,
              textAlignVertical:
                'top',
            },
          ]}
          placeholder="e.g. 3 pitchers, lower leaves damaged, growing on limestone"
          placeholderTextColor="#8C9A91"
          multiline
          value={
            morphology
          }
          onChangeText={
            setMorphology
          }
          inputAccessoryViewID={
            DONE_BAR_ID
          }
        />

        {/* Location */}

        <Text
          style={
            styles.sectionLabel
          }
        >
          LOCATION
        </Text>

        <Text
          style={
            styles.fieldLabel
          }
        >
          Location landmark *
        </Text>

        <TextInput
          style={[
            styles.input,

            errors.locationName &&
              styles.inputError,
          ]}
          placeholder="e.g. left of boardwalk, 50 m past cave entrance"
          placeholderTextColor="#8C9A91"
          value={
            locationName
          }
          onChangeText={
            handleLocationNameChange
          }
          returnKeyType="done"
        />

        {errors.locationName && (
          <Text
            style={
              styles.errorText
            }
          >
            {
              errors.locationName
            }
          </Text>
        )}

        <Text
          style={
            styles.fieldLabel
          }
        >
          GPS coordinates *
        </Text>

        {gpsStatus ===
          'acquiring' && (
          <View
            style={
              styles.gpsCard
            }
          >
            <View
              style={
                styles.loadingRow
              }
            >
              <ActivityIndicator
                color="#213B2A"
              />

              <Text
                style={
                  styles.gpsStatusPending
                }
              >
                Acquiring GPS
                fix...
              </Text>
            </View>

            <Text
              style={
                styles.gpsDetails
              }
            >
              This can take longer
              under dense canopy.
              Gives up after 20
              seconds.
            </Text>

            <TouchableOpacity
              style={
                styles.refreshGpsBtn
              }
              onPress={() =>
                void fetchLocation()
              }
            >
              <Text
                style={
                  styles.refreshGpsBtnText
                }
              >
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {gpsStatus ===
          'timeout' && (
          <View
            style={[
              styles.gpsCard,
              styles.gpsCardError,
            ]}
          >
            <Text
              style={
                styles.gpsStatusError
              }
            >
              Couldn't get a GPS
              fix – move to an open
              spot
            </Text>

            <Text
              style={
                styles.gpsDetails
              }
            >
              No fix after 20
              seconds. Step away
              from dense canopy or
              rock walls, then
              retry.
            </Text>

            <TouchableOpacity
              style={
                styles.refreshGpsBtn
              }
              onPress={() =>
                void fetchLocation()
              }
            >
              <Text
                style={
                  styles.refreshGpsBtnText
                }
              >
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {gpsStatus ===
          'unavailable' && (
          <TouchableOpacity
            style={[
              styles.gpsCard,
              styles.gpsCardError,
            ]}
            activeOpacity={
              0.8
            }
            onPress={() =>
              void fetchLocation()
            }
          >
            <Text
              style={
                styles.gpsStatusError
              }
            >
              GPS unavailable –
              tap to retry
            </Text>

            {gpsError !==
              '' && (
              <Text
                style={
                  styles.gpsDetails
                }
              >
                {gpsError}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {gpsStatus ===
          'ready' &&
          gpsFix && (
            <View
              style={
                styles.gpsCard
              }
            >
              <Text
                style={
                  styles.gpsStatusBadge
                }
              >
                {describeAccuracy(
                  gpsFix.accuracyM
                )}
              </Text>

              <Text
                style={
                  styles.gpsCoords
                }
              >
                {formatCoordinates(
                  gpsFix.latitude,
                  gpsFix.longitude,
                  null
                )}
              </Text>

              <Text
                style={
                  styles.gpsDetails
                }
              >
                {gpsFix.accuracyM ===
                null
                  ? 'The device did not report accuracy for this fix.'
                  : `Accuracy ±${Math.round(
                      gpsFix.accuracyM
                    )} m`}
              </Text>

              <TouchableOpacity
                style={
                  styles.refreshGpsBtn
                }
                onPress={() =>
                  void fetchLocation()
                }
              >
                <Text
                  style={
                    styles.refreshGpsBtnText
                  }
                >
                  Update to current
                  location
                </Text>
              </TouchableOpacity>
            </View>
          )}

        {errors.gps &&
          !gpsFix && (
            <Text
              style={[
                styles.errorText,
                styles.gpsErrorText,
              ]}
            >
              {errors.gps}
            </Text>
          )}

        {Object.values(
          errors
        ).some(Boolean) && (
          <Text
            style={
              styles.errorSummary
            }
          >
            Fix the highlighted
            fields above to save.
          </Text>
        )}

        <TouchableOpacity
          style={
            styles.saveBtn
          }
          activeOpacity={
            0.85
          }
          onPress={() =>
            void handleSave()
          }
        >
          <Text
            style={
              styles.saveBtnText
            }
          >
            {speciesChoice
              ? isEditing
                ? 'Save completed record'
                : 'Save record'
              : 'Save for later'}
          </Text>
        </TouchableOpacity>
      </FormScrollView>

      <KeyboardDoneBar
        nativeID={
          DONE_BAR_ID
        }
      />
    </SafeAreaView>
  );
}

const styles =
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor:
        '#F6F8F6',

      paddingTop:
        Platform.OS ===
        'android'
          ? StatusBar.currentHeight
          : 0,
    },

    navRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      paddingHorizontal: 20,
      paddingVertical: 10,
    },

    backChevron: {
      fontSize: 32,
      color: '#213B2A',
    },

    navTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: '#1E2B22',
    },

    navSide: {
      width: 40,
    },

    scrollContent: {
      paddingHorizontal: 20,
      paddingBottom: 40,
    },

    sectionHeaderRow: {
      flexDirection: 'row',
      justifyContent:
        'space-between',
      alignItems: 'center',
      marginTop: 14,
      marginBottom: 8,
    },

    sectionLabel: {
      fontSize: 11.5,
      fontWeight: '800',
      color: '#7D8C81',
      letterSpacing: 0.8,
      marginTop: 14,
      marginBottom: 8,
    },

    sectionSubLabel: {
      fontSize: 11.5,
      color: '#88988D',
    },

    photoGrid: {
      flexDirection: 'row',
      justifyContent:
        'space-between',
      marginBottom: 14,
    },

    photoBox: {
      width: '23%',
      height: 80,
      borderRadius: 14,
      backgroundColor:
        '#E8EFEA',
      borderWidth: 1,
      borderColor:
        '#D4E2D8',
      justifyContent:
        'center',
      alignItems: 'center',
      overflow: 'hidden',
    },

    photoBoxActive: {
      borderColor:
        '#213B2A',
      borderWidth: 2,
    },

    photoThumb: {
      width: '100%',
      height: '100%',
    },

    photoSlotText: {
      fontSize: 10,
      fontWeight: '600',
      color: '#3A5243',
      marginTop: 4,
    },

    sourcePanel: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 16,
      borderWidth: 1.2,
      borderColor:
        '#E6ECE8',
      padding: 14,
      marginBottom: 14,
    },

    sourceTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: '#213B2A',
      marginBottom: 10,
    },

    sourceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },

    sourceBtn: {
      flex: 1,
      height: 44,
      borderRadius: 22,
      backgroundColor:
        '#213B2A',
      justifyContent:
        'center',
      alignItems: 'center',
      marginBottom: 10,
    },

    sourceBtnText: {
      color: '#FFFFFF',
      fontWeight: '700',
      fontSize: 13,
      textAlign: 'center',
    },

    sourceRemove: {
      color: '#9B1C1C',
      fontWeight: '700',
      fontSize: 13,
    },

    sourceCancel: {
      marginLeft: 'auto',
    },

    sourceCancelText: {
      color: '#4E6254',
      fontWeight: '700',
      fontSize: 13,
    },

    aiSection: {
      marginBottom: 16,
    },

    identifyBtn: {
      backgroundColor:
        '#46654F',
      minHeight: 46,
      borderRadius: 23,
      justifyContent:
        'center',
      alignItems: 'center',
      paddingHorizontal: 16,
    },

    disabledBtn: {
      opacity: 0.65,
    },

    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },

    identifyBtnText: {
      color: '#FFFFFF',
      fontWeight: '700',
      fontSize: 14,
    },

    aiHint: {
      fontSize: 11.5,
      color: '#7E8F83',
      marginTop: 6,
      textAlign: 'center',
    },

    identifyMessage: {
      fontSize: 12.5,
      color: '#7A5134',
      lineHeight: 18,
      marginTop: 10,
      paddingHorizontal: 4,
    },

    suggestionsBlock: {
      marginTop: 12,
    },

    suggestionsTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: '#213B2A',
      marginBottom: 2,
    },

    suggestionsHelp: {
      fontSize: 11.5,
      color: '#68776D',
      marginBottom: 8,
    },

    suggestionCard: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 16,
      borderWidth: 1.2,
      borderColor:
        '#E6ECE8',
      padding: 14,
      marginBottom: 8,
    },

    selectedSuggestionCard: {
      backgroundColor:
        '#EEF5F0',
      borderColor:
        '#213B2A',
      borderWidth: 2,
    },

    suggestionHeader: {
      flexDirection: 'row',
      justifyContent:
        'space-between',
      gap: 8,
    },

    suggestionName: {
      flex: 1,
      fontSize: 14,
      fontWeight: '700',
      color: '#213B2A',
    },

    confidence: {
      fontWeight: '700',
      color: '#46654F',
    },

    suggestionDetail: {
      fontSize: 12,
      color: '#68776D',
      marginTop: 3,
    },

    fieldLabel: {
      fontSize: 12.5,
      fontWeight: '700',
      color: '#213B2A',
      marginBottom: 6,
      marginTop: 6,
    },

    input: {
      backgroundColor:
        '#FFFFFF',
      minHeight: 48,
      borderRadius: 16,
      paddingHorizontal: 16,
      fontSize: 13.5,
      color: '#1E2B22',
      borderWidth: 1.2,
      borderColor:
        '#E6ECE8',
      marginBottom: 8,
    },

    inputError: {
      borderColor:
        '#E59A9A',
    },

    errorText: {
      fontSize: 12,
      color: '#9B1C1C',
      marginTop: -2,
      marginBottom: 10,
      paddingHorizontal: 4,
    },

    gpsErrorText: {
      marginTop: -16,
    },

    errorSummary: {
      fontSize: 12.5,
      color: '#9B1C1C',
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: 10,
    },

    gpsCard: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 18,
      padding: 16,
      borderWidth: 1.2,
      borderColor:
        '#E6ECE8',
      marginBottom: 24,
    },

    gpsCardError: {
      borderColor:
        '#F0C2C2',
      backgroundColor:
        '#FFF8F8',
    },

    gpsStatusBadge: {
      color: '#215A36',
      fontWeight: '700',
      fontSize: 12,
      marginBottom: 4,
    },

    gpsStatusPending: {
      color: '#213B2A',
      fontWeight: '700',
      fontSize: 13,
    },

    gpsStatusError: {
      color: '#9B1C1C',
      fontWeight: '700',
      fontSize: 14,
      marginBottom: 4,
    },

    gpsCoords: {
      fontSize: 14,
      fontWeight: '800',
      color: '#1E2B22',
      marginBottom: 4,
    },

    gpsDetails: {
      fontSize: 11.5,
      color: '#7E8F83',
      marginBottom: 12,
    },

    refreshGpsBtn: {
      alignSelf:
        'flex-start',
      backgroundColor:
        '#EDF5EF',
      paddingVertical: 6,
      paddingHorizontal: 14,
      borderRadius: 16,
    },

    refreshGpsBtnText: {
      color: '#213B2A',
      fontWeight: '700',
      fontSize: 12,
    },

    saveBtn: {
      backgroundColor:
        '#213B2A',
      height: 52,
      borderRadius: 26,
      justifyContent:
        'center',
      alignItems: 'center',
      marginTop: 4,
    },

    saveBtnText: {
      color: '#FFF',
      fontWeight: '700',
      fontSize: 15,
    },

    speciesHint: {
      fontSize: 11.5,
      color: '#68776D',
      lineHeight: 17,
      marginTop: 4,
      marginBottom: 10,
      paddingHorizontal: 3,
    },

    speciesInfo: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 16,
      borderWidth: 1.2,
      borderColor:
        '#E6ECE8',
      paddingVertical: 10,
      paddingHorizontal: 14,
      marginBottom: 12,
    },

    speciesInfoRow: {
      fontSize: 13,
      color: '#1E2B22',
      marginVertical: 2,
    },

    speciesInfoLabel: {
      fontWeight: '700',
      color: '#4E6254',
    },
  });