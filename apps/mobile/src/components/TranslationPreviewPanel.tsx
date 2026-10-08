import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  acceptTranslationPreview,
  translationLanguages,
  type TranslationLanguage,
  type TranslationPreview,
} from "../core/translation";
import { Button, ErrorBanner, useTheme } from "./ui";

// The parent must supply a server-authorized translator. This panel never calls
// an AI provider or stores credentials; it only previews an explicit request.
type Props = {
  visible: boolean;
  scope: string;
  draft: string;
  readOnly?: boolean;
  onClose: () => void;
  onUse: (text: string) => void;
  translate: (
    text: string,
    target: TranslationLanguage,
  ) => Promise<TranslationPreview>;
};
export function TranslationPreviewPanel(props: Props) {
  return (
    <PreviewContent
      key={JSON.stringify([props.scope, props.draft, props.visible])}
      {...props}
    />
  );
}
function PreviewContent({
  visible,
  scope,
  draft,
  readOnly = false,
  onClose,
  onUse,
  translate,
}: Props) {
  const { colors, styles } = useTheme();
  const [target, setTarget] = useState<TranslationLanguage>("en");
  const [preview, setPreview] = useState<
    (TranslationPreview & { scope: string }) | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const current = useRef({ scope, draft, target, visible });
  const request = useRef(0);
  useLayoutEffect(() => {
    current.current = { scope, draft, target, visible };
  }, [scope, draft, target, visible]);
  function selectLanguage(language: TranslationLanguage) {
    request.current += 1;
    setTarget(language);
    setPreview(null);
    setBusy(false);
    setError("");
  }
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  async function generate() {
    if (busy || !consent || !draft.trim() || draft.length > 4000) return;
    const requested = { scope, draft, target };
    const version = ++request.current;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const result = await translate(draft, target);
      const now = current.current;
      if (request.current !== version || !now.visible) return;
      const accepted = acceptTranslationPreview(
        result,
        now.draft,
        requested.scope,
        now.scope,
        now.target,
      );
      if (requested.draft !== now.draft || requested.target !== now.target)
        return;
      if (!accepted)
        throw new Error(
          "Unable to preview this translation. Please try again.",
        );
      setPreview({ ...result, scope: requested.scope });
    } catch (failure) {
      if (request.current === version && current.current.visible)
        setError(
          failure instanceof Error
            ? failure.message
            : "Translation is unavailable. Your draft is unchanged.",
        );
    } finally {
      if (request.current === version) setBusy(false);
    }
  }
  const usable = preview
    ? acceptTranslationPreview(preview, draft, preview.scope, scope, target)
    : null;
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 18 }}>
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Text style={styles.heading}>
              {readOnly ? "Translate message" : "Translate reply"}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={{ padding: 12 }}
            >
              <Text style={{ color: colors.blue }}>Done</Text>
            </Pressable>
          </View>
          <Text style={styles.caption}>
            {readOnly
              ? "Read this message in your language. The original stays unchanged."
              : "Choose the customer’s language. Review the translation before using it."}
          </Text>
          <View style={[styles.card, { gap: 6 }]}>
            <Text style={styles.caption}>Source language</Text>
            <Text style={{ color: colors.ink }}>Detect automatically</Text>
          </View>
          <Text style={styles.caption}>Translate into</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {(Object.keys(translationLanguages) as TranslationLanguage[]).map(
              (language) => (
                <Pressable
                  key={language}
                  onPress={() => selectLanguage(language)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: target === language }}
                  style={{
                    padding: 12,
                    borderRadius: 14,
                    backgroundColor:
                      target === language ? colors.pale : colors.surface,
                  }}
                >
                  <Text
                    style={{
                      color: target === language ? colors.blue : colors.ink,
                    }}
                  >
                    {translationLanguages[language]}
                  </Text>
                </Pressable>
              ),
            )}
          </ScrollView>
          <View style={[styles.card, { gap: 8 }]}>
            <Text style={styles.caption}>
              {readOnly ? "Original message" : "Original draft"}
            </Text>
            <Text selectable style={{ color: colors.ink }}>
              {draft}
            </Text>
          </View>
          {!usable && (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consent }}
              onPress={() => setConsent((value) => !value)}
              style={[styles.row, { gap: 12, minHeight: 44 }]}
            >
              <Text style={{ color: colors.blue, fontSize: 20 }}>
                {consent ? "☑" : "☐"}
              </Text>
              <Text style={[styles.caption, { flex: 1 }]}>
                Send this text to OpenAI to translate it.
              </Text>
            </Pressable>
          )}
          <ErrorBanner
            message={
              error ||
              (draft.length > 4000
                ? "Translate replies of up to 4,000 characters."
                : "")
            }
          />
          {usable ? (
            <>
              <View style={[styles.card, { gap: 8 }]}>
                <Text style={styles.caption}>
                  {translationLanguages[target]} · AI translation
                </Text>
                <Text
                  selectable
                  style={{ color: colors.ink, fontSize: 16, lineHeight: 23 }}
                >
                  {usable}
                </Text>
              </View>
              <Button
                title={readOnly ? "Done" : "Use translation"}
                onPress={() => {
                  const now = current.current;
                  const accepted =
                    preview &&
                    acceptTranslationPreview(
                      preview,
                      now.draft,
                      preview.scope,
                      now.scope,
                      now.target,
                    );
                  if (accepted && now.visible) {
                    if (!readOnly) onUse(accepted);
                    onClose();
                  }
                }}
              />
              <Text style={styles.caption}>
                {readOnly
                  ? "AI translations can contain mistakes. Refer to the original when accuracy matters."
                  : "This updates your draft. Nothing is sent to the customer until you press Send."}
              </Text>
            </>
          ) : (
            <Button
              title={busy ? "Translating…" : "Preview translation"}
              onPress={() => void generate()}
              disabled={
                busy || !consent || !draft.trim() || draft.length > 4000
              }
            />
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
