import { Directory, File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { ATTACHMENT_LIMITS } from "@site-chat/shared";
import type { PendingMessage } from "../core/outbox";

export async function pickFile(
  photo: boolean,
  userId: string,
): Promise<PendingMessage["file"] | null> {
  let uri: string;
  let filename: string;
  let mimeType: string;
  if (photo) {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    uri = asset.uri;
    filename = asset.fileName || "photo.jpg";
    mimeType = asset.mimeType || "image/jpeg";
  } else {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    uri = asset.uri;
    filename = asset.name;
    mimeType = asset.mimeType || "application/octet-stream";
  }
  const source = new File(uri);
  const limit = mimeType.startsWith("image/")
    ? ATTACHMENT_LIMITS.imageMaxBytes
    : ATTACHMENT_LIMITS.documentMaxBytes;
  if (source.size > limit)
    throw new Error(`File is too large. Maximum size: ${limit / 1024 / 1024} MB.`);
  const directory = new Directory(Paths.document, "mill-outbox", userId);
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, Crypto.randomUUID());
  source.copy(destination);
  return { uri: destination.uri, filename, mimeType, sizeBytes: destination.size };
}
export function removeLocalFile(item: PendingMessage) {
  if (item.file) {
    const file = new File(item.file.uri);
    if (file.exists) file.delete();
  }
}
