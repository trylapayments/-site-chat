export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
type AuthSnapshot = {
  data: { session: { user: { id: string }; access_token: string } | null };
  error: unknown;
};
export function createTransport(
  readSession: () => Promise<AuthSnapshot>,
  apiUrl: string,
  network: typeof fetch = fetch,
) {
  return async function api<T>(
    operation: string,
    workspaceId?: string,
    input?: unknown,
    expectedUserId?: string,
  ): Promise<T> {
    const { data, error } = await readSession();
    if (error || !data.session)
      throw new ApiError(401, "UNAUTHORIZED", "Войдите в аккаунт заново.");
    if (expectedUserId && data.session.user.id !== expectedUserId)
      throw new ApiError(
        401,
        "ACCOUNT_CHANGED",
        "Аккаунт изменился. Сообщение сохранено для исходного аккаунта.",
      );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await network(`${apiUrl.replace(/\/$/, "")}/api/v1/mobile`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ operation, workspaceId, input }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw new ApiError(
          response.status,
          body.error?.code || "FAILED",
          body.error?.message || "Не удалось выполнить действие.",
        );
      return body.data as T;
    } finally {
      clearTimeout(timeout);
    }
  };
}
