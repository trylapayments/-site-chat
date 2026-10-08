import { WIDGET_ASSET_LIMITS } from "@site-chat/shared";

/** Resize before upload; server still verifies bytes, type and dimensions. */
export async function prepareWidgetImage(file: File): Promise<File> {
  if (
    !(WIDGET_ASSET_LIMITS.allowedMimeTypes as readonly string[]).includes(
      file.type,
    )
  )
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose an image smaller than 20 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    let scale = Math.min(
      1,
      WIDGET_ASSET_LIMITS.maxWidth / image.naturalWidth,
      WIDGET_ASSET_LIMITS.maxHeight / image.naturalHeight,
    );
    if (scale === 1 && file.size <= WIDGET_ASSET_LIMITS.maxBytes) return file;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Could not prepare the image. Please try another file.");
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        { canvas.toBlob(resolve, file.type, 0.86); },
      );
      if (blob && blob.size <= WIDGET_ASSET_LIMITS.maxBytes) {
        const extension =
          blob.type === "image/jpeg"
            ? "jpg"
            : blob.type === "image/webp"
              ? "webp"
              : "png";
        return new File(
          [blob],
          `${file.name.replace(/\.[^.]+$/, "")}.${extension}`,
          { type: blob.type },
        );
      }
      scale *= 0.75;
    }
    throw new Error(
      "Could not reduce this image enough. Please choose a simpler image.",
    );
  } catch (error) {
    throw error instanceof Error && !["EncodingError"].includes(error.name)
      ? error
      : new Error("Could not read this image. Please choose another file.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
