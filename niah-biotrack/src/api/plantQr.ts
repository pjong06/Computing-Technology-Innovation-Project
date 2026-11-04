import { File, Paths } from 'expo-file-system';
import { apiFetch } from './client';

// GET /api/plants/:id/qr (botanist who registered the plant). qr_code is a PNG data URI.
export interface PlantQr {
  qrValue: string; // the tag code, e.g. NIAH-PLT-00001
  publicUrl: string; // the public page the QR opens
  imageDataUri: string; // data:image/png;base64,...
}

interface PlantQrResponse {
  qr_value: string;
  public_url: string;
  qr_code: string;
}

// serverId is the plant's id on the server (only uploaded plants have one).
// Errors are ApiError, e.g. 409 "Attach a NIAH-PLT tag before generating its QR code".
export async function fetchPlantQr(serverId: string): Promise<PlantQr> {
  const response = await apiFetch<PlantQrResponse>(`/api/plants/${encodeURIComponent(serverId)}/qr`);
  return { qrValue: response.qr_value, publicUrl: response.public_url, imageDataUri: response.qr_code };
}

// Saves the QR as a PNG in the cache folder (for the share sheet) and returns its URI.
export async function saveQrImage(qr: PlantQr): Promise<string> {
  const base64 = qr.imageDataUri.replace(/^data:image\/png;base64,/, '');
  const file = new File(Paths.cache, `${qr.qrValue}.png`);
  if (file.exists) file.delete();
  await file.write(base64, { encoding: 'base64' });
  return file.uri;
}
