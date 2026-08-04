export type WidgetLocale = "en" | "ru";

export type WidgetDirection = "ltr" | "rtl";

export type WidgetMessages = {
  launcherLabel: string;
  launcherOpenLabel: string;
  closeLabel: string;
  composerPlaceholder: string;
  sendLabel: string;
  sendingLabel: string;
  retryLabel: string;
  reconnectingLabel: string;
  offlineLabel: string;
  connectionFailedLabel: string;
  welcomeTitle: string;
  loadError: string;
  sessionError: string;
  sendError: string;
  poweredBy: string;
  youLabel: string;
  agentLabel: string;
  systemLabel: string;
};

export const widgetDictionaries: Record<WidgetLocale, WidgetMessages> = {
  en: {
    launcherLabel: "Open chat",
    launcherOpenLabel: "Close chat",
    closeLabel: "Close",
    composerPlaceholder: "Type your message…",
    sendLabel: "Send",
    sendingLabel: "Sending…",
    retryLabel: "Retry",
    reconnectingLabel: "Reconnecting…",
    offlineLabel: "Connection lost. Retrying…",
    connectionFailedLabel: "Live updates unavailable.",
    welcomeTitle: "Start a conversation",
    loadError: "Unable to load chat.",
    sessionError: "Session expired. Please reload the page.",
    sendError: "Message failed to send.",
    poweredBy: "Powered by Site Chat",
    youLabel: "You",
    agentLabel: "Agent",
    systemLabel: "System",
  },
  ru: {
    launcherLabel: "Открыть чат",
    launcherOpenLabel: "Закрыть чат",
    closeLabel: "Закрыть",
    composerPlaceholder: "Введите сообщение…",
    sendLabel: "Отправить",
    sendingLabel: "Отправка…",
    retryLabel: "Повторить",
    reconnectingLabel: "Переподключение…",
    offlineLabel: "Соединение потеряно. Повтор…",
    connectionFailedLabel: "Живые обновления недоступны.",
    welcomeTitle: "Начните диалог",
    loadError: "Не удалось загрузить чат.",
    sessionError: "Сессия истекла. Обновите страницу.",
    sendError: "Не удалось отправить сообщение.",
    poweredBy: "Работает на Site Chat",
    youLabel: "Вы",
    agentLabel: "Оператор",
    systemLabel: "Система",
  },
};

export function resolveWidgetLocale(input: {
  configLocale?: WidgetLocale;
  browserLocale?: string | null;
}): WidgetLocale {
  if (input.configLocale === "en" || input.configLocale === "ru") {
    return input.configLocale;
  }

  const browser = input.browserLocale?.toLowerCase() ?? "";
  if (browser.startsWith("ru")) {
    return "ru";
  }

  return "en";
}

export function getWidgetDirection(_locale: WidgetLocale): WidgetDirection {
  return "ltr";
}

export function formatMessageTime(iso: string, locale: WidgetLocale): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
