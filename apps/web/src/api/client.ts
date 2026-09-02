type ApiErrorBody = {
  code?: unknown;
  message?: unknown;
};

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(
  handler: UnauthorizedHandler | null,
): void {
  unauthorizedHandler = handler;
}

export function handleUnauthorized(): void {
  unauthorizedHandler?.();
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody = {};

  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Non-JSON failures still receive a stable client-side error.
  }

  return new ApiError(
    typeof body.code === "string" ? body.code : "UNKNOWN",
    typeof body.message === "string" ? body.message : response.statusText,
    response.status,
  );
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
  });

  if (response.status === 401) {
    handleUnauthorized();
  }

  if (!response.ok) {
    throw await readError(response);
  }

  return response;
}
