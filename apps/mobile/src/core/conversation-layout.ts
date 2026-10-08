/** Use available window space, never a device name: also supports iPad multitasking. */
export function conversationLayout(width: number, fontScale: number) {
  const scale = Math.max(1, Number.isFinite(fontScale) ? fontScale : 1);
  const sidebarWidth = Math.max(320, Math.min(400, width * 0.36)) * scale;
  const split = Number.isFinite(width) && width >= sidebarWidth + 460 * scale;
  return { split, sidebarWidth: split ? sidebarWidth : 0 };
}
