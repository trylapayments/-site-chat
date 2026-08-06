export type { WidgetMessageKey, WidgetMessages } from "./types";
export { WIDGET_MESSAGE_KEYS } from "./types";

export {
  dictionaryLoaders,
  englishMessages,
  getCachedWidgetDictionary,
  loadWidgetDictionary,
} from "./load-dictionary";

export { formatMessageTime, formatWidgetMessage, getWidgetDirection } from "./format";

export {
  DEFAULT_WIDGET_LOCALE,
  getWidgetLocaleDefinition,
  isWidgetLocale,
  matchWidgetLocale,
  resolveWidgetLocale,
  type WidgetTextDirection,
} from "@site-chat/shared";

export type { WidgetLocale } from "@site-chat/shared";
