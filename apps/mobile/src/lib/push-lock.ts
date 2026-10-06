// Serialize registration and logout so an in-flight refresh cannot restore a removed device.
let chain: Promise<void> = Promise.resolve();
export function withPushRegistrationLock<T>(action: () => Promise<T>): Promise<T> {
  const result = chain.then(action, action);
  chain = result.then(
    () => {},
    () => {},
  );
  return result;
}
